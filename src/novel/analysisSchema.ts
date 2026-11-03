import { z } from 'zod';
import type {
  NovelChapter,
  NovelEvidenceNote,
  NovelEvidenceRef,
  NovelEvent,
  NovelHardConstraint,
  NovelCharacterProgress,
  NovelStaticMaterial,
} from './types';

function coerceModelText(value: unknown): unknown {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const preferredKeys = [
    'name', 'characterName', 'factionName', 'locationName', 'itemName', 'title',
    'content', 'fact', 'text', 'description', 'summary',
    '名称', '角色名', '势力名', '地点名', '物品名', '标题', '内容', '事实', '说明', '描述', '文本',
  ];
  for (const key of preferredKeys) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key];
  }
  return Object.values(record).filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join('；');
}

const modelTextSchema = z.preprocess(coerceModelText, z.string());
const stringListSchema = z.preprocess(
  value => Array.isArray(value) ? value.map(coerceModelText) : value,
  z.array(modelTextSchema).optional().default([]),
);
const visibilityObjectSchema = z.object({
  knownBy: stringListSchema,
  unknownTo: stringListSchema,
  readerOnly: z.boolean().optional().default(false),
});
function coerceVisibility(value: unknown): unknown {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return {
      knownBy: [],
      unknownTo: [],
      readerOnly: /reader[_ -]?only|仅读者|仅读者|读者视角/.test(normalized),
    };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const rawReaderOnly = record.readerOnly ?? record.reader_only ?? record['是否仅读者视角可见'];
  return {
    knownBy: record.knownBy ?? record.known_by ?? record['已知者'] ?? [],
    unknownTo: record.unknownTo ?? record.unknown_to ?? record['未知者'] ?? [],
    readerOnly: rawReaderOnly === true || (typeof rawReaderOnly === 'string' && /true|yes|仅读者|仅读者|reader[_ -]?only/i.test(rawReaderOnly)),
  };
}
const visibilitySchema = z.preprocess(
  coerceVisibility,
  visibilityObjectSchema.optional().default({ knownBy: [], unknownTo: [], readerOnly: false }),
);

const evidenceRefSchema = z.object({
  chapterId: z.string().trim().min(1).optional(),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().nonnegative().optional(),
  excerpt: z.string().trim().min(1).optional(),
  confidence: z.enum(['explicit', 'strong_inference', 'weak_inference']).optional().default('explicit'),
}).catch({ confidence: 'weak_inference' });

const eventSchema = z.object({
  name: modelTextSchema.optional().default(''),
  description: modelTextSchema.optional().default(''),
  startTime: modelTextSchema.optional(),
  earliestStartTime: modelTextSchema.optional(),
  latestStartTime: modelTextSchema.optional(),
  endTime: modelTextSchema.optional(),
  prerequisites: stringListSchema,
  triggers: stringListSchema,
  blockers: stringListSchema,
  results: stringListSchema,
  nextImpact: stringListSchema,
  visibility: visibilitySchema,
  evidenceRefs: z.array(evidenceRefSchema).optional().default([]),
});

const namedArchiveSchema = z.object({
  name: modelTextSchema.pipe(z.string().trim().min(1)),
  description: modelTextSchema.pipe(z.string().trim().min(1)),
  aliases: stringListSchema,
  details: stringListSchema,
  role: modelTextSchema.optional(),
  evidenceRefs: z.array(evidenceRefSchema).optional().default([]),
});

export const novelEvidenceNoteSchema = z.object({
  summary: modelTextSchema.optional().default(''),
  facts: stringListSchema,
  characters: stringListSchema,
  factions: stringListSchema,
  locations: stringListSchema,
  items: stringListSchema,
  events: z.array(eventSchema).optional().default([]),
  rules: stringListSchema,
  relationships: stringListSchema,
  openThreads: stringListSchema,
  evidenceRefs: z.array(evidenceRefSchema).optional().default([]),
  staticFindings: z.object({
    settings: stringListSchema, rules: stringListSchema, culture: stringListSchema,
    powerSystem: stringListSchema, economy: stringListSchema, time: stringListSchema,
  }).optional(),
  archives: z.object({
    characters: z.array(namedArchiveSchema).optional().default([]),
    factions: z.array(namedArchiveSchema).optional().default([]),
    locations: z.array(namedArchiveSchema).optional().default([]),
    items: z.array(namedArchiveSchema).optional().default([]),
  }).optional(),
});

export const novelOverviewSchema = z.object({
  summary: modelTextSchema.optional().default(''),
  settings: stringListSchema,
  rules: stringListSchema,
  powerSystem: modelTextSchema.optional(),
  factions: z.array(namedArchiveSchema).optional().default([]),
  characters: z.array(namedArchiveSchema).optional().default([]),
  locations: z.array(namedArchiveSchema).optional().default([]),
  items: z.array(namedArchiveSchema).optional().default([]),
  relations: stringListSchema,
  culture: stringListSchema,
  highlights: stringListSchema,
  economy: z.object({
    currencyName: modelTextSchema.optional(),
    currencySymbol: modelTextSchema.optional(),
    currencyDescription: modelTextSchema.optional(),
    priceLevel: modelTextSchema.optional(),
    calendar: modelTextSchema.optional(),
    startTime: modelTextSchema.optional(),
    timeSpeed: modelTextSchema.optional(),
  }).optional(),
});

