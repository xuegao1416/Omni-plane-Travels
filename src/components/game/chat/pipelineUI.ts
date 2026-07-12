// ============================================================
// 管线 UI 共享常量 — PipelineMonitorModal 和 PipelineStatus 共用
// ============================================================

import type { PipelineTaskId } from '../../../engine/pipelineTypes';
import { PenLine, BookOpen, Search, Puzzle, Database, Variable, RefreshCw, ListChecks, BarChart3 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** 阶段视觉配置（图标 + 颜色 + 描述） */
export const STAGE_META: Record<PipelineTaskId, { icon: LucideIcon; color: string; desc: string }> = {
  main:                   { icon: PenLine,    color: '#3b82f6', desc: 'AI 生成正文回复' },
  memory_write:           { icon: BookOpen,   color: '#10b981', desc: '提取热态对象（场景/线程/关系/事件/实体）' },
  memory_summary:         { icon: BookOpen,   color: '#06b6d4', desc: '保存 3 类记忆（本层摘要/角色/物品）' },
  memory_vector:          { icon: Database,   color: '#14b8a6', desc: '提取长期向量事实' },
  memory_query_rewrite:   { icon: Search,     color: '#8b5cf6', desc: '分析用户输入，提取检索关键词' },
  memory_retrieve_plan:   { icon: ListChecks, color: '#7c3aed', desc: 'AI 规划需要注入的记忆' },
  memory_multi_round:     { icon: RefreshCw,  color: '#6d28d9', desc: '多轮补充遗漏的记忆' },
  memory_rerank:          { icon: BarChart3,  color: '#5b21b6', desc: '精排打分，优化记忆顺序' },
  memory_retrieve_finalize:{ icon: Search,    color: '#4c1d95', desc: '本地匹配 + 去重 + 排序' },
  memory_compile:         { icon: Puzzle,     color: 'var(--warning)', desc: '组装记忆上下文注入系统提示词' },
  variable:               { icon: Variable,   color: 'var(--danger)', desc: '提取游戏变量更新' },
};

/** 阶段执行顺序 */
export const STAGE_ORDER: PipelineTaskId[] = [
  'main',
  'memory_write', 'memory_summary', 'memory_vector',
  'memory_query_rewrite',
  'memory_retrieve_plan',
  'memory_multi_round',
  'memory_rerank',
  'memory_retrieve_finalize',
  'memory_compile',
  'variable',
];

/** 状态视觉配置 */
export const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  pending: { color: 'var(--text-muted)', label: '等待中' },
  running: { color: 'var(--accent)', label: '执行中...' },
  success: { color: '#4caf50', label: '已完成' },
  warning: { color: '#ff9800', label: '降级' },
  error:   { color: '#f44336', label: '异常' },
  skipped: { color: 'var(--text-muted)', label: '已跳过' },
};

/** 格式化毫秒数 */
export function formatMs(ms?: number): string {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
