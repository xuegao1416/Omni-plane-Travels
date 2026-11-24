import type { GameState,SkillData,InventoryItem } from '../../../../schema/variables';
import type { ProfessionModuleSchema,StatModuleSchema } from '../../../../modules/schema';
import type { WorldDef } from '../../../../data/worlds-schema';

/** 界面发起的玩法命令（装备、卸下、丢弃）；返回给玩家看的结果。 */
export type ProfileCommand = (command: string, args: Record<string, unknown>, label?: string) => { ok: boolean; feedback: string };

export interface ProfilePanelProps {
  gameState: GameState;
  /** 当前世界：决定是否有装备体系、属性名称与成长上限。 */
  world?: WorldDef;
  /** 是否启用了经营模块（启用时隐藏货币资源，因为右侧已有经营卡片） */
  hasBusinessModule?: boolean;
  professionConfig?: ProfessionModuleSchema;
  statConfig?: StatModuleSchema;
  /** 装备 / 卸下 / 丢弃走玩法宿主命令；不传（只读旅程）时界面只展示。 */
  onCommand?: ProfileCommand;
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
