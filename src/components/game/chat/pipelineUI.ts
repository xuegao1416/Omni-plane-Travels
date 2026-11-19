// ============================================================
// 管线 UI 共享常量 — PipelineMonitorModal 和 PipelineStatus 共用
// ============================================================

import type { PipelineTaskId } from '../../../engine/pipelineTypes';
import { PenLine,BookOpen,Search,Puzzle,Database,Variable,RefreshCw,ListChecks,BarChart3 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** 阶段视觉配置（图标 + 颜色 + 描述） */
export const STAGE_META: Record<PipelineTaskId, { icon: LucideIcon; color: string; desc: string }> = {
  main:                   { icon: PenLine,    color: '#f2d48e', desc: 'AI 生成正文回复' },
  memory_write:           { icon: BookOpen,   color: '#e9c983', desc: '提取热态对象（场景/线程/关系/事件/实体）' },
  memory_summary:         { icon: BookOpen,   color: '#d9b977', desc: '保存 3 类记忆（本层摘要/角色/物品）' },
  memory_vector:          { icon: Database,   color: '#c9a766', desc: '提取长期向量事实' },
  memory_query_rewrite:   { icon: Search,     color: '#a8bfff', desc: '分析用户输入，提取检索关键词' },
  memory_retrieve_plan:   { icon: ListChecks, color: '#9cb4f4', desc: 'AI 规划需要注入的记忆' },
  memory_multi_round:     { icon: RefreshCw,  color: '#8fa8ea', desc: '多轮补充遗漏的记忆' },
  memory_rerank:          { icon: BarChart3,  color: '#849de0', desc: '精排打分，优化记忆顺序' },
  memory_retrieve_finalize:{ icon: Search,    color: '#7a92d6', desc: '本地匹配 + 去重 + 排序' },
  memory_compile:         { icon: Puzzle,     color: '#f0b884', desc: '组装记忆上下文注入系统提示词' },
  variable:               { icon: Variable,   color: '#ff9a8a', desc: '提取游戏变量更新' },
  settlement:             { icon: Puzzle,     color: '#fff1c8', desc: '接纳行动结果、时间与玩法消耗' },
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
  'settlement',
];

/** 状态视觉配置 */
export const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  pending: { color: 'var(--text-muted)', label: '等待中' },
  running: { color: 'var(--accent)', label: '执行中...' },
  success: { color: '#e3c27e', label: '已完成' },
  warning: { color: '#f6c48a', label: '降级' },
  error:   { color: '#ff9a8a', label: '异常' },
  skipped: { color: 'var(--text-muted)', label: '已跳过' },
};

/** 格式化毫秒数 */
export function formatMs(ms?: number): string {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
