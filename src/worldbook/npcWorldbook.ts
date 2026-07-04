// ═══════════════════════════════════════════════════════════════
//  NPC 世界书系统
//  功能：从 NPC 变量数据生成世界书条目、人物书去重
// ═══════════════════════════════════════════════════════════════

export const CHARACTER_WORLDBOOK_SPECIAL_KEYWORD = '人物书专用';

// ─── 工具函数 ─────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pickFirstText(...values: unknown[]): string {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
  }
  return '';
}

function cloneSerializable<T>(value: T, fallback: T | null = null): T | null {
  if (value === undefined) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function uniqueList(list: string[] = []): string[] {
  return Array.from(new Set(
    (Array.isArray(list) ? list : [])
      .map(item => String(item ?? '').trim())
      .filter(Boolean)
  ));
}

// ─── 关键词规范化 ─────────────────────────────────────

export function normalizeCharacterWorldBookKeywords(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueList(value.map(item => String(item ?? '').trim()));
  }
  if (typeof value === 'string') {
    return uniqueList(value.split(/\r?\n|[,，|｜]/));
  }
  return [];
}

// ─── 名称匹配 ─────────────────────────────────────────

export function normalizeCharacterMatchName(name = ''): string {
  return String(name || '')
    .trim()
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, '');
}

export function isCharacterNameMatched(sourceName = '', targetName = ''): boolean {
  const source = normalizeCharacterMatchName(sourceName);
  const target = normalizeCharacterMatchName(targetName);
  if (!source || !target) return false;
  return source.includes(target) || target.includes(source);
}

// ─── TOON 格式构建 ─────────────────────────────────────

function normalizeScalarValue(value: unknown): string {
  if (value === undefined || value === null) return '无';
  if (typeof value === 'string') return value.trim() || '无';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.length === 0 ? '[]' : '列表';
  if (isPlainObject(value)) return '对象';
  return String(value);
}

function appendToonLines(
  lines: string[],
  value: unknown,
  label = '',
  depth = 0,
  visited: WeakSet<object> = new WeakSet(),
): void {
  const indent = '  '.repeat(depth);
  const safeLabel = String(label || '').trim();

  if (value === undefined || value === null) {
    if (safeLabel) lines.push(`${indent}${safeLabel}: 无`);
    return;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (safeLabel) {
      lines.push(`${indent}${safeLabel}: ${normalizeScalarValue(value)}`);
    } else {
      lines.push(`${indent}${normalizeScalarValue(value)}`);
    }
    return;
  }

  if (Array.isArray(value)) {
    if (safeLabel) lines.push(`${indent}${safeLabel}:`);
    if (value.length === 0) {
      lines.push(`${indent}${safeLabel ? '  ' : ''}- 无`);
      return;
    }
    value.forEach((item, index) => {
      const itemIndent = '  '.repeat(safeLabel ? depth + 1 : depth);
      if (item === undefined || item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
        lines.push(`${itemIndent}- ${normalizeScalarValue(item)}`);
        return;
      }
      if (Array.isArray(item)) {
        lines.push(`${itemIndent}- 列表项${index + 1}:`);
        appendToonLines(lines, item, '', safeLabel ? depth + 2 : depth + 1, visited);
        return;
      }
      if (isPlainObject(item)) {
        lines.push(`${itemIndent}- 条目${index + 1}:`);
        Object.entries(item).forEach(([childKey, childValue]) => {
          appendToonLines(lines, childValue, childKey, safeLabel ? depth + 2 : depth + 1, visited);
        });
        return;
      }
      lines.push(`${itemIndent}- ${normalizeScalarValue(item)}`);
    });
    return;
  }

  if (isPlainObject(value)) {
    if (visited.has(value)) {
      if (safeLabel) {
        lines.push(`${indent}${safeLabel}: [循环引用]`);
      } else {
        lines.push(`${indent}[循环引用]`);
      }
      return;
    }
    visited.add(value);
    if (safeLabel) lines.push(`${indent}${safeLabel}:`);
    const entries = Object.entries(value);
    if (entries.length === 0) {
      lines.push(`${indent}${safeLabel ? '  ' : ''}[空对象]`);
      visited.delete(value);
      return;
    }
    entries.forEach(([childKey, childValue]) => {
      appendToonLines(lines, childValue, childKey, safeLabel ? depth + 1 : depth, visited);
    });
    visited.delete(value);
    return;
  }

  if (safeLabel) {
    lines.push(`${indent}${safeLabel}: ${String(value)}`);
  }
}

// ─── 人物摘要规范化 ─────────────────────────────────────

