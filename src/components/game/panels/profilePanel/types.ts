import type { GameState, SkillData, InventoryItem } from '../../../../schema/variables';

export interface ProfilePanelProps {
  gameState: GameState;
  /** 是否启用了经营模块（启用时隐藏货币资源，因为右侧已有经营卡片） */
  hasBusinessModule?: boolean;
}

export interface SkillSelection {
  name: string;
  data: SkillData;
}

export interface ItemSelection {
  name: string;
  data: InventoryItem;
}

export type { GameState, SkillData, InventoryItem };
