import type { CombatModuleSchema } from '../schema';

export const COMBAT_RULES_PROMPT = `【战斗系统】
战斗由宿主按声明式规则结算：回合、行动点、目标、命中、伤害、状态持续时间、敌人行动和胜负均由本地规则确定。AI 只能描述结果，不得伪造生命、伤害、冷却或胜负；需要改变状态时由战斗系统产生 combat 事件。没有 active combat 时不要强行引入战斗状态。`;
// 非图形客户端也能遵循同一份机械事实，使用 combat session 的纯文本摘要。
export const COMBAT_TEXT_FALLBACK_PROMPT = `图形化战斗面板不可用时，使用简短摘要表达：【遭遇】状态｜第N回合｜玩家 HP/上限｜敌方名称 HP/上限（状态）。不要自行补写未出现在摘要中的伤害、奖励或胜负。`;

export function normalizeCombatConfig(value: unknown): CombatModuleSchema | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.encounters)) return undefined;
  const text = (candidate: unknown, fallback: string) => typeof candidate === 'string' && candidate.trim() ? candidate.trim() : fallback;
  const number = (candidate: unknown, fallback: number, min = 0, max = 1000) => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
  };
  const normalizeModifiers = (candidate: unknown): Record<string, number> | undefined => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
    const supported = new Set(['armor', 'accuracy', 'damage', 'healing']);
    const entries = Object.entries(candidate as Record<string, unknown>)
      .filter(([key, modifier]) => supported.has(key) && Number.isFinite(Number(modifier)))
      .map(([key, modifier]) => [key, number(modifier, 0, -999, 999)] as const);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  };
  const normalizeStatus = (candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object') return undefined;
    const status = candidate as Record<string, unknown>;
    return {
      id: text(status.id, 'status'),
      name: text(status.name, '状态'),
      description: typeof status.description === 'string' ? status.description : undefined,
      durationRounds: number(status.durationRounds, 1, 1, 20),
      damagePerRound: number(status.damagePerRound, 0, 0, 999),
      modifiers: normalizeModifiers(status.modifiers),
    };
  };
  const normalizeAction = (candidate: unknown, fallbackId: string) => {
    if (!candidate || typeof candidate !== 'object') return undefined;
    const action = candidate as Record<string, unknown>;
    if (!(typeof action.id === 'string' && action.id.trim()) && !(typeof action.name === 'string' && action.name.trim())) return undefined;
    const target = action.target === 'self' || action.target === 'ally' || action.target === 'enemy' ? action.target : 'enemy';
    return {
      id: text(action.id, fallbackId),
      name: text(action.name, '行动'),
      description: typeof action.description === 'string' ? action.description : undefined,
      target,
      actionCost: number(action.actionCost, 1, 1, 5),
      accuracy: number(action.accuracy, 10, 0, 20),
      damage: number(action.damage, 0, 0, 9999),
      healing: number(action.healing, 0, 0, 9999),
      damageType: typeof action.damageType === 'string' ? action.damageType : undefined,
      cooldownRounds: number(action.cooldownRounds, 0, 0, 20),
      appliesStatus: normalizeStatus(action.appliesStatus),
    };
  };
  const normalizeEnemy = (candidate: unknown, index: number) => {
    if (!candidate || typeof candidate !== 'object') return undefined;
    const enemy = candidate as Record<string, unknown>;
    const actions = Array.isArray(enemy.actions)
      ? enemy.actions.map((action, actionIndex) => normalizeAction(action, `enemy_${index + 1}_action_${actionIndex + 1}`)).filter(Boolean)
      : [];
    const statuses = Array.isArray(enemy.statuses)
      ? enemy.statuses.map(normalizeStatus).filter(Boolean)
      : [];
    return {
      id: text(enemy.id, `enemy_${index + 1}`),
      name: text(enemy.name, `敌人 ${index + 1}`),
      description: typeof enemy.description === 'string' ? enemy.description : undefined,
      maxHp: number(enemy.maxHp, 10, 1, 999999),
      armor: number(enemy.armor, 0, 0, 999),
      initiative: number(enemy.initiative, 0, -100, 100),
      actions,
      statuses,
    };
  };
  const normalizeRewards = (candidate: unknown) => Array.isArray(candidate)
    ? candidate.filter(item => item && typeof item === 'object' && ['set', 'add', 'append', 'remove', 'emit', 'schedule'].some(key => key in (item as Record<string, unknown>)))
    : undefined;
  const encounters = raw.encounters.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') return undefined;
    const encounter = candidate as Record<string, unknown>;
    const enemies = Array.isArray(encounter.enemies)
      ? encounter.enemies.map((enemy, enemyIndex) => normalizeEnemy(enemy, enemyIndex)).filter(Boolean)
      : [];
    if (enemies.length === 0) return undefined;
    return {
      id: text(encounter.id, `encounter_${index + 1}`),
      name: text(encounter.name, `遭遇 ${index + 1}`),
      description: typeof encounter.description === 'string' ? encounter.description : undefined,
      enemies,
      roundLimit: number(encounter.roundLimit, 100, 1, 999),
      rewards: normalizeRewards(encounter.rewards) as CombatModuleSchema['encounters'][number]['rewards'],
    };
  }).filter(Boolean);
  if (encounters.length === 0) return undefined;
  return {
    description: typeof raw.description === 'string' ? raw.description : undefined,
    actionPointsPerTurn: number(raw.actionPointsPerTurn, 1, 1, 5),
    playerHpPath: typeof raw.playerHpPath === 'string' && raw.playerHpPath.trim() ? raw.playerHpPath.trim() : '玩家.生存状态.血量',
    playerMaxHp: number(raw.playerMaxHp, 0, 0, 999999) || undefined,
    playerAttackPath: typeof raw.playerAttackPath === 'string' && raw.playerAttackPath.trim() ? raw.playerAttackPath.trim() : '玩家.生存状态.dim1',
    playerArmor: number(raw.playerArmor, 0, 0, 999),
    playerInitiative: number(raw.playerInitiative, 0, -100, 100),
    playerActions: Array.isArray(raw.playerActions)
      ? raw.playerActions.map((action, index) => normalizeAction(action, `player_action_${index + 1}`)).filter(Boolean)
      : undefined,
    encounters,
    deterministic: raw.deterministic === true,
  } as CombatModuleSchema;
}
