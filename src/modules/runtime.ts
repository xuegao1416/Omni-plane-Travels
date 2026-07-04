// ============================================================
//  世界模块化系统 v2 — 运行时管理
//  管理 WorldSystemData 的读取和更新
// ============================================================

import type { WorldSystemData, StatModuleSchema, ProgressionModuleSchema, SurvivalModuleSchema, BusinessModuleSchema, DiceModuleSchema, TalentModuleSchema } from './schema';
import { getXpForNextTier, getTierProgress } from './xpAlgorithm';

/**
 * 从世界定义模块数据中提取 WorldSystemData
 * 数据来源：worldDef.modules[].moduleConfig（世界定义模块），不再从 GameState.世界.世界系统 读取
 * 兼容旧格式（WorldModuleRuntime）和新格式（WorldSystemData）
 */
export function extractWorldSystemData(
  worldSystem: Record<string, unknown> | undefined
): WorldSystemData {
  if (!worldSystem) return {};

  // 新格式：直接是 WorldSystemData
  if ('数值属性' in worldSystem || '成长体系' in worldSystem ||
      '生存资源' in worldSystem || '经营资产' in worldSystem || '骰子检定' in worldSystem) {
    const result = { ...worldSystem } as WorldSystemData;
    // 兼容：数值属性可能是嵌套格式 { config, initialState }，需要展平为 StatModuleSchema
    const statRaw = result.数值属性 as any;
    if (statRaw && typeof statRaw === 'object' && 'config' in statRaw && 'initialState' in statRaw) {
      const cfg = statRaw.config || {};
      const state = statRaw.initialState || {};
      const dim = (idx: number) => ({
        name: cfg[`dim${idx}`]?.name || `属性${idx}`,
        value: state[`dim${idx}Value`] ?? 50,
        range: cfg[`dim${idx}`]?.range || [0, 100],
      });
      const specialArr = Array.isArray(cfg.special) ? cfg.special.map((sp: any) => ({
        ...sp,
        value: state.special?.[sp.id] ?? 0,
      })) : [];
      result.数值属性 = {
        attrA: { name: cfg.attrA?.name || '生命', current: state.attrA ?? 80, max: cfg.attrA?.max ?? 100 },
        attrB: { name: cfg.attrB?.name || '能量', current: state.attrB ?? 60, max: cfg.attrB?.max ?? 100 },
        dim1: dim(1), dim2: dim(2), dim3: dim(3),
        dim4: dim(4), dim5: dim(5), dim6: dim(6),
        special: specialArr,
      } as any;
    }
    return result;
  }

  // 旧格式兼容：从 WorldModuleRuntime 提取数据
  const result: WorldSystemData = {};
  for (const [_key, value] of Object.entries(worldSystem)) {
    if (value && typeof value === 'object' && 'moduleId' in (value as any) && '数据' in (value as any)) {
      const mod = value as any;
      const data = mod.数据 as Record<string, unknown>;
      switch (mod.moduleId) {
        case 'stat':
          result.数值属性 = data as unknown as StatModuleSchema;
          break;
        case 'progression':
          result.成长体系 = data as unknown as ProgressionModuleSchema;
          break;
        case 'survival':
          result.生存资源 = data as unknown as SurvivalModuleSchema;
          break;
        case 'business':
          result.经营资产 = data as unknown as BusinessModuleSchema;
          break;
        case 'dice':
          result.骰子检定 = data as unknown as DiceModuleSchema;
          break;
        case 'talent':
          result.天赋体系 = data as unknown as TalentModuleSchema;
          break;
      }
    }
  }

  return result;
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