export interface CharacterWorldBookSummary {
  name: string;
  race: string;
  category: string;
  title: string;
  job: string;
  level: string;
  gender: string;
  age: string;
  adventureRank: string;
}

export function normalizeCharacterWorldBookSummary(summary: Record<string, unknown> = {}): CharacterWorldBookSummary {
  const safeSummary = isPlainObject(summary) ? summary : {};
  return {
    name: pickFirstText(safeSummary.name, safeSummary.姓名, safeSummary.characterName) || '未知人物',
    race: pickFirstText(safeSummary.race, safeSummary.种族, safeSummary.characterRace) || '未知种族',
    category: pickFirstText(safeSummary.category, safeSummary.人物分类, safeSummary.characterCategory) || '在场',
    title: pickFirstText(safeSummary.title, safeSummary.称号),
    job: pickFirstText(safeSummary.job, safeSummary.职业),
    level: pickFirstText(safeSummary.level, safeSummary.等级),
    gender: pickFirstText(safeSummary.gender, safeSummary.性别),
    age: pickFirstText(safeSummary.age, safeSummary.年龄),
    adventureRank: pickFirstText(safeSummary.adventureRank, safeSummary.冒险等级),
  };
}

// ─── TOON 构建 ─────────────────────────────────────────

export function buildCharacterWorldBookToon(
  characterData: Record<string, unknown> | null,
  summary: Record<string, unknown> = {},
): string {
  const safeSummary = normalizeCharacterWorldBookSummary(summary);
  const baseCharacter = isPlainObject(characterData)
    ? cloneSerializable(characterData, {}) ?? {}
    : {};

  // 补充缺失字段
  if (!baseCharacter.姓名 && safeSummary.name) baseCharacter.姓名 = safeSummary.name;
  if (!baseCharacter.种族 && safeSummary.race) baseCharacter.种族 = safeSummary.race;
  if (!baseCharacter.人物分类 && safeSummary.category) baseCharacter.人物分类 = safeSummary.category;
  if (!baseCharacter.称号 && safeSummary.title) baseCharacter.称号 = safeSummary.title;
  if (!baseCharacter.职业 && safeSummary.job) baseCharacter.职业 = safeSummary.job;
  if (!baseCharacter.等级 && safeSummary.level) baseCharacter.等级 = safeSummary.level;
  if (!baseCharacter.性别 && safeSummary.gender) baseCharacter.性别 = safeSummary.gender;
  if (!baseCharacter.年龄 && safeSummary.age) baseCharacter.年龄 = safeSummary.age;
  if (!baseCharacter.冒险等级 && safeSummary.adventureRank) baseCharacter.冒险等级 = safeSummary.adventureRank;

  const lines = [`## NPC(${safeSummary.name})`];
  Object.entries(baseCharacter).forEach(([key, value]) => {
    appendToonLines(lines, value, key, 1);
  });

  return lines.join('\n');
}

// ─── 世界书条目草稿构建 ─────────────────────────────────────

export interface CharacterWorldBookEntryDraft {
  comment: string;
  keywords: string[];
  content: string;
  toon: string;
  summary: CharacterWorldBookSummary;
}

function buildLocalCharacterWorldBookBody(summary: CharacterWorldBookSummary): string {
  const lines = [
    `该条目记录人物"${summary.name}"的稳定设定信息，适合在剧情涉及该人物时补充背景。`,
    `姓名：${summary.name}`,
    `种族：${summary.race}`,
    `人物分类：${summary.category}`,
  ];
  if (summary.title) lines.push(`称号：${summary.title}`);
  if (summary.job) lines.push(`职业：${summary.job}`);
  if (summary.level) lines.push(`等级：${summary.level}`);
  if (summary.adventureRank) lines.push(`冒险等级：${summary.adventureRank}`);
  if (summary.gender) lines.push(`性别：${summary.gender}`);
  if (summary.age) lines.push(`年龄：${summary.age}`);
  return lines.join('\n');
}

function sanitizeGeneratedWorldBookContent(text = ''): string {
  let result = String(text || '').trim();
  result = result.replace(/^\s*```(?:json|markdown|md|text)?/i, '').replace(/```\s*$/i, '').trim();
  result = result.replace(/^内容[:：]\s*/i, '').trim();
  result = result.replace(/^正文[:：]\s*/i, '').trim();
  result = result.replace(/^条目正文[:：]\s*/i, '').trim();
  return result;
}

