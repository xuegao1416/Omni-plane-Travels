import { v4 as uuid } from 'uuid';
import { extractNovelStaticMaterial } from './sourceImport';
import { splitNovelChapters } from './plainText';
import { buildNovelSegments, hashNovelText } from './segmentation';
import type { NovelChapter, NovelDataset, NovelEvent, NovelSegment, NovelEvidenceRef } from './types';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const list = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter(Boolean) : [];
const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
  ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown>[]
  : [];

function readEvent(raw: Record<string, unknown>): NovelEvent | null {
  const name = text(raw.事件名 ?? raw.name);
  const description = text(raw.事件说明 ?? raw.description);
  if (!name || !description) return null;
  const visibility: NovelEvent['visibility'] = raw.visibility === 'reader_only' ? 'reader_only'
    : raw.visibility && typeof raw.visibility === 'object' ? {
      knownBy: list((raw.visibility as Record<string, unknown>).knownBy),
      unknownTo: list((raw.visibility as Record<string, unknown>).unknownTo),
      readerOnly: (raw.visibility as Record<string, unknown>).readerOnly === true,
    }
    : raw.信息可见性 && typeof raw.信息可见性 === 'object'
    && (raw.信息可见性 as Record<string, unknown>).是否仅读者视角可见 === true
    ? 'reader_only'
    : 'public';
  return {
    ...(typeof raw.name === 'string' ? raw : {}),
    name,
    description,
    trigger: text(raw.trigger) || list(raw.触发条件 ?? raw.trigger).join('；') || undefined,
    result: text(raw.result) || list(raw.事件结果 ?? raw.result).join('；') || undefined,
    visibility,
  };
}

function readChapters(raw: Record<string, unknown>, datasetId: string): NovelChapter[] {
  return records(raw.章节列表 ?? raw.chapters).map((chapter, index) => ({
    ...(Array.isArray(raw.chapters) ? chapter : {}),
    id: text(chapter.id) || uuid(),
    datasetId,
    index: Math.max(0, Math.floor(chapter.序号 !== undefined
      ? (Number(chapter.序号) || index + 1) - 1
      : Number(chapter.index) || index)),
    title: text(chapter.标题 ?? chapter.title) || `第${index + 1}章`,
    content: text(chapter.内容 ?? chapter.content),
  })).sort((left, right) => left.index - right.index);
}

function readSegments(raw: Record<string, unknown>, chapters: NovelChapter[]): NovelSegment[] {
  const chapterByTitle = new Map(chapters.map(chapter => [chapter.title, chapter.id]));
  for (const segment of records(raw['分段列表'])) for (const title of list(segment['章节标题'])) {
    if (chapters.filter(chapter => chapter.title === title).length > 1) throw new Error(`章节标题 ${title} 对应多个章节，请使用唯一 chapterIds。`);
  }
  return records(raw.分段列表 ?? raw.segments).map((segment, index) => ({
    ...(Array.isArray(raw.segments) ? segment : {}),
    id: text(segment.id) || uuid(),
    index: Math.max(0, Math.floor(segment.组号 !== undefined
      ? (Number(segment.组号) || index + 1) - 1
      : Number(segment.index) || index)),
    title: text(segment.标题 ?? segment.title) || `第${index + 1}段`,
    chapterIds: list(segment.章节标题 ?? segment.chapterIds).map(value => chapterByTitle.get(value) ?? value),
    summary: text(segment.本组概括 ?? segment.summary ?? segment.原文摘要),
    hardConstraints: [...list(segment.hardConstraints), ...records(segment.原著硬约束 ?? segment.hardConstraints)
      .map(item => text(item.内容 ?? item.content)).filter(Boolean)],
    events: records(segment.关键事件 ?? segment.events).map(readEvent).filter(Boolean) as NovelEvent[],
    carryFacts: list(segment.前组延续事实 ?? segment.carryFacts),
    endingFacts: list(segment.本组结束状态 ?? segment.endingFacts),
    foreshadowing: [...list(segment.foreshadowing), ...records(segment.可提前铺垫 ?? segment.foreshadowing)
      .map(item => text(item.内容 ?? item.content)).filter(Boolean)],
  })).sort((left, right) => left.index - right.index);
}

