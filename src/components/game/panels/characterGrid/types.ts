import type { LucideIcon } from 'lucide-react';
import { User, FileText, Swords, Backpack } from 'lucide-react';
import { v4 as uuid } from 'uuid';
import type { NPCData, GameState } from '../../../../schema/variables';
import type { CustomNpc } from '../../../../storage/db';

export interface CharacterGridProps {
  gameState: GameState;
  worldId?: string;
  onUpdateChronicles?: (npcId: string, chronicles: string[]) => void;
  onMergeChronicles?: (npcId: string, startIndex: number, endIndex: number) => Promise<boolean>;
}

export type DetailTab = 'overview' | 'dossier' | 'skills' | 'items';

export const DETAIL_TABS: { id: DetailTab; icon: LucideIcon; label: string }[] = [
  { id: 'overview', icon: User, label: '概览' },
  { id: 'dossier', icon: FileText, label: '档案' },
  { id: 'skills', icon: Swords, label: '技能列表' },
  { id: 'items', icon: Backpack, label: '物品列表' },
];

export function favorClass(v: number) {
  if (v >= 60) return { color: 'var(--success)', label: '高' };
  if (v >= 20) return { color: '#3b82f6', label: '中' };
  if (v >= -20) return { color: '#9ca3af', label: '平' };
  return { color: 'var(--danger)', label: '低' };
}

export function categoryStyle(cat?: string) {
  switch (cat) {
    case '在场': return { bg: '#dcfce7', color: '#166534', label: '在场' };
    case '离场': return { bg: '#f3f4f6', color: '#6b7280', label: '离场' };
    case '重点': return { bg: '#fef3c7', color: '#92400e', label: '重点' };
    default: return { bg: '#dcfce7', color: '#166534', label: '在场' };
  }
}

export function npcDataToCustomNpc(npc: NPCData): CustomNpc {
  const ext = npc as any;
  const pi = npc.个人信息 ?? {} as any;
  const sj = npc.社会身份 ?? {} as any;
  const rd = npc.关系数据 ?? {} as any;

  let skillsList: CustomNpc['skillsList'] = {};
  if (ext.技能列表 && typeof ext.技能列表 === 'object') {
    if (Array.isArray(ext.技能列表)) {
      ext.技能列表.forEach((s: any) => {
        if (typeof s === 'string') skillsList[s] = { 描述: '', 类型: '', 品质: '普通' };
        else if (s?.name) skillsList[s.name] = { 描述: s.描述 || '', 类型: s.类型 || '', 品质: s.品质 || '普通' };
      });
    } else {
      for (const [k, v] of Object.entries(ext.技能列表)) {
        if (typeof v === 'string') skillsList[k] = { 描述: v, 类型: '', 品质: '普通' };
        else if (v && typeof v === 'object') {
          const sv = v as any;
          skillsList[k] = { 描述: sv.描述 || '', 类型: sv.类型 || '', 品质: sv.品质 || '普通' };
        }
      }
    }
  }

  let itemsList: CustomNpc['itemsList'] = {};
  if (ext.物品列表 && typeof ext.物品列表 === 'object') {
    if (Array.isArray(ext.物品列表)) {
      ext.物品列表.forEach((item: any) => {
        if (typeof item === 'string') itemsList[item] = { 数量: 1, 类型: '', 品质: '普通', 备注: '' };
        else if (item?.name) itemsList[item.name] = { 数量: item.数量 || 1, 类型: item.类型 || '', 品质: item.品质 || '普通', 备注: item.备注 || '' };
      });
    } else {
      for (const [k, v] of Object.entries(ext.物品列表)) {
        if (typeof v === 'string') itemsList[k] = { 数量: 1, 类型: '', 品质: '普通', 备注: v };
        else if (v && typeof v === 'object') {
          const iv = v as any;
          itemsList[k] = { 数量: iv.数量 || 1, 类型: iv.类型 || '', 品质: iv.品质 || '普通', 备注: iv.备注 || '' };
        }
      }
    }
  }

  return {
    id: uuid(),
    name: npc.姓名 || '',
    gender: npc.性别 || '',
    age: String(npc.年龄 ?? ''),
    race: npc.种族 || '',
    relationshipType: rd.关系类型 || '',
    occupation: sj.职业 || '',
    socialStatus: sj.社会地位 || '',
    personality: pi.表性格 || ext.性格 || '',
    hiddenPersonality: pi.里性格 || '',
    currentThought: pi.当前想法 || '',
    appearance: pi.外貌 || '',
    currentOutfit: pi.当前穿着 || ext.穿着 || '',
    currentAction: ext.当前行动 || pi.当前状态 || '',
    currentLocation: pi.当前位置 || '',
    currentState: pi.当前状态 || '',
    shortTermGoal: ext.短期目标 || '',
    longTermGoal: ext.长期目标 || '',
    background: npc.背景 || pi.备注 || '',
    chronicles: [],
    skillsList,
    itemsList,
  };
}
