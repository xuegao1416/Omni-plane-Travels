import {
  Globe, Newspaper, User, Heart, IdCard, DollarSign, BookOpen, Swords,
  Users, Tag, Handshake, FileText, Dna, Sparkles, Backpack, ClipboardList,
  type LucideIcon,
} from 'lucide-react';
import type { GameState } from '../../../schema/variables';
import type { SnapshotLayer } from '../shared/snapshotUtils';
export { formatTime, getSnapshotPreview } from '../shared/snapshotUtils';

// ── 图标映射 ──
const SECTION_ICON_MAP: Record<string, LucideIcon> = {
  Globe, Newspaper, User, Heart, IdCard, DollarSign, BookOpen, Swords,
  Users, Tag, Handshake, FileText, Dna, Sparkles, Backpack, ClipboardList,
};

export function resolveSectionIcon(name?: string): LucideIcon {
  return (name && SECTION_ICON_MAP[name]) || ClipboardList;
}

// ── 类型 ──
export type { SnapshotLayer };

export interface VariableSettingsOverlayProps {
  visible: boolean;
  onClose: () => void;
  messages: import('../../../engine/types').ChatMessage[];
  varMgr: import('../../../engine/variableManager').VariableManager;
  onRestoreSnapshot?: (snapshot: GameState) => void;
  onSave?: () => void;
}

// ── 常量 ──
export const SNAPSHOT_PAGE_SIZE = 20;

// ── 工具函数 ──

export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
