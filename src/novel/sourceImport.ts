import type { NovelNamedArchive, NovelStaticMaterial } from './types';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const list = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter(Boolean) : [];
const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
  ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown>[]
  : [];

function archiveFromSource(item: Record<string, unknown>, type: 'faction' | 'character' | 'location'): NovelNamedArchive | null {
  const name = text(item.名称 ?? item.name);
  if (!name) return null;
  if (type === 'faction') {
    const objective = text(item.立场目标 ?? item.description);
    const description = objective;
    return description ? { name, description, aliases: list(item.代表人物), details: list(item.关系摘要) } : null;
  }
  if (type === 'character') {
    const identity = text(item.身份 ?? item.role);
    const description = [identity, text(item.基础描述 ?? item.description)].filter(Boolean).join('\n');
    return description ? { name, description, aliases: list(item.关系摘要) } : null;
  }
  const functionText = text(item.地貌功能 ?? item.description);
  const parent = text(item.上级地点);
  const description = [functionText, parent ? `上级地点：${parent}` : ''].filter(Boolean).join('\n');
  return description ? { name, description, aliases: list(item.关键设施) } : null;
}

/**
 * Reads either this application's `staticMaterial` or the Chinese-keyed
 * decomposition archive used by the source project. It only transfers stable
 * material; chapter progress remains in the dynamic dataset layer.
 */
export function extractNovelStaticMaterial(raw: unknown): NovelStaticMaterial {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const existing = source.staticMaterial ?? source.novelStaticMaterial;
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) return existing as NovelStaticMaterial;

  const factions = records(source.势力档案).map(item => archiveFromSource(item, 'faction')).filter(Boolean) as NovelNamedArchive[];
  const characters = records(source.角色档案).map(item => {
    const archive = archiveFromSource(item, 'character');
    return archive ? { ...archive, role: text(item.身份) || undefined } : null;
  }).filter(Boolean) as Array<NovelNamedArchive & { role?: string }>;
  const locations = records(source.地图地点档案).map(item => archiveFromSource(item, 'location')).filter(Boolean) as NovelNamedArchive[];

  return {
    summary: text(source.世界背景 ?? source.世界总览 ?? source.作品名 ?? source.标题),
    settings: list(source.世界边界规则),
    rules: [...list(source.世界观规则), ...list(source.世界边界规则)],
    powerSystem: text(source.力量体系) || undefined,
    culture: list(source.文化风俗),
    factions,
    characters,
    locations,
    relations: [...list(source.人物关系), ...list(source.势力关系)],
  };
}
