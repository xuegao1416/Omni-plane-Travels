import type { WorldDef } from '../../data/worlds-schema';
import type { CombatScalingStatId, ProfessionAbilityDef, ProfessionModuleSchema, StatModuleSchema } from '../../modules/schema';
import { resolveProfessionBinding } from '../../data/professions';
import type { GameState, Task } from '../../schema/variables';
import { describeProfessionAbilityMechanics, describeProfessionMechanics } from '../profession';
import { getSixDimSemantic } from '../../modules/xpAlgorithm';
import type { ModuleRuntimeId } from './types';

export type ModuleContextTarget = 'main' | 'extraction';

export interface ModuleContextProjection {
  state: GameState;
  summary: string;
  /** 只包含当前职业的静态定义；不把其他职业整棵树塞进每轮上下文。 */
  professionDetail?: string;
  relevantModuleIds: ModuleRuntimeId[];
}

const MODULE_KEYWORDS: Record<ModuleRuntimeId, string[]> = {
  stat: ['受伤', '伤势', '生命', '体力', '精力', '属性', '治疗', '濒死', '恢复'],
  progression: ['升级', '经验', '突破', '进阶', '段位', '等级', '修为'],
  survival: ['喝水', '饮水', '口渴', '饥饿', '食物', '采集', '制作', '配方', '生存资源', '材料'],
  business: ['经营', '资金', '收入', '支出', '购买', '出售', '资产', '库存', '交易', '雇员'],
  dice: ['骰子', '掷骰', '检定', '大成功', '大失败', 'dc'],
  profession: ['职业', '技能', '能力', '天赋', '被动', '专精', '觉醒', '技能点', '天赋点', '攻击', '战斗', '施法', '出招', '治疗'],
};

const MODULE_ALIASES: Record<string, ModuleRuntimeId | undefined> = {
  stat: 'stat',
  progression: 'progression',
  survival: 'survival',
  business: 'business',
  dice: 'dice',
  talent: 'profession',
  profession: 'profession',
};

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function addTaskSignals(task: Task, relevant: Set<ModuleRuntimeId>): void {
  const stages = task.阶段 ?? [];
  const sources = [task, ...stages] as Array<Task | NonNullable<Task['阶段']>[number]>;
  for (const source of sources) {
    if (source.属性需求?.length) relevant.add('stat');
    if (source.资源需求?.length) relevant.add('survival');
    if (source.技能需求?.length) relevant.add('profession');
    if (source.骰子检定) relevant.add('dice');
  }
  if (task.奖励?.经验值 || task.奖励?.解锁段位 != null) relevant.add('progression');
  if (task.奖励?.技能?.length || task.奖励?.天赋?.length) relevant.add('profession');
  if (task.奖励?.资源 && Object.keys(task.奖励.资源).length) relevant.add('survival');
}

function collectDefinitionTokens(value: unknown, result: string[] = [], depth = 0): string[] {
  if (!value || typeof value !== 'object' || depth > 5) return result;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 100)) collectDefinitionTokens(item, result, depth + 1);
    return result;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (['id', 'name', '名称', 'label', 'title', '标题'].includes(key) && typeof child === 'string') {
      const token = child.trim().toLowerCase();
      if (token.length >= 2) result.push(token);
    } else if (child && typeof child === 'object') {
      collectDefinitionTokens(child, result, depth + 1);
    }
  }
  return result;
}

function enabledModules(worldDef?: WorldDef): Set<ModuleRuntimeId> {
  const enabled = new Set<ModuleRuntimeId>();
  for (const module of worldDef?.modules ?? []) {
    if (!module.enabled) continue;
    const canonical = MODULE_ALIASES[module.moduleId];
    if (canonical) enabled.add(canonical);
  }
  return enabled;
}

