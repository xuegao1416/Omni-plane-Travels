import type { WorldBookEntryDef, WorldBookEntryType } from '../data/worlds-schema';
import type { NovelNamedArchive, NovelStaticMaterial } from './types';
import { hashNovelText } from './segmentation';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const cleanList = (values: unknown): string[] => Array.isArray(values)
  ? values.map(clean).filter(Boolean)
  : [];

function entry(
  uid: number,
  comment: string,
  content: string,
  entryType: WorldBookEntryType,
  options: Pick<WorldBookEntryDef, 'key' | 'constant' | 'order' | 'meta'>,
): WorldBookEntryDef | null {
  const title = clean(comment);
  const body = clean(content);
  if (!title || !body) return null;
  return {
    uid,
    comment: title,
    content: body,
    entryType,
    key: options.key,
    constant: options.constant,
    order: options.order,
    position: 'before_char',
    ...(options.meta ? { meta: options.meta } : {}),
  };
}

function archiveEntry(
  uid: number,
  item: NovelNamedArchive,
  entryType: 'factions' | 'npcs' | 'lore' | 'items',
  role?: string,
  source?: { datasetId: string; analysisVersion: number },
): WorldBookEntryDef | null {
  const name = clean(item?.name);
  const description = clean(item?.description);
  if (!name || !description) return null;
  const details = cleanList(item.details);
  const heading = entryType === 'npcs' ? '人物档案' : entryType === 'factions' ? '势力档案' : role === '重要物品' ? '重要物品' : '地点档案';
  const body = [
    `【${heading}】${name}`,
    role ? `定位：${clean(role)}` : '',
    description,
    ...details.map(detail => `- ${detail}`),
  ].filter(Boolean).join('\n');
  const meta = entryType === 'factions'
    ? { factions: [{ name, description }] }
    : entryType === 'npcs'
      ? { npcs: [{ name, role: clean(role), description }] }
      : undefined;
  const result = entry(uid, name, body, entryType, {
    key: Array.from(new Set([name, ...cleanList(item.aliases)])),
    constant: false,
    order: 180,
    meta,
  });
  return result && source ? { ...result, novelProvenance: {
    ...source, sourceKey: `${entryType}:${item.id || name}`, entityId: item.id,
    evidenceRefs: item.evidenceRefs, generatedHash: novelEntryHash(result),
  } } : result;
}

/**
 * Phase 1 adapter: stable novel material is represented by the application's
 * existing WorldBookEntryDef format. It intentionally does not include raw
 * chapters or chronology; those belong to the dynamic novel dataset layer.
 */
