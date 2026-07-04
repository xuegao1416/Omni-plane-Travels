/**
 * TemplatePickerDialog 类型定义
 */
import type { CustomNpc, PlayerProfile } from '../../../storage/db';
import type { NpcTemplate, PlayerPreset, HistoryPreset } from '../../../storage/templateStore';

// ─── NPC 模板选择模式 ─────────────────────────────────

export interface NpcPickerProps {
  mode: 'npc';
  onClose: () => void;
  onBlank: () => void;                       // 空白新建
  onImportTemplate: (npc: CustomNpc) => void; // 从模板导入
}

// ─── 主角预设选择模式 ─────────────────────────────────

export interface PlayerPickerProps {
  mode: 'player';
  onClose: () => void;
  currentProfile: PlayerProfile;
  onApplyPreset: (profile: PlayerProfile) => void;
}

// ─── 人生经历预设选择模式 ─────────────────────────────

export interface HistoryPickerProps {
  mode: 'history';
  onClose: () => void;
  onApplyPreset: (preset: HistoryPreset) => void;
}

export type TemplatePickerProps = NpcPickerProps | PlayerPickerProps | HistoryPickerProps;

// ─── 子组件内部类型 ───────────────────────────────────

export interface OptionCardProps {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}

export interface TemplateCardProps {
  tpl: NpcTemplate | PlayerPreset | HistoryPreset;
  mode: 'npc' | 'player' | 'history';
  onSelect: (tpl: NpcTemplate | PlayerPreset | HistoryPreset) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
}
