import { getDB, NOVEL_CHECKPOINTS_STORE } from '../storage/db';
import { assertNovelPaidProductEpoch, novelPaidProductEpoch, listNovelPaidProducts, releaseNovelPaidProducts, retainNovelPaidProducts, validateNovelPaidProduct, type NovelPaidProduct } from './paidProducts';
import { importNovelDataset } from './datasetImport';
import type { NovelAnalysisJob, NovelChunk, NovelDataset } from './types';
import { listNovelJobs, listNovelChunks, restoreNovelRecoveryState } from './novelStore';
import { z } from 'zod';

const identityText = z.string().trim().min(1);
const count = z.number().int().nonnegative();
const phase = z.enum(['index', 'evidence', 'overview', 'segments', 'completed']);
const jobSchema = z.object({
  id: identityText, datasetId: identityText, status: z.enum(['idle', 'queued', 'running', 'paused', 'completed', 'failed', 'cancelled']),
  phase, startSegmentIndex: count, total: count, completed: count, failed: count, retryCount: count,
  createdAt: z.number().finite().nonnegative(), updatedAt: z.number().finite().nonnegative(),
  runId: identityText.optional(), goal: z.enum(['full', 'background']).optional(),
  model: z.string().optional(), configFingerprint: identityText.optional(), currentSegmentId: identityText.optional(), lastError: z.string().optional(),
  requestCount: count.optional(), embeddedChunks: count.optional(), totalChunks: count.optional(),
  embeddingMode: z.enum(['enhanced', 'basic']).optional(), embeddingStatus: z.enum(['off', 'preparing', 'enhanced', 'partial', 'degraded']).optional(),
  tokenUsage: z.object({ prompt: count, completion: count }).passthrough().optional(),
  phaseCounts: z.partialRecord(phase, z.object({ completed: count, total: count, failed: count }).passthrough()).optional(),
}).passthrough();

function recoveryJobs(value: unknown, dataset: NovelDataset): NovelAnalysisJob[] {
  const result = z.array(jobSchema).safeParse(value);
  if (!result.success) throw new Error('小说恢复包任务形状无效');
  const jobs = result.data as NovelAnalysisJob[];
  const segmentIds = new Set(dataset.segments.map(segment => segment.id));
  if (new Set(jobs.map(job => job.id)).size !== jobs.length) throw new Error('小说恢复包包含重复任务');
  for (const job of jobs) {
    if (job.datasetId !== dataset.id || (job.currentSegmentId && !segmentIds.has(job.currentSegmentId))) throw new Error('小说恢复包任务身份无效');
    delete job.runId;
    if (job.status === 'running' || job.status === 'queued') job.status = 'paused';
  }
  return jobs;
}

function recoveryChunks(value: unknown, dataset: NovelDataset): NovelChunk[] {
  const schema = z.array(z.object({ id: identityText, datasetId: identityText, chapterId: identityText, index: count,
    text: z.string(), contextPrefix: z.string(), startOffset: count, endOffset: count, contentHash: identityText,
    chapterStartOffset: count.optional(), chapterEndOffset: count.optional(), embedding: z.array(z.number().finite()).optional(),
    embeddingDimension: z.number().int().positive().optional(), embeddingModel: z.string().optional(),
    embeddingIdentity: z.string().optional(), embeddingInputHash: z.string().optional(), embeddedAt: z.number().finite().nonnegative().optional(),
  }).passthrough());
  const result = schema.safeParse(value);
  if (!result.success) throw new Error('小说恢复包索引格式无效');
  const chapters = new Map(dataset.chapters.map(c => [c.id, c]));
  const chunks = result.data as NovelChunk[];
  if (new Set(chunks.map(c => c.id)).size !== chunks.length || chunks.some(c => c.datasetId !== dataset.id || !chapters.has(c.chapterId)
    || c.endOffset < c.startOffset || (c.embedding && (!c.embedding.length || c.embeddingDimension !== c.embedding.length))
    || (c.chapterStartOffset !== undefined && c.chapterEndOffset !== undefined && (c.chapterEndOffset < c.chapterStartOffset || c.chapterEndOffset > chapters.get(c.chapterId)!.content.length)))) throw new Error('小说恢复包索引身份或维度无效');
  return chunks;
}

interface NovelPaidProductPackage {
  format: 'omni-novel-paid-products';
  version: 1;
  datasetId: string;
  exportedAt: number;
  products: NovelPaidProduct[];
}

function validatePaidProductPackage(value: unknown, datasetId: string): NovelPaidProductPackage {
  const pack = value as NovelPaidProductPackage;
  if (!pack || pack.format !== 'omni-novel-paid-products' || pack.version !== 1 || pack.datasetId !== datasetId
    || !datasetId.trim() || !Number.isFinite(pack.exportedAt) || pack.exportedAt < 0 || !Array.isArray(pack.products)) {
    throw new Error('成果包版本无效或不属于当前小说资料');
  }
  const products = pack.products.map(item => validateNovelPaidProduct(item, datasetId));
  if (new Set(products.map(item => item.id)).size !== products.length) throw new Error('成果包包含重复身份');
  return { format: pack.format, version: pack.version, datasetId, exportedAt: pack.exportedAt, products };
}