export function buildNovelWorldBookEntries(material: NovelStaticMaterial, startUid = Date.now(), source?: { datasetId: string; analysisVersion: number }): WorldBookEntryDef[] {
  const entries: WorldBookEntryDef[] = [];
  let uid = Math.max(1, Math.floor(startUid));
  const add = (value: WorldBookEntryDef | null) => { if (value) entries.push(value); };
  const summary = clean(material?.summary);
  if (summary) {
    add(entry(uid++, '原著世界概览', `【原著世界概览】\n${summary}`, 'setting', {
      key: [], constant: true, order: 80,
    }));
  }

  const settings = cleanList(material?.settings);
  if (settings.length > 0) {
    add(entry(uid++, '原著背景设定', ['【原著背景设定】', ...settings.map(item => `- ${item}`)].join('\n'), 'setting', {
      key: ['背景', '设定', ...settings.map(value => value.slice(0, 12))], constant: false, order: 90,
    }));
  }

  const rules = cleanList(material?.rules);
  const powerSystem = clean(material?.powerSystem);
  if (rules.length > 0 || powerSystem) {
    add(entry(uid++, '原著硬规则', ['【原著硬规则】', ...(powerSystem ? [`力量体系：${powerSystem}`] : []), ...rules.map(item => `- ${item}`)].join('\n'), 'rules', {
      key: [], constant: true, order: 100, meta: { specialRules: rules, ...(powerSystem ? { powerSystem } : {}) },
    }));
  }

  for (const faction of material?.factions ?? []) add(archiveEntry(uid++, faction, 'factions', undefined, source));
  for (const character of material?.characters ?? []) add(archiveEntry(uid++, character, 'npcs', character.role, source));
  for (const location of material?.locations ?? []) add(archiveEntry(uid++, location, 'lore', undefined, source));
  for (const item of material?.items ?? []) add(archiveEntry(uid++, item, 'items', '重要物品', source));

  const relations = cleanList(material?.relations);
  if (relations.length > 0) {
    add(entry(uid++, '原著关系网络', ['【原著关系网络】', ...relations.map(item => `- ${item}`)].join('\n'), 'relationships', {
      key: ['关系', ...[...(material.characters ?? []), ...(material.factions ?? [])].flatMap(item => [item.name, ...(item.aliases ?? [])])], constant: false, order: 170,
    }));
  }

  const economy = material?.economy;
  if (economy && Object.values(economy).some(value => clean(value))) {
    const currency = clean(economy.currencyName);
    const body = [
      '【原著经济与时间】',
      currency ? `货币：${clean(economy.currencySymbol)}${currency}${economy.currencyDescription ? `（${clean(economy.currencyDescription)}）` : ''}` : '',
      economy.priceLevel ? `物价水平：${clean(economy.priceLevel)}` : '',
      economy.calendar ? `纪年：${clean(economy.calendar)}` : '',
      economy.startTime ? `起始时间：${clean(economy.startTime)}` : '',
      economy.timeSpeed ? `时间流速：${clean(economy.timeSpeed)}` : '',
    ].filter(Boolean).join('\n');
    add(entry(uid++, '原著经济与时间', body, 'economy', {
      key: ['货币', '价格', '时间', '纪年'], constant: false, order: 210,
      meta: {
        currency: currency ? { name: currency, symbol: clean(economy.currencySymbol) || undefined, description: clean(economy.currencyDescription) || undefined } : undefined,
        priceLevel: clean(economy.priceLevel) || undefined,
        calendar: clean(economy.calendar) || undefined,
        startTime: clean(economy.startTime) || undefined,
        timeSpeed: clean(economy.timeSpeed) || undefined,
      },
    }));
  }

  const culture = cleanList(material?.culture);
  if (culture.length > 0) {
    add(entry(uid++, '原著文化风俗', ['【原著文化风俗】', ...culture.map(item => `- ${item}`)].join('\n'), 'culture', {
      key: ['文化', '风俗', '传统', '礼仪'], constant: false, order: 220,
    }));
  }

  const highlights = cleanList(material?.highlights);
  if (highlights.length > 0) {
    add(entry(uid++, '原著核心特色', ['【原著核心特色】', ...highlights.map(item => `- ${item}`)].join('\n'), 'highlights', {
      key: ['特色', ...highlights], constant: false, order: 230, meta: { highlights },
    }));
  }
  // Keep the full text as a triggered detail entry when an overview exceeds the
  // resident budget. No extracted fact is discarded to fit the prompt.
  for (const item of [...entries]) {
    if (!item.constant || item.content.length <= 1600) continue;
    const detail = { ...item, uid: uid++, comment: `${item.comment}（完整资料）`, constant: false,
      key: item.entryType === 'rules' ? ['规则', '力量', '能力', '施法', ...rules.map(rule => rule.split(/[：:，,。]/)[0]!)] : ['世界', '背景', '概览'] };
    entries.push(detail);
    const cut = item.content.slice(0, 1500);
    const boundary = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('。'));
    item.content = `${boundary > 500 ? cut.slice(0, boundary + 1) : cut}\n（详见完整资料）`;
  }
  return source ? entries.map(item => ({ ...item, novelProvenance: {
    ...source, sourceKey: `${item.entryType}:${item.comment}`, ...item.novelProvenance, generatedHash: novelEntryHash(item),
  } })) : entries;
}

