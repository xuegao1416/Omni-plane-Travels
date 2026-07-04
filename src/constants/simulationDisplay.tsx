/**
 * 模拟系统 UI 显示常量（共享层）
 * 事件层级图标/颜色、紧急度图标/标签
 */
import {
  Sparkles, Building2, Users, Coins, PersonStanding,
  AlertTriangle, Clock,
} from 'lucide-react';
import type { EventLevel } from '../simulation/types';

// ─── 事件层级图标 ───
export const LEVEL_ICONS: Record<EventLevel, React.ReactNode> = {
  mythic: <Sparkles size={14} />,
  political: <Building2 size={14} />,
  factional: <Users size={14} />,
  economic: <Coins size={14} />,
  civilian: <PersonStanding size={14} />,
};

// ─── 事件层级颜色 ───
export const LEVEL_COLORS: Record<EventLevel, string> = {
  mythic: 'var(--event-level-mythic)',
  political: 'var(--event-level-political)',
  factional: 'var(--event-level-factional)',
  economic: 'var(--event-level-economic)',
  civilian: 'var(--event-level-civilian)',
};

// ─── 紧急度图标 ───
export const URGENCY_ICONS: Record<string, React.ReactNode> = {
  urgent: <AlertTriangle size={12} color="var(--danger)" />,
  near_term: <Clock size={12} color="var(--warning)" />,
  ongoing: <Clock size={12} color="var(--text-muted)" />,
};

// ─── 紧急度标签 ───
export const URGENCY_LABELS: Record<string, string> = {
  urgent: '紧急',
  near_term: '近期',
  ongoing: '持续',
};