/** One file contains source, accepted author material and complete paid responses. No writes. */
export async function exportNovelRecoveryPackage(dataset: NovelDataset): Promise<string> {
  if (!dataset.id?.trim()) throw new Error('小说恢复包缺少资料身份');
  importNovelDataset(dataset);
  return JSON.stringify({ format: 'omni-novel-recovery', version: 1, exportedAt: Date.now(),
    dataset, paidProducts: JSON.parse(await exportNovelPaidProductPackage(dataset.id)), jobs: await listNovelJobs(dataset.id), chunks: await listNovelChunks(dataset.id) }, null, 2);
}

/** Pure decoding boundary; the caller explicitly chooses when to restore each owner. */
export function parseNovelRecoveryPackage(text: string): { dataset: NovelDataset; paidProducts: string; jobs: NovelAnalysisJob[]; chunks: NovelChunk[] } {
  let pack: { format?: unknown; version?: unknown; exportedAt?: unknown; dataset?: unknown; paidProducts?: unknown; jobs?: unknown; chunks?: unknown };
  try { pack = JSON.parse(text); } catch { throw new Error('小说恢复包不是有效 JSON'); }
  if (!pack || pack.format !== 'omni-novel-recovery' || pack.version !== 1
    || typeof pack.exportedAt !== 'number' || !Number.isFinite(pack.exportedAt) || pack.exportedAt < 0
    || !pack.dataset || typeof pack.dataset !== 'object' || Array.isArray(pack.dataset)
    || typeof (pack.dataset as Record<string, unknown>).id !== 'string' || !(pack.dataset as { id: string }).id.trim()) {
    throw new Error('小说恢复包版本或资料身份无效');
  }
  const dataset = importNovelDataset(pack.dataset);
  const products = validatePaidProductPackage(pack.paidProducts, dataset.id);
  const jobs = recoveryJobs(pack.jobs === undefined ? [] : pack.jobs, dataset);
  return { dataset, paidProducts: JSON.stringify(products), jobs, chunks: recoveryChunks(pack.chunks ?? [], dataset) };
}

export async function exportNovelPaidProductPackage(datasetId: string): Promise<string> {
  if (!datasetId.trim()) throw new Error('请选择小说资料');
  const pack: NovelPaidProductPackage = { format: 'omni-novel-paid-products', version: 1, datasetId,
    exportedAt: Date.now(), products: await listNovelPaidProducts(datasetId) };
  return JSON.stringify(pack, null, 2);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function importNovelPaidProductPackage(text: string, datasetId: string): Promise<{ imported: number; skipped: number }> {
  const epoch = novelPaidProductEpoch(datasetId);
  await assertNovelPaidProductEpoch(datasetId, epoch);
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('成果包不是有效 JSON'); }
  const pack = validatePaidProductPackage(raw, datasetId);
  // Validate the complete package before any write, including duplicated identities.
  const products = pack.products;
  const existing = new Map((await listNovelPaidProducts(datasetId)).map(item => [item.id, item]));
  for (const product of products) {
    const current = existing.get(product.id);
    if (current && canonical(current.value) !== canonical(product.value)) throw new Error('成果身份冲突，已有成果未修改');
  }
  const db = await getDB();
  await assertNovelPaidProductEpoch(datasetId, epoch);
  const tx = db.transaction(NOVEL_CHECKPOINTS_STORE, 'readwrite');
  const imported: NovelPaidProduct[] = [];
  const committed: NovelPaidProduct[] = [];
  let skipped = 0;
  try {
    for (const product of products) {
      const stored = await tx.store.get(product.id);
      const durable = stored ? validateNovelPaidProduct(stored, datasetId) : undefined;
      if (durable && canonical(durable.value) !== canonical(product.value)) throw new Error('成果身份冲突，已有成果未修改');
      const current = existing.get(product.id) ?? durable;
      if (current) {
        if (canonical(current.value) !== canonical(product.value)) throw new Error('成果身份冲突，已有成果未修改');
        skipped++;
        // A retained product may still need its first durable write.
        if (!stored) await tx.store.put(current);
        committed.push(current);
      } else {
        imported.push(product);
        await tx.store.put(product);
        committed.push(product);
      }
    }
    await tx.done;
    releaseNovelPaidProducts(committed);
    return { imported: imported.length, skipped };
  } catch (error) {
    try { tx.abort(); } catch { /* The failed transaction may already be aborted. */ }
    await tx.done.catch(() => undefined);
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      await assertNovelPaidProductEpoch(datasetId, epoch);
      // Conflict checks must also finish before retaining imported records.
      for (const product of products) {
        const current = existing.get(product.id);
        if (current && canonical(current.value) !== canonical(product.value)) throw new Error('成果身份冲突，已有成果未修改');
      }
      retainNovelPaidProducts(products.filter(product => !existing.has(product.id)));
      throw new Error('成果包已保留在当前窗口，保存失败；请释放空间后再次导入，或导出备份');
    }
    throw error;
  }
}

/** Validate the complete recovery file before crossing one atomic storage barrier. */
export async function restoreNovelRecoveryPackage(text: string, expectedRevision?: string): Promise<NovelDataset> {
  const parsed = parseNovelRecoveryPackage(text);
  const products = validatePaidProductPackage(JSON.parse(parsed.paidProducts), parsed.dataset.id).products;
  await restoreNovelRecoveryState(parsed.dataset, parsed.jobs, products, expectedRevision, parsed.chunks);
  return parsed.dataset;
}