function novelEntryHash(item: WorldBookEntryDef): string {
  const { uid: _uid, novelProvenance: _origin, ...content } = item;
  // Native import writes the default explicitly; false and absent are the same
  // enabled state and must not turn an untouched archive into a manual edit.
  if (content.disable === false) delete content.disable;
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)]))
      : value;
  return hashNovelText(JSON.stringify(canonical(content)));
}

/** Replace only identifiable, untouched generated entries. Never delete manual entries. */
export function mergeNovelWorldBookEntries(existing: WorldBookEntryDef[], generated: WorldBookEntryDef[]): WorldBookEntryDef[] {
  const pending = new Map(generated.map(item => [`${item.novelProvenance?.datasetId}:${item.novelProvenance?.sourceKey}`, item]));
  let nextUid = Math.max(0, ...existing.map(item => item.uid), ...generated.map(item => item.uid));
  const merged = existing.map(item => {
    const origin = item.novelProvenance;
    if (!origin) return item;
    const key = `${origin.datasetId}:${origin.sourceKey}`;
    let replacementKey = key;
    let replacement = pending.get(key);
    if (!replacement && origin.sourceKey === `${item.entryType}:${item.comment}`) {
      const candidates = [...pending.entries()].filter(([, candidate]) => candidate.novelProvenance?.datasetId === origin.datasetId
        && candidate.entryType === item.entryType && candidate.comment === item.comment);
      if (candidates.length === 1) [replacementKey, replacement] = candidates[0]!;
    }
    if (!replacement) return { ...item, novelProvenance: { ...origin, reviewStatus: 'missing_from_regeneration' as const } };
    pending.delete(replacementKey);
    return origin.generatedHash === novelEntryHash(item)
      ? { ...replacement, uid: item.uid }
      : { ...item, novelProvenance: { ...origin, reviewStatus: 'manual_conflict' as const } };
  });
  return [...merged, ...Array.from(pending.values(), item => ({ ...item, uid: ++nextUid }))];
}

/** Explicit upgrade only: recognize exact v1-generated content, never title-only matches. */
export function identifyLegacyNovelEntries(existing: WorldBookEntryDef[], previous: NovelStaticMaterial, datasetId: string): WorldBookEntryDef[] {
  const legacy = buildNovelWorldBookEntries(previous, 1).map(item => {
    if (item.entryType === 'items') return { ...item, entryType: 'lore' as const };
    if (item.entryType === 'rules') { const { meta: _meta, ...rest } = item; return rest; }
    return item;
  });
  const legacyEvents = (previous.events ?? []).flatMap(eventItem => {
    const name = clean(eventItem.name), description = clean(eventItem.description);
    if (!name || !description) return [];
    return [entry(1, name, [
      `【原著事件】${name}`, description,
      eventItem.trigger ? `触发：${clean(eventItem.trigger)}` : '',
      eventItem.result ? `结果：${clean(eventItem.result)}` : '',
      eventItem.visibility === 'reader_only' || (typeof eventItem.visibility === 'object' && eventItem.visibility.readerOnly)
        ? '信息边界：仅读者视角可见，不得直接转化为角色已知事实。' : '',
    ].filter(Boolean).join('\n'), 'events', { key: [name], constant: false, order: 200 })!];
  });
  const fingerprints = new Map(legacy.map(item => [novelEntryHash(item), item]));
  const eventFingerprints = new Set(legacyEvents.map(novelEntryHash));
  return existing.flatMap(item => {
    if (item.novelProvenance) return [item];
    const hash = novelEntryHash(item);
    // Only the exact old generated event is removed during the user-requested regeneration.
    if (eventFingerprints.has(hash)) return [];
    if (!fingerprints.has(hash)) return [item];
    const originalType = item.entryType === 'lore' && item.content.startsWith('【重要物品】') ? 'items' : item.entryType;
    return [{ ...item, novelProvenance: { datasetId, analysisVersion: 1, sourceKey: `${originalType}:${item.comment}`, generatedHash: hash } }];
  });
}
