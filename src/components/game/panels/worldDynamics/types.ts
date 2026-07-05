/**
 * 世界动态面板 Props 类型定义
 */

import type { GameState } from '../../../../schema/variables';
import type { SimulationRules } from '../../../../modules/schema';
import type { WorldDef } from '../../../../data/worlds-schema';

export interface WorldDynamicsPanelProps {
  gameState?: GameState;
  onManualTick?: () => void;
  isSimulating?: boolean;
  /** 当前世界定义（用于规则编辑器读取其他模块配置） */
  worldDef?: WorldDef | null;
  /** 规则变更回调 */
  onRulesChange?: (rules: SimulationRules) => void;
}
