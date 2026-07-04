/**
 * 世界动态面板 — 常量定义
 * 图标/颜色已提权到 src/constants/simulationDisplay.ts
 */

import type { EventLevel } from '../../../../simulation/types';
import { getSimulationEngine } from '../../../../simulation/SimulationApi';
import { STORAGE_KEYS } from '../../../../config/storageKeys';

export const SIM_API_PRESET_KEY = STORAGE_KEYS.SIM_API_PRESET;

/** 获取当前世界的自适应层级标签（兜底通用标签） */
export function getLevelLabel(level: EventLevel): string {
  try {
    return getSimulationEngine().getLevelLabels()[level] ?? level;
  } catch {
    return level;
  }
}

// ── 重新导出共享常量，保持向后兼容 ──
export { LEVEL_ICONS, LEVEL_COLORS, URGENCY_ICONS, URGENCY_LABELS } from '../../../../constants/simulationDisplay';