const hardConstraintSchema = z.object({
  content: modelTextSchema.pipe(z.string().trim().min(1)),
  visibility: visibilitySchema,
  confidence: z.enum(['explicit', 'strong_inference', 'weak_inference']).optional().default('explicit'),
  evidenceRefs: z.array(evidenceRefSchema).optional().default([]),
});

const characterProgressSchema = z.object({
  characterName: modelTextSchema.pipe(z.string().trim().min(1)),
  before: stringListSchema,
  changes: stringListSchema,
  after: stringListSchema,
  nextImpact: stringListSchema,
  evidenceRefs: z.array(evidenceRefSchema).optional().default([]),
});

export const novelSegmentAnalysisSchema = z.object({
  summary: z.string().optional().default(''),
  openingFacts: stringListSchema,
  carryFacts: stringListSchema,
  endingFacts: stringListSchema,
  nextReference: stringListSchema,
  hardConstraints: z.array(hardConstraintSchema).optional().default([]),
  foreshadowing: stringListSchema,
  events: z.array(eventSchema).optional().default([]),
  characterProgress: z.array(characterProgressSchema).optional().default([]),
  worldRules: stringListSchema,
  relationships: stringListSchema,
  timelineStart: z.string().optional().default(''),
  timelineEnd: z.string().optional().default(''),
  evidenceRefs: z.array(evidenceRefSchema).optional().default([]),
});

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

function parseJsonObject(response: string): unknown {
  const withoutThinking = String(response ?? '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
  const fenced = withoutThinking.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? withoutThinking).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 没有返回 JSON 对象');
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (error) {
    throw new Error(`AI 返回的 JSON 无法解析：${error instanceof Error ? error.message : '格式错误'}`);
  }
}

function normalizeEvidence(items: z.infer<typeof evidenceRefSchema>[], sourceChapters?: NovelChapter[]): NovelEvidenceRef[] {
  const normalized: NovelEvidenceRef[] = [];
  for (const item of items) {
    if (!item.chapterId || !item.excerpt?.trim()) continue;
    const excerpt = item.excerpt.trim();
    let { startOffset, endOffset } = item;
    if (sourceChapters) {
      const chapter = sourceChapters.find(source => source.id === item.chapterId);
      if (!chapter) continue;
      const position = chapter.content.indexOf(excerpt);
      // A unique literal quote provides an auditable location without model arithmetic.
      if (position < 0 || chapter.content.indexOf(excerpt, position + 1) >= 0) continue;
      startOffset = (chapter.startOffset ?? 0) + position;
      endOffset = startOffset + excerpt.length;
    }
    if (startOffset === undefined || endOffset === undefined || endOffset <= startOffset) continue;
    const sourceChapter = sourceChapters?.find(source => source.id === item.chapterId);
    normalized.push({
      chapterId: item.chapterId,
      startOffset,
      endOffset,
      excerpt,
      confidence: item.confidence,
      ...(sourceChapter ? { chapterStartOffset: startOffset - (sourceChapter.startOffset ?? 0), chapterEndOffset: endOffset - (sourceChapter.startOffset ?? 0), sourceVersion: sourceChapter.sourceVersion } : {}),
    });
  }
  return normalized;
}

function normalizeEvent(item: z.infer<typeof eventSchema>, sourceChapters?: NovelChapter[]): NovelEvent | null {
  const name = item.name.trim();
  const description = item.description.trim();
  if (!name || !description) return null;
  return {
    name,
    description,
    ...(item.startTime?.trim() ? { startTime: item.startTime.trim() } : {}),
    ...(item.earliestStartTime?.trim() ? { earliestStartTime: item.earliestStartTime.trim() } : {}),
    ...(item.latestStartTime?.trim() ? { latestStartTime: item.latestStartTime.trim() } : {}),
    ...(item.endTime?.trim() ? { endTime: item.endTime.trim() } : {}),
    prerequisites: unique(item.prerequisites),
    trigger: unique(item.triggers).join('；') || undefined,
    blockers: unique(item.blockers),
    result: unique(item.results).join('；') || undefined,
    nextImpact: unique(item.nextImpact),
    visibility: {
      knownBy: unique(item.visibility.knownBy),
      unknownTo: unique(item.visibility.unknownTo),
      readerOnly: item.visibility.readerOnly,
    },
    evidenceRefs: normalizeEvidence(item.evidenceRefs, sourceChapters),
  };
}

function parsed<T>(schema: z.ZodType<T>, response: string): T {
  const result = schema.safeParse(parseJsonObject(response));
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`AI 拆解结果不符合结构：${issue?.path.join('.') || 'root'} ${issue?.message || ''}`.trim());
  }
  return result.data;
}