function detectRelevantModules(
  state: GameState,
  worldDef: WorldDef | undefined,
  text: string,
): Set<ModuleRuntimeId> {
  const relevant = new Set<ModuleRuntimeId>();
  const normalized = text.toLowerCase();
  const enabled = enabledModules(worldDef);

  for (const moduleId of enabled) {
    if (MODULE_KEYWORDS[moduleId].some(keyword => normalized.includes(keyword))) relevant.add(moduleId);
    // 新职业体系与旧 talent 模块可能同时存在于迁移中的世界。检索定义时必须
    // 优先职业包，否则会拿旧天赋表去解析职业树，导致能力名无法触发上下文。
    const definition = moduleId === 'profession'
      ? worldDef?.modules?.find(module => module.moduleId === 'profession' && module.enabled)
        ?? worldDef?.modules?.find(module => MODULE_ALIASES[module.moduleId] === moduleId && module.enabled)
      : worldDef?.modules?.find(module => MODULE_ALIASES[module.moduleId] === moduleId && module.enabled);
    const definitionData = moduleId === 'profession' && definition
      ? resolveProfessionBinding(definition.moduleConfig ?? definition.data)
      : definition?.moduleConfig ?? definition?.data;
    const tokens = collectDefinitionTokens(definitionData);
    if (tokens.some(token => normalized.includes(token))) relevant.add(moduleId);
  }

  const runtimeTokens: Partial<Record<ModuleRuntimeId, string[]>> = {
    stat: Object.keys(state.玩家.生存状态 ?? {}),
    survival: Object.entries(state.玩家.生存资源 ?? {}).flatMap(([id, value]) => [id, value.name ?? '']),
    business: (state.玩家.经营资产?.资产列表 ?? []).flatMap(asset => [asset.id, asset.名称]),
    profession: [
      ...Object.keys(state.玩家.技能系统 ?? {}),
      ...Object.keys(state.玩家.能力系统?.已掌握技能 ?? {}),
      ...Object.keys(state.玩家.能力系统?.已解锁天赋 ?? {}),
      ...Object.entries(state.玩家.能力系统?.职业状态?.已解锁能力 ?? {}).flatMap(([id, item]) => [id, item.名称 ?? '']),
      ...Object.values(state.玩家.能力系统?.先天天赋 ?? {}).map(item => item.名称),
      ...Object.values(state.玩家.能力系统?.后天天赋 ?? {}).map(item => item.名称),
    ],
  };
  for (const [moduleId, tokens] of Object.entries(runtimeTokens) as Array<[ModuleRuntimeId, string[] | undefined]>) {
    if (!enabled.has(moduleId)) continue;
    if (tokens?.some(token => token.trim().length >= 2 && normalized.includes(token.trim().toLowerCase()))) {
      relevant.add(moduleId);
    }
  }

  for (const event of state.gameplay?.pendingEvents ?? []) {
    const canonical = typeof event.moduleId === 'string' ? MODULE_ALIASES[event.moduleId] : undefined;
    if (canonical && enabled.has(canonical)) relevant.add(canonical);
  }

  for (const task of Object.values(state.玩家?.任务系统?.活跃任务 ?? {})) addTaskSignals(task, relevant);

  return relevant;
}

function summaryFor(state: GameState, enabled: Set<ModuleRuntimeId>): string {
  const parts: string[] = [];
  const player = state.玩家;
  if (enabled.has('stat')) {
    const values = Object.values(player.生存状态 ?? {}).filter(value => typeof value === 'number') as number[];
    const lowest = values.length ? Math.min(...values) : 100;
    parts.push(`属性:${lowest <= 20 ? '濒危' : lowest <= 45 ? '欠佳' : '稳定'}`);
  }
  if (enabled.has('progression')) parts.push(`成长:Lv.${player.当前段位索引 ?? 0}/${player.当前经验值 ?? 0}XP`);
  if (enabled.has('survival')) {
    const resources = Object.entries(player.生存资源 ?? {}).slice(0, 2)
      .map(([id, value]) => `${value.name ?? id}${value.数量}`);
    parts.push(`生存:${resources.join('、') || '无记录'}`);
  }
  if (enabled.has('business')) parts.push(`经营:${player.经营资产?.资金 ?? 0}资金/${player.经营资产?.资产列表?.length ?? 0}资产`);
  if (enabled.has('dice')) parts.push(`骰子:${state.dice?.lastRoll ? `${state.dice.lastRoll.total}/${state.dice.lastRoll.dc}` : '无待承接结果'}`);
  if (enabled.has('profession')) {
    const ability = player.能力系统;
    const profession = ability?.职业状态;
    parts.push(`职业:${profession?.职业名称 ?? '无职业'}/${Object.keys(profession?.已解锁能力 ?? {}).length}能力/${profession?.能力点 ?? 0}点`);
  }
  return parts.join('｜').slice(0, 360);
}