/** Imports the source project's Chinese-keyed archive or the native dataset form. */
export function importNovelDataset(raw: unknown): NovelDataset {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  if ('worldBookEntries' in source || 'worldBook' in source) throw new Error('这是世界书或世界 JSON，请使用世界导入入口。');
  const chapterInput = source.chapters ?? source['章节列表'];
  const segmentInput = source.segments ?? source['分段列表'];
  for (const [key, value] of [['chapters', chapterInput], ['segments', segmentInput]] as const) {
    if (value !== undefined && (!Array.isArray(value) || value.some(item => !item || typeof item !== 'object' || Array.isArray(item)))) throw new Error(`${key}: 必须是对象数组。`);
  }
  if (Array.isArray(chapterInput)) for (const [index, row] of chapterInput.entries()) {
    const content = row.content ?? row['内容'];
    if (typeof content !== 'string') throw new Error(`chapters.${index}.content: 必须是正文字符串。`);
    const order = row.index ?? (row['序号'] === undefined ? undefined : Number(row['序号']) - 1);
    if (order !== undefined && (!Number.isInteger(order) || order < 0)) throw new Error(`chapters.${index}.index: 必须是非负整数。`);
  }
  if (Array.isArray(segmentInput)) for (const [index, row] of segmentInput.entries()) {
    const refs = row.chapterIds ?? row['章节标题'];
    if (refs !== undefined && (!Array.isArray(refs) || refs.some(item => typeof item !== 'string'))) throw new Error(`segments.${index}.chapterIds: 必须是章节引用数组。`);
    if (row.index !== undefined && (!Number.isInteger(row.index) || row.index < 0)) throw new Error(`segments.${index}.index: 必须是非负整数。`);
  }
  if (source.schemaVersion !== undefined && (!Number.isInteger(source.schemaVersion) || Number(source.schemaVersion) < 1 || Number(source.schemaVersion) > 3)) throw new Error('schemaVersion: 不支持的数据版本。');
  if (source.staticMaterial !== undefined && (!source.staticMaterial || typeof source.staticMaterial !== 'object' || Array.isArray(source.staticMaterial))) throw new Error('staticMaterial: 必须是资料对象。');
  const now = Date.now();
  const id = text(source.id) || uuid();
  const rawTextValue = source.原始文本 ?? source.rawText;
  if (rawTextValue !== undefined && typeof rawTextValue !== 'string') throw new Error('rawText: 必须是字符串。');
  const rawText = typeof rawTextValue === 'string' ? rawTextValue : '';
  const importedChapters = readChapters(source, id);
  // Preserve native whitespace; evidence offsets refer to the original string.
  if (Array.isArray(chapterInput)) for (const chapter of importedChapters) {
    const original = chapterInput.find(row => row.id === chapter.id) ?? chapterInput[chapter.index];
    if (original) chapter.content = original.content ?? original['内容'];
  }
  const chapters = importedChapters.length > 0 ? importedChapters : splitNovelChapters(rawText, id);
  const importedSegments = readSegments(source, chapters);
  const material = extractNovelStaticMaterial(source);
  const hasMaterial = Object.entries(material).some(([key, value]) => key !== 'summary'
    ? (Array.isArray(value) ? value.length > 0 : typeof value === 'string' ? value.trim().length > 0 : value && typeof value === 'object' && Object.keys(value).length > 0)
    : typeof value === 'string' && value.trim().length > 0 && Boolean(source.staticMaterial || source['世界背景'] || source['世界概述']));
  if (!rawText && !chapters.length && !importedSegments.length && !hasMaterial) throw new Error('未发现小说原文、章节、剧情或静态资料，不能导入为空数据集。');
  for (const [label, rows] of [['chapters', chapters], ['segments', importedSegments]] as const) {
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error(`${label}.id: 存在重复 ID。`);
    if (new Set(rows.map(row => row.index)).size !== rows.length) throw new Error(`${label}.index: 存在重复顺序。`);
  }
  const chapterIds = new Set(chapters.map(chapter => chapter.id));
  for (const segment of importedSegments) {
    segment.datasetId = id;
    if (segment.chapterIds.some(chapterId => !chapterIds.has(chapterId))) throw new Error(`segments.${segment.id}.chapterIds: 引用了不存在的章节。`);
  }
  const version = text(source.sourceVersion) || hashNovelText(chapters.map(chapter => `${chapter.id}\n${chapter.content}`).join('\n'));
  const sourceVerified = source.sourceVerified === true && Boolean(source.sourceVersion) && Boolean(source.analysisVersion);
  const issues: NonNullable<NovelDataset['importIssues']> = Array.isArray(source.importIssues)
    ? (source.importIssues as NonNullable<NovelDataset['importIssues']>).filter(issue => issue && typeof issue.code === 'string' && typeof issue.message === 'string') : [];
  if (!sourceVerified) issues.push({ code: 'legacy_unverified', severity: 'warning', message: '导入资料缺少已验证的来源版本；已有结果保留，重跑时将核验原文。' });
  if (!chapters.length) issues.push({ code: 'source_unavailable', severity: 'warning', message: '资料不含原文，可创建资料世界，不能重跑原文分析。' });
  const knownKeys = new Set(['id', '标题', '作品名', '原始文本', '章节列表', '分段列表', '世界背景', '世界概述', '世界边界说明', '世界观规则', '力量体系', '文化习俗', '势力档案', '角色档案', '地图地点档案', '势力关系', '人物关系']);
  const extraChineseFields = Object.fromEntries(Object.entries(source).filter(([key]) => /[\u3400-\u9fff]/.test(key) && !knownKeys.has(key)));
  if (Object.keys(extraChineseFields).length) issues.push({ code: 'unmapped_fields', severity: 'warning', message: `部分字段保留在导入元数据中：${Object.keys(extraChineseFields).join('、')}` });
  const result: NovelDataset = {
    ...source as unknown as NovelDataset,
    id,
    title: text(source.标题 ?? source.title ?? source.作品名) || '未命名小说',
    sourceType: source.sourceType === 'epub' || source.sourceType === 'structured' || source.sourceType === 'txt'
      ? source.sourceType : rawText || chapters.length > 0 ? 'txt' : 'structured',
    schemaVersion: Number(source.schemaVersion) || 2,
    sourceVersion: version,
    sourceVerified,
    importIssues: issues,
    importMetadata: { ...(source.importMetadata && typeof source.importMetadata === 'object' ? source.importMetadata as Record<string, unknown> : {}), ...extraChineseFields },
    analysisVersion: Number(source.analysisVersion) || 1,
    overviewInputHash: text(source.overviewInputHash) || undefined,
    analysisStatus: ['draft', 'processing', 'ready', 'partial', 'failed'].includes(String(source.analysisStatus))
      ? source.analysisStatus as NovelDataset['analysisStatus'] : 'draft',
    rawTextLength: rawText.length || Number(source.rawTextLength) || chapters.reduce((sum, chapter) => sum + chapter.content.length, 0),
    ...(rawText ? { rawText } : {}),
    chapters: chapters.map(chapter => ({ ...chapter, sourceVersion: chapter.sourceVersion || version, contentHash: hashNovelText(chapter.content) })),
    staticMaterial: material,
    segments: importedSegments.length > 0 ? importedSegments : buildNovelSegments(id, chapters),
    createdAt: Number(source.createdAt) || now,
    updatedAt: now,
  };
  const invalidRefs: unknown[] = [];
  const validateRefs = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(validateRefs);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (key !== 'evidenceRefs' || !Array.isArray(item)) return [key, validateRefs(item)];
      return [key, item.flatMap((rawRef: NovelEvidenceRef) => {
        const chapter = rawRef && chapters.find(chapter => chapter.id === rawRef.chapterId);
        if (!chapter || typeof rawRef.excerpt !== 'string' || !rawRef.excerpt) { invalidRefs.push(rawRef); return []; }
        const start = rawRef.chapterStartOffset ?? rawRef.startOffset - (chapter.startOffset ?? 0);
        const end = rawRef.chapterEndOffset ?? rawRef.endOffset - (chapter.startOffset ?? 0);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || chapter.content.slice(start, end) !== rawRef.excerpt) {
          invalidRefs.push(rawRef); return [];
        }
        return [{ ...rawRef, chapterStartOffset: start, chapterEndOffset: end,
          sourceVersion: chapter.sourceVersion || version }];
      })];
    }));
  };
  const checked = validateRefs(result) as NovelDataset;
  if (invalidRefs.length) {
    checked.sourceVerified = false;
    checked.importIssues = [...issues, { code: 'invalid_evidence', severity: 'error', message: `${invalidRefs.length} 条引用无法匹配原文，已移出有效证据并保留在导入问题资料中。` }];
    checked.importMetadata = { ...checked.importMetadata, invalidEvidenceRefs: invalidRefs };
  }
  return checked;
}

