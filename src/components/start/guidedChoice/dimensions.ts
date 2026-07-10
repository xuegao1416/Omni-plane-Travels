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
  worldType: '根据用户描述生成4个世界类型方案。从用户描述中提取核心要素并展开成不同方向。确保与用户描述的题材和氛围一致。',
  tone: '生成4种叙事基调。覆盖从温暖到严肃的光谱（如温馨治愈、轻松幽默、诗意悠远、正经职场），具体选择以用户描述的氛围为准。不要一律偏向黑暗或沉重。',
  conflict: '生成4种核心矛盾。冲突应多元：人际羁绊（误解、和解、成长）、环境挑战（探索、适应、奋发）、内在挣扎（选择、身份、梦想）。不限于暴力对抗。',
  geography: '生成4种空间格局。尺度与用户描述的世界范围匹配——校园级细化到具体场所，城市级做到区域划分。写出空间特征和氛围。',
  factions: '生成4种人际关系格局。群体可以是社团、朋友圈、班级、邻里、同事——与用户世界的尺度一致。写出群体间的互动张力。',
  npcs: '生成4种角色组合方案。给出具体角色类型而非概念标签，写出他们与主角的可能关系。',
  culture: '生成4种文化/风俗方案。包含日常仪式、社交习惯、价值观念。与用户描述的题材保持一致。',
  rules: '生成4种秩序/规则方案。规则可以是成文的（校规、赛事制度）或不成文的（潜规则、习俗）。描述规则如何塑造日常生活。',
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
