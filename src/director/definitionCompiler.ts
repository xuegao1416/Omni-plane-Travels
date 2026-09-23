import type { NovelDataset } from '../novel/types';
import type { DirectorDefinition, DirectorSource } from './definitionTypes';
import { validateDirectorDraft, type DirectorDraft } from './definitionSchema';
import { DEFINITION_COMPILER_SYSTEM } from './definitionPrompts';

export interface DirectorCompileUnit { id: string; text: string; sourceRefs: string[] }
export interface DirectorCompileJob {
  id: string; definitionId: string; title: string; source: DirectorSource; units: DirectorCompileUnit[];
  sourceFingerprint: string; checkpoints: Record<string, DirectorDraft>;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: number; updatedAt: number; error?: string; definition?: DirectorDefinition;
  coverageGaps: string[];
}
export type DirectorCompileInput = { kind: 'author'; text: string; title?: string } | { kind: 'novel'; dataset: NovelDataset };
export interface DirectorCompileRequest { system: string; prompt: string; stream: false; signal?: AbortSignal; phase: 'extract' | 'merge' }
export function contentHash(value: unknown): string {
  const input = JSON.stringify(value);
  let a = 2166136261, b = 5381;
  for (let i = 0; i < input.length; i++) { a = Math.imul(a ^ input.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ input.charCodeAt(i); }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}

export function createDirectorCompileJob(input: DirectorCompileInput, options: { definitionId?: string; unitChars?: number } = {}): DirectorCompileJob {
  const size = Math.max(1, options.unitChars ?? 12000);
  const units: DirectorCompileUnit[] = [];
  const coverageGaps: string[] = [];
  let source: DirectorSource, title: string;
  if (input.kind === 'author') {
    if (!input.text.trim()) throw new Error('请提供剧情原稿');
    source = { kind: 'author', text: input.text }; title = input.title ?? '原创主线';
    for (let start = 0; start < input.text.length; start += size) {
      const end = Math.min(input.text.length, start + size), ref = `author:${start}:${end}`;
      units.push({ id: contentHash(ref + input.text.slice(start, end)), text: input.text.slice(start, end), sourceRefs: [ref] });
    }
  } else {
    const d = input.dataset;
    if (d.coverage && d.coverage.selectedChapters < d.coverage.totalChapters) coverageGaps.push('仅包含选定章节，起点之前和边界之后的剧情未提供');
    if (d.segments.some(s => s.status === 'failed' || s.contextGap)) coverageGaps.push('部分分析缺失或上下文存在缺口，相关前提保持未知');
    if (d.analysisStatus !== 'ready') coverageGaps.push('小说资料尚非完整分析结果');
    title = d.title;
    const refs = d.segments.flatMap(s => [...(s.evidenceRefs ?? []), ...s.events.flatMap(e => e.evidenceRefs ?? [])]);
    const evidence = [...new Map(refs.map(r => [`novel:${r.chapterId}:${r.startOffset}:${r.endOffset}`, r])).values()];
    // 逐条校验证据与原文的对应关系。章节先建索引、匹配用 indexOf 定位：
    // 不再对每条证据 slice 一整个区间再 includes —— 证据多、章节长时那会把主线程和内存拖死。
    const chapterById = new Map(d.chapters.map(chapter => [chapter.id, chapter]));
    for (const r of evidence) {
      const chapter = chapterById.get(r.chapterId);
      if (!chapter || r.startOffset < 0 || r.endOffset <= r.startOffset || !r.excerpt.trim()) throw new Error('小说剧情来源不完整，请先恢复原文与证据');
      const start = r.chapterStartOffset ?? r.startOffset - (chapter.startOffset ?? 0);
      const end = r.chapterEndOffset ?? r.endOffset - (chapter.startOffset ?? 0);
      if (start < 0 || end > chapter.content.length) throw new Error('小说证据与原文不匹配');
      const found = chapter.content.indexOf(r.excerpt, start);
      if (found < 0 || found + r.excerpt.length > end) throw new Error('小说证据与原文不匹配');
    }
    source = { kind: 'novel', text: d.rawText ?? d.chapters.map(c => c.content).join('\n'), datasetId: d.id, sourceVersion: d.sourceVersion, chapterIds: d.chapters.map(c => c.id), evidenceRefs: evidence };
    for (const s of d.segments) {
      if (s.status === 'failed' || !s.events.length) continue;
      // Batch event records, not stages. Final merging rebuilds causal stages globally.
      for (const event of s.events) {
        const eventRefs = (event.evidenceRefs ?? []).map(r => `novel:${r.chapterId}:${r.startOffset}:${r.endOffset}`);
        if (!eventRefs.length) throw new Error(`剧情「${event.name}」缺少事件来源证据，请重新分析对应分段后再整理主线`);
        const text = JSON.stringify({ event, hardConstraints: s.hardConstraints, openingFacts: s.openingFacts, contextGap: s.contextGap, characters: d.staticMaterial.characters });
        units.push({ id: contentHash({ event, eventRefs }), text, sourceRefs: eventRefs });
      }
    }
    if (!units.length) throw new Error('没有可编译的小说剧情资料');
  }
  const fingerprint = contentHash({ source, units });
  return { id: crypto.randomUUID(), definitionId: options.definitionId ?? `plot-${contentHash(source.kind === 'novel' ? source.datasetId : source.text)}`, title, source, units, coverageGaps, sourceFingerprint: fingerprint, checkpoints: {}, status: 'queued', createdAt: Date.now(), updatedAt: Date.now() };
}

function stableDraft(draft: DirectorDraft): DirectorDraft {
  const chars = new Map(draft.characters.map(c => [c.id, `actor-${contentHash(c.name.normalize('NFKC').trim())}`]));
  const nodes = new Map(draft.nodes.map(n => [n.id, `event-${contentHash({ refs: [...n.sourceRefs].sort(), title: n.title })}`]));
  const stages = new Map(draft.stages.map(s => [s.id, `stage-${contentHash(s.nodeIds.map(id => nodes.get(id)).sort())}`]));
  return { ...draft, characters: draft.characters.map(c => ({ ...c, id: chars.get(c.id)! })), stages: draft.stages.map(s => ({ ...s, id: stages.get(s.id)!, nodeIds: s.nodeIds.map(id => nodes.get(id)!), ...(s.completion ? { completion: { mode: s.completion.mode, nodeIds: s.completion.nodeIds.map(id => nodes.get(id)!) } } : {}) })), nodes: draft.nodes.map(n => ({ ...n, id: nodes.get(n.id)!, stageId: stages.get(n.stageId)!, actorIds: n.actorIds.map(id => chars.get(id)!), dependsOn: n.dependsOn.map(id => nodes.get(id)!), conditions: n.conditions.map(c => ({ ...c, id: `condition-${contentHash([nodes.get(n.id), c.description])}` })) })) };
}

/**
 * 分批编译时同一个人物可能在两批里拿到不同的 id —— 最终身份本来就由规范名决定（见 stableDraft），
 * 这里在校验前把同一个人的多个 id 并成一个，避免因这种噪音让整批判失败。
 * 只处理「同一个人的身份噪音」：同一个 id 指向两个不同姓名属于真矛盾，原样退回校验报错。
 */
function normalizeCharacterIdentity(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  const characters = record.characters;
  const nodes = record.nodes;
  if (!Array.isArray(characters) || !Array.isArray(nodes)) return input;
  const readable = characters.filter((item): item is { id: string; name: string; aliases?: unknown } => (
    !!item && typeof item === 'object'
    && typeof (item as Record<string, unknown>).id === 'string'
    && typeof (item as Record<string, unknown>).name === 'string'
  ));
  if (readable.length !== characters.length) return input;
  const idMap = new Map<string, string>();
  const merged = new Map<string, { id: string; name: string; aliases: string[] }>();
  for (const character of readable) {
    const id = `actor-${contentHash(character.name.normalize('NFKC').trim())}`;
    const recorded = idMap.get(character.id);
    if (recorded !== undefined && recorded !== id) return input;
    idMap.set(character.id, id);
    // 别名只补「整个字段缺失」这种格式瑕疵；字段存在但类型不对仍旧交回校验。
    if (character.aliases !== undefined && (!Array.isArray(character.aliases) || character.aliases.some(alias => typeof alias !== 'string'))) return input;
    const aliases = Array.isArray(character.aliases) ? character.aliases : [];
    const existing = merged.get(id);
    if (existing) existing.aliases = [...new Set([...existing.aliases, ...aliases])];
    else merged.set(id, { id, name: character.name, aliases: [...new Set(aliases)] });
  }
  return {
    ...record,
    characters: [...merged.values()],
    nodes: nodes.map(node => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
      const item = node as Record<string, unknown>;
      if (!Array.isArray(item.actorIds)) return node;
      return { ...item, actorIds: [...new Set(item.actorIds.map(actorId => (typeof actorId === 'string' ? idMap.get(actorId) ?? actorId : actorId)))] };
    }),
  };
}

