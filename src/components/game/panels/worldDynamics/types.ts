/**
 * 世界动态面板 Props 类型定义
 */

import type { GameState } from '../../../../schema/variables';

export interface WorldDynamicsPanelProps {
  gameState?: GameState;
  onManualTick?: () => void;
  isSimulating?: boolean;
}
