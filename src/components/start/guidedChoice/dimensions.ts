import {
  Globe, ScrollText, Swords, Map, Flag, BookMarked, User,
  type LucideIcon,
} from 'lucide-react';

export interface GuidedDimConfig {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  required: boolean;
  color: string;
  multiSelect?: boolean;
  maxSelect?: number;
}

export const GUIDED_DIMENSIONS: GuidedDimConfig[] = [
  { key: 'worldType', label: '世界类型', description: '选择一个世界类型，决定整体框架', icon: Globe, required: true, color: '#6366f1' },
  { key: 'tone',      label: '叙事基调', description: '基调决定了 AI 叙述故事时的风格和氛围', icon: ScrollText, required: true, color: '#f59e0b' },
  { key: 'conflict',  label: '核心冲突', description: '核心冲突是驱动故事前进的引擎', icon: Swords, required: true, color: '#ef4444' },
  { key: 'geography', label: '地理格局', description: '世界的地理分布和区域特征', icon: Map, required: true, color: '#10b981', multiSelect: true, maxSelect: 3 },
  { key: 'factions',  label: '势力结构', description: '各方势力的关系和格局', icon: Flag, required: true, color: '#8b5cf6', multiSelect: true, maxSelect: 3 },
  { key: 'npcs',      label: '关键人物', description: '这个世界中的重要角色', icon: User, required: true, color: '#ec4899', multiSelect: true, maxSelect: 3 },
  { key: 'culture',   label: '文化风俗', description: '信仰、习俗、日常生活', icon: BookMarked, required: false, color: '#14b8a6', multiSelect: true, maxSelect: 2 },
  { key: 'rules',     label: '世界规则', description: '力量体系、社会结构、特殊规则', icon: ScrollText, required: true, color: '#f97316' },
];

export const DIMENSION_HINTS: Record<string, string> = {
  worldType: '根据用户描述生成4个不同世界类型变体（如用户描述修仙，可生成"古典仙侠"、"都市修仙"、"末法仙途"等）',
  tone: '不同风格基调，如"严肃古典"、"轻松日常"、"黑暗残酷"、"史诗壮阔"',
  conflict: '不同核心冲突，如"正邪对立"、"生存危机"、"权力争夺"、"身份探索"',
  geography: '不同地理格局，如"五大陆分布"、"群岛散布"、"一超多强"、"层叠世界"',
  factions: '不同势力结构，如"正邪对立"、"群雄割据"、"暗流涌动"、"表面和平"',
  npcs: '不同关键人物组合，如"正道领袖"、"亦正亦邪"、"底层群像"、"权贵阶层"',
  culture: '不同文化特征，如"宗门制度"、"城邦联盟"、"部落传统"、"科技文明"',
  rules: '不同规则体系，如"修仙九境"、"科技等级"、"血脉觉醒"、"契约系统"',
};

export function getDimensionQuestion(key: string): string {
  const questions: Record<string, string> = {
    worldType: '你想探索什么样的世界？',
    tone: '你想要什么样的故事基调？',
    conflict: '世界的核心矛盾是什么？',
    geography: '世界的地理格局是怎样的？',
    factions: '各方势力如何分布？',
    npcs: '这个世界有哪些关键人物？',
    culture: '这个世界的文化风俗如何？',
    rules: '这个世界的规则体系是什么？',
  };
  return questions[key] || '请选择';
}