/** Clone IDs only in identity/reference fields; never replace strings in novel prose. */
export function copyNovelDataset(dataset: NovelDataset): NovelDataset {
  const copy = structuredClone(dataset);
  const ids = new Map<string, string>([[dataset.id, uuid()]]);
  for (const chapter of dataset.chapters) ids.set(chapter.id, uuid());
  for (const segment of dataset.segments) ids.set(segment.id, uuid());
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (['id', 'datasetId', 'chapterId', 'segmentId', 'currentSegmentId'].includes(key) && typeof item === 'string') return [key, ids.get(item) ?? item];
      if (['chapterIds', 'segmentIds'].includes(key) && Array.isArray(item)) return [key, item.map(id => typeof id === 'string' ? ids.get(id) ?? id : id)];
      return [key, visit(item)];
    }));
  };
  const result = visit(copy) as NovelDataset;
  // Identity participates in model inputs. Keep reviewed outputs, invalidate caches.
  result.overviewInputHash = undefined;
  result.overviewCheckpoints = undefined;
  result.segments = result.segments.map(segment => ({ ...segment, evidenceInputHash: undefined, analysisInputHash: undefined,
    inputHash: segment.sourceText ? hashNovelText(`${segment.chapterIds.join('|')}\n${segment.sourceText}`) : undefined,
    status: segment.status === 'processing' ? 'pending' : segment.status }));
  result.createdAt = Date.now();
  result.updatedAt = result.createdAt;
  return result;
}
