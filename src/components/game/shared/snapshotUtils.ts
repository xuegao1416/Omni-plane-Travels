/**
 * 快照相关共享类型与工具函数
 *
 * 使用方：variableSnapshot、variableSettings
 */

import type { GameState } from '../../../schema/variables';

// ── 快照层 ──

export interface SnapshotLayer {
  id: string;
  msgIndex: number;
  snapshot: GameState;
  snapshotTime: number;
  isInitial: boolean;
  content?: string; // AI 消息摘要
}

// ── 工具函数 ──

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export function getSnapshotPreview(snapshot: GameState): string {
  try {
    const s = snapshot as any;
    const hp = s?.玩家?.生存状态?.血量;
    const mp = s?.玩家?.生存状态?.体力值;
    const name = s?.玩家?.姓名;
    const parts: string[] = [];
    if (name) parts.push(name);
    if (hp !== undefined) parts.push(`HP:${hp}`);
    if (mp !== undefined) parts.push(`体力:${mp}`);
    return parts.join(' · ') || '';
  } catch { return ''; }
}