export function projectProfessionModuleConfig(
  state: GameState,
  worldDef?: WorldDef,
  relevanceText = '',
): ProfessionModuleSchema | undefined {
  const module = worldDef?.modules?.find(item => item.moduleId === 'profession' && item.enabled);
  if (!module) return undefined;
  const config: ProfessionModuleSchema = resolveProfessionBinding(module.moduleConfig ?? module.data);
  if (!config.professions.length) return undefined;
  const runtime = state.玩家.能力系统?.职业状态;
  const current = config.professions.find(item => item.id === runtime?.职业ID);
  const ownedAbilityIds = new Set(Object.keys(runtime?.已解锁能力 ?? {}));
  const normalizedText = relevanceText.toLowerCase();
  const selectedTalentIds = new Set(Object.keys(state.玩家.能力系统?.先天天赋 ?? {}));
  const ownedFreeSkillNames = new Set(Object.keys(state.玩家.技能系统 ?? {}));
  return {
    ...config,
    professions: current ? [{
      ...clone(current),
      abilities: current.abilities.filter(ability => (
        ownedAbilityIds.has(ability.id)
        || normalizedText.includes(ability.id.toLowerCase())
        || normalizedText.includes(ability.name.toLowerCase())
      )).map(clone),
    }] : [],
    innateTalents: (config.innateTalents ?? []).filter(item => selectedTalentIds.has(item.id)).map(clone),
    freeSkillCatalog: (config.freeSkillCatalog ?? []).filter(item => ownedFreeSkillNames.has(item.name) || ownedFreeSkillNames.has(item.id)).map(clone),
  };
}

function professionDetailFor(state: GameState, worldDef: WorldDef | undefined, relevanceText: string): string | undefined {
  const projected = projectProfessionModuleConfig(state, worldDef, relevanceText);
  const runtime = state.玩家.能力系统?.职业状态;
  if (!projected || !runtime) return undefined;
  const profession = projected.professions[0];
  const statModule = worldDef?.modules?.find(item => item.moduleId === 'stat' && item.enabled);
  const statConfig = (statModule?.moduleConfig ?? statModule?.data) as StatModuleSchema | undefined;
  const typeLabel: Record<ProfessionAbilityDef['type'], string> = {
    active: '主动', passive: '被动', specialization: '专精', ultimate: '终极',
  };
  const abilities = profession?.abilities.map(ability => {
    const owned = runtime.已解锁能力?.[ability.id];
    const mechanicText = describeProfessionAbilityMechanics(ability, statConfig, state)
      || (ability.diceModifier ? `相关检定修正 ${ability.diceModifier >= 0 ? '+' : ''}${ability.diceModifier}` : '仅提供叙事知识，不产生隐藏数值');
    const mechanics = `；确定性机制：${mechanicText}`;
    return `${ability.name}[${typeLabel[ability.type]}]${owned ? `已解锁Lv.${owned.等级}` : '未解锁'}：${ability.description}${mechanics}`;
  }) ?? [];
  const referencedStats = new Set<CombatScalingStatId>(abilities.length > 0 && profession
    ? profession.abilities.flatMap(ability => [
      ...(ability.activation?.combatAction?.scaling?.map(item => item.statId) ?? []),
      ...(ability.mechanics?.checks?.flatMap(item => item.statIds ?? []) ?? []),
    ])
    : []);
  for (const talent of projected.innateTalents) {
    for (const check of talent.mechanics?.checks ?? []) for (const statId of check.statIds ?? []) referencedStats.add(statId);
  }
  const statLegend = [...referencedStats].map(statId => {
    if (statId === 'attrA') return `attrA=${statConfig?.attrA?.name ?? '生命类'}(当前${state.玩家.生存状态.血量 ?? 0})`;
    if (statId === 'attrB') return `attrB=${statConfig?.attrB?.name ?? '能量类'}(当前${state.玩家.生存状态.体力值 ?? 0})`;
    const definition = statConfig?.[statId];
    return `${statId}=${definition?.name ?? getSixDimSemantic(statId).label}(${getSixDimSemantic(statId, definition).label}，当前${state.玩家.生存状态[statId] ?? 0})`;
  });
  const innate = projected.innateTalents.map(item => `${item.name}${describeProfessionMechanics(item.mechanics, statConfig) ? `（${describeProfessionMechanics(item.mechanics, statConfig)}）` : ''}`);
  const awakened = Object.keys(state.玩家.能力系统?.后天天赋 ?? {});
  const freeSkills = Object.keys(state.玩家.技能系统 ?? {});
  return [
    `当前职业:${runtime.职业名称}(Lv.${runtime.职业等级},能力点${runtime.能力点})`,
    '执行规则：已解锁职业能力与已选先天天赋的数值机制是唯一机械事实；可改变叙事表现，但不得临时改写基础值、倍率、行动点、冷却或检定加值。未解锁节点不能视为玩家已掌握。',
    statLegend.length ? `公式属性映射:${statLegend.join('；')}` : '',
    abilities.length ? `当前职业树:${abilities.join('；')}` : '',
    innate.length ? `先天天赋:${innate.join('、')}` : '',
    awakened.length ? `后天觉醒:${awakened.join('、')}` : '',
    freeSkills.length ? `自由技能:${freeSkills.join('、')}` : '',
  ].filter(Boolean).join('\n').slice(0, 2200);
}