export function parseNovelEvidenceNoteResponse(response: string, sourceChapters?: NovelChapter[]): NovelEvidenceNote {
  const data = parsed(novelEvidenceNoteSchema, response);
  return {
    summary: data.summary.trim(),
    facts: unique(data.facts),
    characters: unique(data.characters),
    factions: unique(data.factions),
    locations: unique(data.locations),
    items: unique(data.items),
    events: data.events.map(item => normalizeEvent(item, sourceChapters)).filter(Boolean) as NovelEvent[],
    rules: unique(data.rules),
    relationships: unique(data.relationships),
    openThreads: unique(data.openThreads),
    evidenceRefs: normalizeEvidence(data.evidenceRefs, sourceChapters),
    ...(data.staticFindings ? { staticFindings: data.staticFindings } : {}),
    ...(data.archives ? { archives: Object.fromEntries(Object.entries(data.archives).map(([category, entries]) => [category, entries.map(entry => ({ ...entry, evidenceRefs: normalizeEvidence(entry.evidenceRefs, sourceChapters) }))])) } : {}),
  };
}

export function parseNovelOverviewResponse(response: string): NovelStaticMaterial {
  const data = parsed(novelOverviewSchema, response);
  return {
    summary: data.summary.trim(),
    settings: unique(data.settings),
    rules: unique(data.rules),
    powerSystem: data.powerSystem?.trim() || undefined,
    factions: data.factions.map(item => ({ name: item.name, description: item.description, aliases: unique(item.aliases), details: unique(item.details) })),
    characters: data.characters.map(item => ({ name: item.name, description: item.description, aliases: unique(item.aliases), details: unique(item.details), role: item.role?.trim() || undefined })),
    locations: data.locations.map(item => ({ name: item.name, description: item.description, aliases: unique(item.aliases), details: unique(item.details) })),
    items: data.items.map(item => ({ name: item.name, description: item.description, aliases: unique(item.aliases), details: unique(item.details) })),
    relations: unique(data.relations),
    culture: unique(data.culture),
    highlights: unique(data.highlights),
    ...(data.economy ? { economy: {
      currencyName: data.economy.currencyName?.trim() || undefined,
      currencySymbol: data.economy.currencySymbol?.trim() || undefined,
      currencyDescription: data.economy.currencyDescription?.trim() || undefined,
      priceLevel: data.economy.priceLevel?.trim() || undefined,
      calendar: data.economy.calendar?.trim() || undefined,
      startTime: data.economy.startTime?.trim() || undefined,
      timeSpeed: data.economy.timeSpeed?.trim() || undefined,
    } } : {}),
  };
}

export interface ParsedNovelSegmentAnalysis {
  summary: string;
  openingFacts: string[];
  carryFacts: string[];
  endingFacts: string[];
  nextReference: string[];
  hardConstraints: string[];
  constraintDetails: NovelHardConstraint[];
  foreshadowing: string[];
  events: NovelEvent[];
  characterProgress: NovelCharacterProgress[];
  worldRules: string[];
  relationships: string[];
  timelineStart: string;
  timelineEnd: string;
  evidenceRefs: NovelEvidenceRef[];
}

export function parseNovelSegmentAnalysisResponse(response: string, sourceChapters?: NovelChapter[]): ParsedNovelSegmentAnalysis {
  const data = parsed(novelSegmentAnalysisSchema, response);
  const constraints: NovelHardConstraint[] = data.hardConstraints
    .filter(item => item.confidence !== 'weak_inference'
      && normalizeEvidence(item.evidenceRefs, sourceChapters).some(ref => ref.confidence !== 'weak_inference'))
    .map(item => ({
      content: item.content.trim(),
      visibility: {
        knownBy: unique(item.visibility.knownBy),
        unknownTo: unique(item.visibility.unknownTo),
        readerOnly: item.visibility.readerOnly,
      },
      confidence: item.confidence,
      evidenceRefs: normalizeEvidence(item.evidenceRefs, sourceChapters),
    }));
  return {
    summary: data.summary.trim(),
    openingFacts: unique(data.openingFacts),
    carryFacts: unique(data.carryFacts),
    endingFacts: unique(data.endingFacts),
    nextReference: unique(data.nextReference),
    hardConstraints: constraints.map(item => item.content),
    constraintDetails: constraints,
    foreshadowing: unique(data.foreshadowing),
    events: data.events.map(item => normalizeEvent(item, sourceChapters)).filter(Boolean) as NovelEvent[],
    characterProgress: data.characterProgress.map(item => ({
      characterName: item.characterName,
      before: unique(item.before),
      changes: unique(item.changes),
      after: unique(item.after),
      nextImpact: unique(item.nextImpact),
      evidenceRefs: normalizeEvidence(item.evidenceRefs, sourceChapters),
    })),
    worldRules: unique(data.worldRules),
    relationships: unique(data.relationships),
    timelineStart: data.timelineStart.trim(),
    timelineEnd: data.timelineEnd.trim(),
    evidenceRefs: normalizeEvidence(data.evidenceRefs, sourceChapters),
  };
}
