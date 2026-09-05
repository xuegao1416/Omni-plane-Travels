import {
  BookOpen, ScrollText, Map, Flag, DollarSign, User, Swords, Layers, BookMarked,
} from 'lucide-react';
import type { WorldDef, WorldBookEntryDef } from '../../../data/worlds-schema';
import { parseWorldBookImport } from '../../../utils/worldBookImport';

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

/** 将外部格式 JSON 转为 WorldDef（兼容 worldBookEntries / entries 任意大小写、数组或对象、角色卡内嵌） */
export function normalizeExternal(data: any, fileName: string): WorldDef {
  const parsed = parseWorldBookImport(data);
  const baseUid = Date.now();
  // 新建世界：统一重新分配 uid，保证唯一
  const entries: WorldBookEntryDef[] = parsed.entries.map((entry, i) => ({ ...entry, uid: baseUid + i }));

  const baseName = fileName.replace(/\.json$/i, '');
  return {
    id: `external_${baseUid}`, name: data.name || baseName,
    description: data.description || `从 ${fileName} 导入（${entries.length} 条条目）`,
    entryId: null, worldBookEntries: entries, source: 'external',
  };
}