function stripAllModuleState(state: GameState): GameState {
  const projected = clone(state) as any;
  delete projected.moduleRevisions;
  delete projected.dice;
  delete projected.玩家.生存状态;
  delete projected.玩家.当前段位索引;
  delete projected.玩家.当前经验值;
  delete projected.玩家.可用属性点;
  delete projected.玩家.生存资源;
  delete projected.玩家.生存配方;
  delete projected.玩家.经营资产;
  delete projected.玩家.能力系统;
  delete projected.玩家.技能系统;
  if (projected.gameplay) {
    delete projected.gameplay.stat;
    delete projected.gameplay.survival;
    delete projected.gameplay.business;
    delete projected.gameplay.logs;
    delete projected.gameplay.eventHistory;
    delete projected.gameplay.scheduledEvents;
    delete projected.gameplay.appliedMigrations;
    delete projected.gameplay.settlementKeys;
  }
  return projected;
}

function attachRelevantState(projected: GameState, source: GameState, relevant: Set<ModuleRuntimeId>): void {
  const target = projected as any;
  if (relevant.has('stat')) {
    target.玩家.生存状态 = clone(source.玩家.生存状态);
    if (source.gameplay?.stat) (target.gameplay ??= {}).stat = clone(source.gameplay.stat);
  }
  if (relevant.has('progression')) {
    target.玩家.当前段位索引 = source.玩家.当前段位索引;
    target.玩家.当前经验值 = source.玩家.当前经验值;
    target.玩家.可用属性点 = source.玩家.可用属性点;
  }
  if (relevant.has('survival')) {
    target.玩家.生存资源 = clone(source.玩家.生存资源 ?? {});
    target.玩家.生存配方 = clone(source.玩家.生存配方 ?? []);
    if (source.gameplay?.survival) (target.gameplay ??= {}).survival = clone(source.gameplay.survival);
  }
  if (relevant.has('business')) {
    target.玩家.经营资产 = clone(source.玩家.经营资产);
    if (source.gameplay?.business) (target.gameplay ??= {}).business = clone(source.gameplay.business);
  }
  if (relevant.has('dice')) target.dice = clone(source.dice);
  if (relevant.has('profession')) {
    const abilities = source.玩家.能力系统;
    target.玩家.能力系统 = abilities?.职业状态 ? {
      职业状态: clone(abilities.职业状态),
      先天天赋: clone(abilities.先天天赋 ?? {}),
      后天天赋: clone(abilities.后天天赋 ?? {}),
    } : clone(abilities);
    target.玩家.技能系统 = clone(source.玩家.技能系统 ?? {});
  }
}

export function buildModuleContextProjection(options: {
  state: GameState;
  worldDef?: WorldDef;
  userText?: string;
  aiText?: string;
  target: ModuleContextTarget;
}): ModuleContextProjection {
  const enabled = enabledModules(options.worldDef);
  const relevant = detectRelevantModules(
    options.state,
    options.worldDef,
    `${options.userText ?? ''}\n${options.aiText ?? ''}`,
  );
  for (const moduleId of [...relevant]) if (!enabled.has(moduleId)) relevant.delete(moduleId);

  const state = stripAllModuleState(options.state);
  attachRelevantState(state, options.state, relevant);
  return {
    state,
    summary: summaryFor(options.state, enabled),
    ...(relevant.has('profession') ? {
      professionDetail: professionDetailFor(
        options.state,
        options.worldDef,
        `${options.userText ?? ''}\n${options.aiText ?? ''}`,
      ),
    } : {}),
    relevantModuleIds: [...relevant],
  };
}
