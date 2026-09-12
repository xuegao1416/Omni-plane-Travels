// ============================================================
//  世界模块化系统 v2 — 运行时管理
//  管理 WorldSystemData 的读取和更新
// ============================================================

import type { WorldSystemData, ProgressionModuleSchema } from './schema';
import { getXpForNextTier, getTierProgress } from './xpAlgorithm';

/**
 * 从世界定义模块数据中提取 WorldSystemData
 * 数据来源：worldDef.modules[].moduleConfig 投影出的 WorldSystemData。
 * WorldModuleRuntime 已退出当前运行时；世界模块只使用 moduleConfig + initialState。
 */
export function extractWorldSystemData(
  worldSystem: Record<string, unknown> | undefined
): WorldSystemData {
  if (!worldSystem) return {};

  // 新格式：直接是 WorldSystemData
  if ('数值属性' in worldSystem || '成长体系' in worldSystem ||
      '生存资源' in worldSystem || '经营资产' in worldSystem || '骰子检定' in worldSystem || '天赋体系' in worldSystem || '职业体系' in worldSystem || '战斗系统' in worldSystem) {
    const result = { ...worldSystem } as WorldSystemData;
    return result;
  }


  return {};
}

/**
 * 获取成长体系的显示信息
 */
export function getProgressionDisplay(progression: ProgressionModuleSchema | undefined): {
  currentName: string;
  nextName: string;
  progress: number;
  xpCurrent: number;
  xpNeeded: number;
} | null {
  if (!progression) return null;

  // 防御：确保 currentTierIndex 和 currentXP 有值
  const currentTierIndex = progression.currentTierIndex ?? 0;
  const currentXP = progression.currentXP ?? 0;

  // 等级制
  if (progression.mode === 'level' && progression.levelData) {
    const xpNeeded = getXpForNextTier(progression);
    const progress = getTierProgress(progression);
    return {
      currentName: `Lv.${currentTierIndex}`,
      nextName: currentTierIndex + 1 >= progression.levelData.maxLevel ? '已满级' : `Lv.${currentTierIndex + 1}`,
      progress,
      xpCurrent: currentXP,
      xpNeeded: xpNeeded === Infinity ? 0 : xpNeeded,
    };
  }

  // 段位制
  const tiers = progression.tiers;
  if (!tiers?.length) return null;
  const currentTier = tiers[currentTierIndex];
  const nextTier = tiers[currentTierIndex + 1];
  const xpNeeded = getXpForNextTier(progression);
  const progress = getTierProgress(progression);

  return {
    currentName: currentTier?.name || '未知',
    nextName: nextTier?.name || '已满级',
    progress,
    xpCurrent: currentXP,
    xpNeeded: xpNeeded === Infinity ? 0 : xpNeeded,
  };
}

/**
 * 获取属性的显示颜色
 * attrA: 红色系，attrB: 蓝色系
 */
export function getStatColor(statKey: string): string {
  if (statKey === 'attrA') return '#ef4444'; // 红
  if (statKey === 'attrB') return '#3b82f6'; // 蓝
  return '#60a5fa'; // 默认蓝
}