export async function compileDirectorDefinition(initial: DirectorCompileJob, options: { request: (input: DirectorCompileRequest) => Promise<string>; signal?: AbortSignal; onCheckpoint?: (job: DirectorCompileJob) => Promise<void>; mergeBatchSize?: number }): Promise<DirectorCompileJob> {
  const job = structuredClone(initial);
  if (job.sourceFingerprint !== contentHash({ source: job.source, units: job.units })) throw new Error('原始资料已改变，请创建新的编译任务');
  if (job.status === 'completed') return job;
  job.status = 'running'; delete job.error;
  const persist = async () => { job.updatedAt = Date.now(); await options.onCheckpoint?.(structuredClone(job)); };
  const checkAbort = () => { if (options.signal?.aborted) throw new DOMException('编译已取消', 'AbortError'); };
  const run = async (id: string, phase: 'extract' | 'merge', data: unknown, refs: string[]) => {
    checkAbort();
    if (job.checkpoints[id]) return validateDirectorDraft(job.checkpoints[id], refs);
    let repair: { previousOutput: string; validationError: string } | undefined;
    let draft: DirectorDraft | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await options.request({ phase, system: DEFINITION_COMPILER_SYSTEM, prompt: JSON.stringify({ phase, sourceRefs: refs, data, ...repair }), stream: false, signal: options.signal });
      checkAbort();
      try {
        const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
        const checked = validateDirectorDraft(normalizeCharacterIdentity(parsed), refs);
        if (phase === 'merge') {
          const required = (data as DirectorDraft[]).flatMap(d => d.nodes.flatMap(n => n.sourceRefs));
          const retained = new Set(checked.nodes.flatMap(n => n.sourceRefs));
          if (required.some(ref => !retained.has(ref))) throw new Error('合并遗漏已编译剧情来源');
        }
        draft = checked;
        break;
      } catch (error) {
        if (attempt === 1) throw error;
        repair = { previousOutput: raw, validationError: error instanceof Error ? error.message : String(error) };
      }
    }
    if (!draft) throw new Error('剧情整理未返回有效内容');
    job.checkpoints[id] = draft; await persist(); return draft;
  };
  try {
    await persist();
    let level: DirectorDraft[] = [];
    for (const unit of job.units) level.push(await run(`unit:${unit.id}`, 'extract', unit.text, unit.sourceRefs));
    const batchSize = Math.max(2, options.mergeBatchSize ?? 4);
    while (level.length > 1) {
      const next: DirectorDraft[] = [];
      for (let i = 0; i < level.length; i += batchSize) {
        const batch = level.slice(i, i + batchSize);
        if (batch.length === 1) { next.push(batch[0]!); continue; }
        next.push(await run(`merge:${contentHash(batch)}`, 'merge', batch, [...new Set(batch.flatMap(d => d.nodes.flatMap(n => n.sourceRefs)))]));
      }
      level = next;
    }
    const draft = stableDraft(level[0]!);
    draft.coverage.gaps = [...new Set([...draft.coverage.gaps, ...job.coverageGaps])];
    if (draft.coverage.gaps.length) draft.coverage.complete = false;
    validateDirectorDraft(draft, job.units.flatMap(u => u.sourceRefs));
    job.definition = { ...draft, schemaVersion: 1, id: job.definitionId, version: contentHash({ source: job.source, draft }), source: job.source, createdAt: Date.now(), editedByAuthor: false };
    job.status = 'completed';
  } catch (error) {
    job.status = options.signal?.aborted || (error instanceof Error && error.name === 'AbortError') ? 'cancelled' : 'failed';
    job.error = error instanceof Error ? error.message : String(error);
  }
  await persist(); return job;
}
