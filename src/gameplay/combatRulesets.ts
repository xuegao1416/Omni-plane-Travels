import type { CombatModuleSchema, CombatRulesetBinding } from '../modules/schema';

export interface BuiltinCombatRuleset {
  id: string;
  name: string;
  description: string;
  details: string[];
  config: Omit<CombatModuleSchema, 'encounters'>;
}

export const BUILTIN_COMBAT_RULESETS: BuiltinCombatRuleset[] = [
  {
    id: 'narrative',
    name: '轻量回合',
    description: '同样进入完整图形化战场，但每轮只做一件事，命中更宽松，结算节奏最快。',
    details: ['图形化战斗', '每轮一次行动', '玩家基础护甲 +1', '适合剧情、日常与轻冒险'],
    config: {
      description: '叙事优先的轻量战斗规则。',
      actionPointsPerTurn: 1,
      playerHpPath: '玩家.生存状态.血量',
      playerAttackPath: '玩家.生存状态.dim1',
      playerArmor: 1,
      playerInitiative: 2,
      playerActions: [
        { id: 'basic-attack', name: '普通攻击', target: 'enemy', actionCost: 1, accuracy: 12, damage: 3 },
        { id: 'guard', name: '稳固防守', target: 'self', actionCost: 1, healing: 2, cooldownRounds: 1 },
        { id: 'flee', name: '尝试脱离', target: 'self', actionCost: 1, healing: 0 },
      ],
    },
  },
  {
    id: 'tactical',
    name: '战术回合',
    description: '同样每轮只执行一次行动，更强调技能冷却、目标选择与队伍配合。',
    details: ['图形化战斗', '每轮一次行动', '无额外基础护甲', '适合队伍冒险'],
    config: {
      description: '能力组合与行动顺序并重的标准规则。',
      actionPointsPerTurn: 1,
      playerHpPath: '玩家.生存状态.血量',
      playerAttackPath: '玩家.生存状态.dim1',
      playerArmor: 0,
      playerInitiative: 0,
      playerActions: [
        { id: 'basic-attack', name: '普通攻击', target: 'enemy', actionCost: 1, accuracy: 10, damage: 2 },
        { id: 'focused-strike', name: '专注一击', target: 'enemy', actionCost: 1, accuracy: 13, damage: 5, cooldownRounds: 2 },
        { id: 'guard', name: '防守', target: 'self', actionCost: 1, healing: 1, cooldownRounds: 1 },
        { id: 'flee', name: '撤离', target: 'self', actionCost: 1, healing: 0 },
      ],
    },
  },
  {
    id: 'lethal',
    name: '残酷生存',
    description: '每回合 1 点行动、玩家后手且无基础护甲；攻击更凶险，失误代价明显更高。',
    details: ['图形化战斗', '每轮一次行动', '玩家先手 -1', '适合废土、恐怖与硬核生存'],
    config: {
      description: '高风险、低容错的残酷战斗规则。',
      actionPointsPerTurn: 1,
      playerHpPath: '玩家.生存状态.血量',
      playerAttackPath: '玩家.生存状态.dim1',
      playerArmor: 0,
      playerInitiative: -1,
      playerActions: [
        { id: 'basic-attack', name: '孤注一掷', target: 'enemy', actionCost: 1, accuracy: 9, damage: 5 },
        { id: 'guard', name: '寻找掩护', target: 'self', actionCost: 1, healing: 1, cooldownRounds: 2 },
        { id: 'flee', name: '逃离', target: 'self', actionCost: 1, healing: 0 },
      ],
    },
  },
];

export function createDefaultCombatBinding(): CombatRulesetBinding {
  return { rulesetId: 'narrative' };
}

export function resolveCombatRuleset(value: CombatRulesetBinding | CombatModuleSchema | unknown): CombatModuleSchema {
  if (value && typeof value === 'object' && Array.isArray((value as CombatModuleSchema).encounters)) {
    return value as CombatModuleSchema;
  }
  const id = value && typeof value === 'object' && typeof (value as CombatRulesetBinding).rulesetId === 'string'
    ? (value as CombatRulesetBinding).rulesetId
    : 'narrative';
  const ruleset = BUILTIN_COMBAT_RULESETS.find(item => item.id === id) ?? BUILTIN_COMBAT_RULESETS[0];
  return { ...structuredClone(ruleset.config), encounters: [] };
}
