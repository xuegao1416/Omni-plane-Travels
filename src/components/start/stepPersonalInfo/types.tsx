import React from 'react';
import type { PlayerProfile, CustomNpc } from '../../../storage/db';
import type { SkillData, InventoryItem } from '../../../schema/variables';
import type { WorldModule } from '../../../data/worlds-schema';
import type { WorldDef } from '../../../data/worldLoader';
import type { WorldBookEntry } from '../../../worldbook/index';
import type { ApiConfig } from '../../../api/types';
import { Briefcase, Sparkles, Package, Users, BarChart3 } from 'lucide-react';

export interface StepPersonalInfoProps {
  personalInfo: PlayerProfile;
  setPersonalInfo: (info: PlayerProfile) => void;
  isFilling: boolean;
  fillElapsed: number;
  onAiFill: () => void;
  onCancelFill: () => void;
  hasApiConfig: boolean;
  worldModules?: WorldModule[];
  apiConfig?: ApiConfig | null;
  selectedWorld?: string;
  allWorlds?: WorldDef[];
  worldEntry?: WorldBookEntry | null;
  onNext: () => void;
  onPrev: () => void;
}

export type RightTab = 'identity' | 'stats' | 'skills' | 'items' | 'npcs';

export const QUALITY_OPTIONS: Array<SkillData['品质']> = ['普通', '精良', '稀有', '史诗', '传说'];

export const PERSPECTIVE_OPTIONS: Array<{ value: PlayerProfile['perspective']; label: string; desc: string }> = [
  { value: '第一人称', label: '第一人称', desc: '「我」的视角' },
  { value: '第二人称', label: '第二人称', desc: '「你」的视角' },
  { value: '第三人称', label: '第三人称', desc: '「他/她」的视角' },
];

export const RIGHT_TABS: Array<{ key: RightTab; label: string; icon: React.ReactNode }> = [
  { key: 'identity', label: '身份', icon: <Briefcase size={14} /> },
  { key: 'stats', label: '属性', icon: <BarChart3 size={14} /> },
  { key: 'skills', label: '技能', icon: <Sparkles size={14} /> },
  { key: 'items', label: '物品', icon: <Package size={14} /> },
  { key: 'npcs', label: 'NPC', icon: <Users size={14} /> },
];

// Re-export shared types for sub-components
export type { PlayerProfile, CustomNpc, SkillData, InventoryItem, WorldModule, WorldDef, WorldBookEntry, ApiConfig };