function buildWorldBookMetaBlock(summary: CharacterWorldBookSummary, method = 'local'): string {
  const methodLabel = method === 'api' ? 'API整理' : '本地模板';
  return [
    '### 人物书条目元信息',
    `${CHARACTER_WORLDBOOK_SPECIAL_KEYWORD}: 是`,
    `人物姓名: ${summary.name}`,
    `人物种族: ${summary.race}`,
    `提取方式: ${methodLabel}`,
  ].join('\n');
}

function buildLocalDefaultKeywords(summary: CharacterWorldBookSummary): string[] {
  return uniqueList([
    summary.name,
    summary.race,
    summary.title,
    summary.job,
    summary.category,
    summary.adventureRank,
    CHARACTER_WORLDBOOK_SPECIAL_KEYWORD,
  ]);
}

export function buildCharacterWorldBookEntryDraft({
  summary = {},
  characterData = null,
  generatedKeywords = [],
  generatedContent = '',
  method = 'local',
}: {
  summary?: Record<string, unknown>;
  characterData?: Record<string, unknown> | null;
  generatedKeywords?: string[];
  generatedContent?: string;
  method?: 'local' | 'api';
} = {}): CharacterWorldBookEntryDraft {
  const safeSummary = normalizeCharacterWorldBookSummary(summary);
  const toon = buildCharacterWorldBookToon(characterData, safeSummary as unknown as Record<string, unknown>);
  const contentBody = sanitizeGeneratedWorldBookContent(generatedContent) || buildLocalCharacterWorldBookBody(safeSummary);
  const keywords = uniqueList([
    ...normalizeCharacterWorldBookKeywords(generatedKeywords),
    ...buildLocalDefaultKeywords(safeSummary),
    safeSummary.name,
    safeSummary.race,
    CHARACTER_WORLDBOOK_SPECIAL_KEYWORD,
  ]);

  const contentSections = [
    buildWorldBookMetaBlock(safeSummary, method),
    '',
    '### 人物详情',
    contentBody,
  ];

  if (method === 'local' && toon) {
    contentSections.push('', '### 完整 TOON 变量', toon);
  }

  const content = contentSections.join('\n').trim();

  return {
    comment: `${safeSummary.name} · 人物书`,
    keywords,
    content,
    toon,
    summary: safeSummary,
  };
}

// ─── AI 提取 Prompt ─────────────────────────────────────

export function getDefaultNpcWorldBookExtractPrompt(): string {
  return [
    '你是中文人物档案整理器。',
    '这是信息整理任务，不是摘要任务，不是精简任务。你的目标是根据下方人物资料，整理出适合写入世界书的长期稳定信息；不要为了简短而删掉明确存在的重要设定。',
    '',
    '人物姓名：{{npcName}}',
    '人物种族：{{npcRace}}',
    '',
    '完整 TOON 变量：',
    '{{npcToon}}',
    '',
    '请在完整阅读上方资料后，严格按以下要求输出：',
    '1. 只输出 JSON 对象，不要 Markdown，不要解释，不要前言。',
    '2. JSON 结构固定为：{"keywords":["关键词1","关键词2"],"content":"人物详情正文"}。',
    '3. keywords 只保留与该人物强相关、能稳定命中的关键词，建议 4 到 12 个。',
    '4. content 不是精简摘要，而是基于已给资料做信息整理。应尽量保留明确存在的长期有效信息，例如身份、外貌、穿着、性格、背景、能力、关系、当前行动、长期目标等。',
    '5. 不要杜撰缺失信息；没有明确依据的内容不要补写。',
    '6. 不要只返回关键词数组，不要只返回一个字段；keywords 和 content 两个字段都必须存在，content 必须是非空字符串。',
    '7. 不要输出数组，不要输出 entries，不要输出 name、comment、lorebook、summary、description 等其他字段。',
    '8. 不要把输出写成第一人称，不要写"以下是""整理如下"之类前言。',
  ].join('\n');
}

export function renderNpcWorldBookExtractPrompt(
  template = '',
  { npcName = '', npcRace = '', npcToon = '' } = {},
): string {
  return String(template || '')
    .replace(/\{\{\s*npcName\s*\}\}/gi, String(npcName || ''))
    .replace(/\{\{\s*npcRace\s*\}\}/gi, String(npcRace || ''))
    .replace(/\{\{\s*npcToon\s*\}\}/gi, String(npcToon || ''));
}

// ─── API 结果规范化 ─────────────────────────────────────

