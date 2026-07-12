import {
  BookOpen, ScrollText, Map, Flag, DollarSign, User, Swords, Layers, BookMarked,
} from 'lucide-react';
import type { WorldDef, WorldBookEntryDef } from '../../../data/worlds-schema';

export const DIFFICULTY_FILTERS = [
  { key: 'all', label: '全部', color: undefined as string | undefined },
  { key: 'easy', label: '简单', color: 'var(--difficulty-easy)' as string | undefined },
  { key: 'medium', label: '中等', color: 'var(--difficulty-medium)' as string | undefined },
  { key: 'hard', label: '困难', color: 'var(--difficulty-hard)' as string | undefined },
];

export const TABS = [
  { key: 'overview', label: '概览', icon: BookOpen },
  { key: 'lore', label: '地理', icon: Map },
  { key: 'factions', label: '势力', icon: Flag },
  { key: 'culture', label: '文化', icon: BookMarked },
  { key: 'economy', label: '经济', icon: DollarSign },
  { key: 'npcs', label: '人物', icon: User },
  { key: 'rules', label: '规则', icon: Swords },
  { key: 'systems', label: '系统', icon: Layers },
] as const;

export type TabKey = typeof TABS[number]['key'];

export function findEntryByType(entries: WorldBookEntryDef[] | undefined, type: string): WorldBookEntryDef | undefined {
  return entries?.find(e => e.entryType === type);
}

/** 将外部格式 JSON 转为 WorldDef */
export function normalizeExternal(data: any, fileName: string): WorldDef {
  let rawList: any[] = [];
  if (Array.isArray(data)) rawList = data;
  else if (data.entries) rawList = Array.isArray(data.entries) ? data.entries : Object.values(data.entries);
  else if (data.worldBookEntries) rawList = Array.isArray(data.worldBookEntries) ? data.worldBookEntries : Object.values(data.worldBookEntries);
  else if (data.items) rawList = data.items;
  else rawList = [data];

  const entries: WorldBookEntryDef[] = [];
  const baseUid = Date.now();

  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    if (typeof item === 'string') {
      entries.push({ uid: baseUid + i, key: [], comment: `条目 ${i + 1}`, content: item, constant: false, order: i + 1, position: 'after_char' });
    } else if (typeof item === 'object' && item !== null) {
      entries.push({
        uid: item.uid ?? (baseUid + i), key: item.key || item.keys || [], keysecondary: item.keysecondary,
        comment: item.comment || item.name || item.title || `条目 ${i + 1}`,
        content: item.content || item.text || item.description || JSON.stringify(item),
        constant: item.constant ?? false, order: item.order ?? item.insertionOrder ?? (i + 1),
        position: item.position || 'after_char', depth: item.depth, entryType: undefined, probability: item.probability,
        disable: item.disable ?? (item.enabled === false),
      });
    }
  }

  const baseName = fileName.replace(/\.json$/i, '');
  return {
    id: `external_${baseUid}`, name: data.name || baseName,
    description: data.description || `从 ${fileName} 导入（${entries.length} 条条目）`,
    entryId: null, worldBookEntries: entries, source: 'external',
  };
}