function getNpcWorldBookResultObjectCandidates(result: unknown): Record<string, unknown>[] {
  const queue: unknown[] = Array.isArray(result) ? [...result] : [result];
  const candidates: Record<string, unknown>[] = [];
  const visited = new WeakSet<object>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || current === null) continue;
    if (Array.isArray(current)) { queue.push(...current); continue; }
    if (!isPlainObject(current) || visited.has(current)) continue;

    visited.add(current);
    candidates.push(current);

    [current.entry, current.result, current.data, current.output, current.response,
     current.payload, current.item, current.value, current.message,
     current.choice, (current.choices as unknown[])?.[0], current.entries, current.items,
     current.results, current.candidates, current.records, current.list,
    ].forEach(item => {
      if (item !== undefined && item !== null) queue.push(item);
    });
  }

  return candidates;
}

function extractNpcWorldBookKeywordCandidate(source: Record<string, unknown>): string[] {
  const keywords = normalizeCharacterWorldBookKeywords(
    source.keywords ?? source.keys ?? source.keywordList ?? source.keyword ??
    source.tags ?? source.tagList ?? source.关键词 ?? source.关键字 ?? source.标签,
  );
  if (keywords.length > 0) return keywords;
  return uniqueList([
    pickFirstText(source.name, source.entryName, source.title, source.comment,
      source.名称, source.条目名, source.标题),
  ]);
}

function extractNpcWorldBookContentCandidate(source: Record<string, unknown>): string {
  return sanitizeGeneratedWorldBookContent(
    pickFirstText(
      source.content, source.body, source.entryContent, source.text,
      source.description, source.desc, source.profile, source.summary,
      source.lorebook, source.loreBook, source.lore, source.lore_buff, source.loreBuff,
      source.memo, source.正文, source.条目正文, source.正文内容, source.内容,
      source.人物详情, source.人物设定, source.角色设定, source.简介, source.描述,
    ),
  );
}

function extractNpcWorldBookArrayKeywords(result: unknown): string[] {
  if (!Array.isArray(result)) return [];
  const isScalarArray = result.every(item => (
    item === undefined || item === null || typeof item === 'string' ||
    typeof item === 'number' || typeof item === 'boolean'
  ));
  return isScalarArray ? normalizeCharacterWorldBookKeywords(result) : [];
}

export function normalizeNpcWorldBookApiResult(result: unknown): { keywords: string[]; content: string } {
  const candidates = getNpcWorldBookResultObjectCandidates(result);
  const keywordPool = [...extractNpcWorldBookArrayKeywords(result)];
  let content = '';

  candidates.forEach(candidate => {
    keywordPool.push(...extractNpcWorldBookKeywordCandidate(candidate));
    if (!content) content = extractNpcWorldBookContentCandidate(candidate);
  });

  return { keywords: uniqueList(keywordPool), content };
}

// ─── 人物书条目识别与去重 ─────────────────────────────────────

function getEntryKeywordList(entry: Record<string, unknown>): string[] {
  return normalizeCharacterWorldBookKeywords(entry.keys ?? entry.key ?? entry.keysStr ?? []);
}

export function isCharacterWorldBookEntry(entry: Record<string, unknown>): boolean {
  const keywords = getEntryKeywordList(entry);
  if (keywords.some(keyword => keyword === CHARACTER_WORLDBOOK_SPECIAL_KEYWORD)) return true;
  const content = String(entry?.content || '');
  return /(^|\n)\s*人物书专用[:：]\s*是(\n|$)/.test(content);
}

export function extractCharacterWorldBookName(entry: Record<string, unknown>): string {
  const content = String(entry?.content || '');
  const contentMatch = content.match(/(?:^|\n)\s*人物姓名[:：]\s*(.+?)(?:\n|$)/);
  if (contentMatch && contentMatch[1]) return contentMatch[1].trim();
  const keywords = getEntryKeywordList(entry).filter(keyword => keyword !== CHARACTER_WORLDBOOK_SPECIAL_KEYWORD);
  return keywords[0] || '';
}

/**
 * 判断是否应该抑制该人物书条目（去重）。
 * 如果 NPC 在场（surroundingNpcNames 中有其名字），则抑制其世界书条目，
 * 因为变量系统已经包含了该 NPC 的实时数据。
 */
export function shouldSuppressCharacterWorldBookEntry(
  entry: import('./worldInfoEngine').WorldInfoEntry,
  surroundingNpcNames: string[] = [],
): boolean {
  if (!isCharacterWorldBookEntry(entry as unknown as Record<string, unknown>)) return false;
  const targetName = extractCharacterWorldBookName(entry as unknown as Record<string, unknown>);
  if (!targetName) return false;
  return (Array.isArray(surroundingNpcNames) ? surroundingNpcNames : [])
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .some(name => isCharacterNameMatched(targetName, name));
}
