import type {
  CombatActionDefinition,
  CombatScalingDefinition,
  CombatScalingStatId,
  ProfessionAbilityDef,
  ProfessionAbilityMechanics,
  ProfessionDef,
  ProfessionModuleSchema,
  ProfessionPack,
  ProfessionWorldBinding,
} from '../../modules/schema';
import type { GameState } from '../../schema/variables';
import type { AbilityCategory, AbilityDefinition, AbilityProposal, AbilityProposalTarget, ProfessionPackV2 } from '../../gameplay/protocols';
import { abilityDefinitionFromInnateTalent, abilityDefinitionFromProfessionAbility, abilityDefinitionFromSkill, balanceAbilityProposal, isMechanicalAbilityDefinition } from '../../gameplay/abilitySystem';
import { migrateProfessionPack, normalizeAbilityProposal } from '../../gameplay/protocols';
import { FANTASY_CORE_PROFESSION_PACK } from './fantasy-core';
import { WUXIA_CORE_PROFESSION_PACK } from './wuxia-core';
import { fallbackProfessionAccent, fallbackProfessionEmblem, isProfessionAccentKey, isProfessionEmblemKey } from './professionVisuals';

const STORAGE_KEY = 'omni.profession-packs.v1';
const ENVELOPE_TYPE = 'omni-plane-travels-profession-pack';

export interface ProfessionPackValidationError {
  code: 'duplicate-id' | 'missing-prerequisite' | 'cycle' | 'tier-inversion' | 'missing-mechanics' | 'tier-count' | 'node-count' | 'ultimate-count' | 'exclusive-branches' | 'innate-count' | 'free-skill-count' | 'profession-count' | 'invalid-id';
  path: string;
  message: string;
}

export interface ProfessionPackValidationResult {
  ok: boolean;
  errors: ProfessionPackValidationError[];
}

export interface ProfessionPackValidationOptions {
  /** Explicitly permits additive migration of an old v1 package below the v3 content baseline. */
  allowLegacyV1?: boolean;
}

const combat = (
  damage: number,
  target: CombatActionDefinition['target'] = 'enemy',
  extra: Partial<CombatActionDefinition> = {},
): CombatActionDefinition => ({
  id: 'ability',
  name: '职业能力',
  target,
  actionCost: 1,
  accuracy: 10,
  damage,
  ...extra,
});

const branch = (
  id: string,
  name: string,
  type: ProfessionAbilityDef['type'],
  description: string,
  tier: number,
  prerequisites: string[],
  extra: Partial<ProfessionAbilityDef> = {},
): ProfessionAbilityDef => ({
  id,
  name,
  type,
  description,
  tier,
  prerequisites,
  pointCost: type === 'ultimate' ? 2 : 1,
  maxRank: 1,
  requiredProfessionLevel: tier,
  ...extra,
});

const EXTENSIONS: Record<string, ProfessionAbilityDef[]> = {
  warrior: [
    branch('shield_bash', '盾击', 'active', '以盾或护臂打断敌人的节奏。', 2, ['warrior_training'], { activation: { combatAction: combat(2, 'enemy', { appliesStatus: { id: 'staggered', name: '踉跄', durationRounds: 1, modifiers: { armor: -1 } } }) } }),
    branch('battle_hardened', '百战之躯', 'passive', '长期战斗让你更能承受伤害。', 3, ['power_strike']),
    branch('intercept', '截击', 'active', '在敌人逼近时抢先截断攻势。', 3, ['shield_bash'], { activation: { combatAction: combat(3, 'enemy', { accuracy: 12, cooldownRounds: 1 }) } }),
    branch('fortress', '移动壁垒', 'passive', '守护姿态下形成难以突破的防线。', 4, ['unyielding']),
    branch('warlord_command', '战阵号令', 'active', '以号令振奋自己并压制敌方。', 4, ['weapon_master'], { activation: { combatAction: combat(0, 'self', { healing: 4, cooldownRounds: 2 }) } }),
    branch('heroic_resolve', '英雄决意', 'passive', '越接近极限，意志与力量越坚定。', 5, ['fortress', 'battle_hardened']),
    branch('avatar_of_war', '战争化身', 'ultimate', '将守势与攻势融为一次决定胜负的爆发。', 5, ['warlord_command', 'intercept'], { cooldownTicks: 7, activation: { combatAction: combat(12, 'enemy', { accuracy: 13, cooldownRounds: 5 }) } }),
  ],
  mage: [
    branch('arcane_bolt', '奥术飞弹', 'active', '稳定释放追踪目标的奥术能量。', 2, ['arcane_study'], { activation: { combatAction: combat(3, 'enemy', { accuracy: 12 }) } }),
    branch('ice_lance', '冰枪术', 'active', '以寒冰穿刺并迟滞敌人。', 3, ['frost_school'], { activation: { combatAction: combat(4, 'enemy', { appliesStatus: { id: 'chilled', name: '寒冷', durationRounds: 2, modifiers: { accuracy: -1 } } }) } }),
    branch('flame_wave', '烈焰浪潮', 'active', '释放一轮猛烈的火焰冲击。', 3, ['flame_school'], { activation: { combatAction: combat(5, 'enemy', { cooldownRounds: 2 }) } }),
    branch('spell_weaving', '法术编织', 'passive', '在不同学派之间建立稳定的施法回路。', 3, ['arcane_bolt']),
    branch('absolute_zero', '绝对寒域', 'ultimate', '让目标周围的热量瞬间沉寂。', 5, ['ice_lance', 'mana_shield'], { cooldownTicks: 7, activation: { combatAction: combat(9, 'enemy', { appliesStatus: { id: 'frozen', name: '冻结', durationRounds: 2, modifiers: { armor: -2, accuracy: -2 } }, cooldownRounds: 5 }) } }),
    branch('phoenix_flame', '不灭炎心', 'passive', '烈焰在危急时转化为保护与新生。', 4, ['flame_wave']),
    branch('archmage', '大法师之证', 'ultimate', '以完整奥术回路释放超越常规的法术。', 5, ['spell_weaving', 'phoenix_flame'], { cooldownTicks: 8, activation: { combatAction: combat(13, 'enemy', { accuracy: 13, cooldownRounds: 6 }) } }),
  ],
  rogue: [
    branch('quick_step', '迅捷步', 'active', '快速改变位置，避开正面威胁。', 2, ['streetcraft'], { activation: { combatAction: combat(0, 'self', { healing: 2, cooldownRounds: 1 }) } }),
    branch('poison_edge', '淬毒刃', 'active', '让一次精准攻击附带持续毒伤。', 3, ['sneak_attack'], { activation: { combatAction: combat(3, 'enemy', { appliesStatus: { id: 'poisoned', name: '中毒', durationRounds: 3, damagePerRound: 2 }, cooldownRounds: 2 }) } }),
    branch('smoke_screen', '烟幕', 'active', '制造遮蔽并扰乱敌人瞄准。', 3, ['shadow_path'], { activation: { combatAction: combat(0, 'enemy', { appliesStatus: { id: 'blinded', name: '目盲', durationRounds: 2, modifiers: { accuracy: -3 } }, cooldownRounds: 3 }) } }),
    branch('riposte', '致命还击', 'active', '以精确反击惩罚敌人的破绽。', 3, ['duelist_path'], { activation: { combatAction: combat(5, 'enemy', { accuracy: 12, cooldownRounds: 2 }) } }),
    branch('ghost_walk', '幽影行者', 'passive', '在混乱中移动时几乎不留痕迹。', 4, ['vanish', 'smoke_screen']),
    branch('master_duelist', '决斗大师', 'passive', '读懂对手的节奏并不断扩大优势。', 4, ['riposte']),
    branch('thousand_cuts', '千刃终幕', 'ultimate', '从所有死角发动连续的终结打击。', 5, ['ghost_walk', 'master_duelist'], { cooldownTicks: 7, activation: { combatAction: combat(12, 'enemy', { accuracy: 14, cooldownRounds: 5 }) } }),
  ],
  cleric: [
    branch('blessing', '祝福', 'active', '以神术强化同伴的状态。', 2, ['divine_cant'], { activation: { combatAction: combat(0, 'self', { healing: 3, cooldownRounds: 1 }) } }),
    branch('radiant_bolt', '圣光箭', 'active', '凝聚圣光打击敌对目标。', 2, ['divine_cant'], { activation: { combatAction: combat(3, 'enemy', { accuracy: 12 }) } }),
    branch('greater_heal', '强效治愈', 'active', '持续祈祷以修复严重创伤。', 3, ['healing_word'], { activation: { combatAction: combat(0, 'self', { healing: 7, cooldownRounds: 2 }) } }),
    branch('turn_darkness', '驱散黑暗', 'active', '以圣辉驱逐恐惧、邪祟与污染。', 3, ['light_domain'], { activation: { combatAction: combat(5, 'enemy', { appliesStatus: { id: 'weakened', name: '虚弱', durationRounds: 2, modifiers: { damage: -2 } }, cooldownRounds: 2 }) } }),
    branch('sanctuary', '庇护圣域', 'passive', '在身边维持一片令人安心的庇护。', 4, ['purify', 'greater_heal']),
    branch('sun_domain', '辉日化身', 'passive', '让光明神术获得更强的净化力量。', 4, ['turn_darkness']),
    branch('miracle', '复苏神迹', 'ultimate', '以信仰唤回濒临消散的生命之火。', 5, ['sanctuary', 'sun_domain'], { cooldownTicks: 9, activation: { combatAction: combat(0, 'self', { healing: 18, cooldownRounds: 7 }) } }),
  ],
  paladin: [
    branch('lay_on_hands', '圣疗', 'active', '以誓约之力治疗伤势。', 2, ['sacred_oath'], { activation: { combatAction: combat(0, 'self', { healing: 5, cooldownRounds: 2 }) } }),
    branch('challenge', '神圣挑战', 'active', '迫使敌人直面你的裁决。', 2, ['sacred_oath'], { activation: { combatAction: combat(2, 'enemy', { appliesStatus: { id: 'challenged', name: '受挑战', durationRounds: 2, modifiers: { damage: -1 } } }) } }),
    branch('aura_courage', '勇气灵光', 'passive', '让身边的人抵抗恐惧与动摇。', 3, ['oath_devotion']),
    branch('relentless_hunt', '无休追猎', 'active', '锁定罪敌并连续逼近。', 3, ['oath_vengeance'], { activation: { combatAction: combat(5, 'enemy', { accuracy: 12, cooldownRounds: 2 }) } }),
    branch('holy_bulwark', '圣辉壁垒', 'passive', '守护灵光凝成坚实防线。', 4, ['aura_guard', 'aura_courage']),
    branch('avenging_angel', '复仇天使', 'passive', '追猎强敌时获得不可动摇的意志。', 4, ['relentless_hunt']),
    branch('oath_incarnate', '誓约化身', 'ultimate', '以全部誓言完成最终裁决并庇护同伴。', 5, ['holy_bulwark', 'avenging_angel'], { cooldownTicks: 8, activation: { combatAction: combat(12, 'enemy', { accuracy: 13, cooldownRounds: 6 }) } }),
  ],
  swordsman: [
    branch('sword_step', '踏雪寻隙', 'active', '借轻灵步法切入剑势最有利的位置。', 2, ['sword_foundation'], { activation: { combatAction: combat(3, 'enemy', { accuracy: 12 }) } }),
    branch('sword_rain', '细雨连剑', 'active', '剑光绵密如雨，持续压迫对手。', 3, ['sword_swift'], { activation: { combatAction: combat(5, 'enemy', { cooldownRounds: 2 }) } }),
    branch('sword_sense', '听剑', 'passive', '从风声与震动中感知兵刃来路。', 3, ['sword_intent']),
    branch('sword_break', '破招', 'active', '看穿招式衔接处的短暂破绽。', 3, ['sword_form'], { activation: { combatAction: combat(4, 'enemy', { appliesStatus: { id: 'broken-form', name: '招式被破', durationRounds: 2, modifiers: { armor: -2 } } }) } }),
    branch('sword_domain', '剑域', 'passive', '让周身距离都成为剑势的一部分。', 4, ['sword_heart', 'sword_sense']),
    branch('sword_mastery', '万剑归宗', 'passive', '融会不同剑理，招式随心而变。', 4, ['sword_rain', 'sword_break']),
    branch('sword_void', '无剑之境', 'ultimate', '不拘器形，以心意斩断眼前阻碍。', 5, ['sword_domain', 'sword_mastery'], { activation: { combatAction: combat(13, 'enemy', { accuracy: 14, cooldownRounds: 6 }) } }),
  ],
  bladesman: [
    branch('blade_shock', '震刀', 'active', '以刀背震开防御并夺取节奏。', 2, ['blade_foundation'], { activation: { combatAction: combat(3, 'enemy', { appliesStatus: { id: 'shaken', name: '震荡', durationRounds: 1, modifiers: { armor: -1 } } }) } }),
    branch('blade_chain', '连环劈斩', 'active', '刀势一重接一重，不给对手喘息。', 3, ['blade_fierce'], { activation: { combatAction: combat(5, 'enemy', { cooldownRounds: 2 }) } }),
    branch('blade_wait', '抱刀守一', 'passive', '收束心神，将力量留给真正的机会。', 3, ['blade_calm']),
    branch('blade_breaker', '摧甲', 'active', '专门破坏护具与护体劲力。', 3, ['blade_cleave'], { activation: { combatAction: combat(4, 'enemy', { appliesStatus: { id: 'armor-broken', name: '破甲', durationRounds: 3, modifiers: { armor: -2 } } }) } }),
    branch('blade_tyrant', '霸刀之势', 'passive', '仅凭刀势便足以令寻常敌手迟疑。', 4, ['blade_pressure', 'blade_chain']),
    branch('blade_hidden', '藏锋百日', 'passive', '长久蓄势换来一瞬不可阻挡的锋芒。', 4, ['blade_wait', 'blade_breaker']),
    branch('blade_one', '刀意唯一', 'ultimate', '舍弃变化，将全部刀意化作唯一答案。', 5, ['blade_tyrant', 'blade_hidden'], { activation: { combatAction: combat(14, 'enemy', { accuracy: 12, cooldownRounds: 6 }) } }),
  ],
  spearmaster: [
    branch('spear_sweep', '横扫千军', 'active', '以枪杆和枪锋控制大片近身空间。', 2, ['spear_foundation'], { activation: { combatAction: combat(3, 'enemy') } }),
    branch('spear_wall', '拒马枪阵', 'passive', '枪势如墙，逼迫敌人止步。', 3, ['spear_guard']),
    branch('spear_dash', '白虹贯阵', 'active', '沿直线突进并贯穿最薄弱处。', 3, ['spear_charge'], { activation: { combatAction: combat(6, 'enemy', { cooldownRounds: 2 }) } }),
    branch('spear_feint', '回马枪', 'active', '佯退后骤然回身刺出致命一枪。', 3, ['spear_thrust'], { activation: { combatAction: combat(5, 'enemy', { accuracy: 13, cooldownRounds: 2 }) } }),
    branch('spear_general', '阵前大将', 'passive', '身处乱阵仍能看清进退与阵眼。', 4, ['spear_circle', 'spear_wall']),
    branch('spear_storm', '百鸟朝凤', 'passive', '枪势变化繁复，却始终围绕一点杀机。', 4, ['spear_dash', 'spear_feint']),
    branch('spear_star', '枪出如龙', 'ultimate', '精气神与长枪化作贯日游龙。', 5, ['spear_general', 'spear_storm'], { activation: { combatAction: combat(13, 'enemy', { accuracy: 13, cooldownRounds: 6 }) } }),
  ],
  unarmed: [
    branch('fist_step', '贴山靠', 'active', '近身贴靠，以全身整劲撞开敌人。', 2, ['fist_foundation'], { activation: { combatAction: combat(3, 'enemy', { appliesStatus: { id: 'off-balance', name: '失衡', durationRounds: 1, modifiers: { armor: -1 } } }) } }),
    branch('fist_iron', '铁布衫', 'passive', '外练筋骨皮，逐步适应重击。', 3, ['fist_hard']),
    branch('fist_listen', '听劲', 'passive', '通过接触感知来力并借势化解。', 3, ['fist_inner']),
    branch('fist_chain', '连环短打', 'active', '在方寸之间连续击打要害。', 3, ['fist_burst'], { activation: { combatAction: combat(5, 'enemy', { cooldownRounds: 2 }) } }),
    branch('fist_diamond', '金刚不坏', 'passive', '刚柔并济，肉身如同稳固金刚。', 4, ['fist_guard', 'fist_iron']),
    branch('fist_transform', '化劲', 'active', '化去来力并将其反送回去。', 4, ['fist_listen', 'fist_chain'], { activation: { combatAction: combat(7, 'enemy', { accuracy: 12, cooldownRounds: 3 }) } }),
    branch('fist_natural', '拳意天成', 'ultimate', '不思不虑，身体自然给出最合适的一击。', 5, ['fist_diamond', 'fist_transform'], { activation: { combatAction: combat(13, 'enemy', { accuracy: 13, cooldownRounds: 6 }) } }),
  ],
};

const PROFESSION_PRIMARY_STAT: Record<string, CombatScalingStatId> = {
  warrior: 'dim1', mage: 'dim4', rogue: 'dim3', cleric: 'dim5', paladin: 'dim1',
  swordsman: 'dim3', bladesman: 'dim1', spearmaster: 'dim1', unarmed: 'dim2',
};

const PROFESSION_CHECK_STAT: Record<string, CombatScalingStatId> = {
  ...PROFESSION_PRIMARY_STAT,
  paladin: 'dim5',
};

const PROFESSION_PASSIVE_FOCUS: Record<string, keyof NonNullable<ProfessionAbilityMechanics['combat']>> = {
  warrior: 'armor', mage: 'accuracy', rogue: 'initiative', cleric: 'healing', paladin: 'armor',
  swordsman: 'accuracy', bladesman: 'damage', spearmaster: 'accuracy', unarmed: 'armor',
};

const ROOT_MECHANICS: Record<string, ProfessionAbilityMechanics> = {
  warrior_training: { combat: { damage: 1 }, checks: [{ statIds: ['dim1'], value: 1 }] },
  arcane_study: { combat: { accuracy: 1 }, checks: [{ statIds: ['dim4'], value: 1 }] },
  streetcraft: { combat: { initiative: 1 }, checks: [{ statIds: ['dim3'], value: 1 }] },
  divine_cant: { combat: { healing: 1 }, checks: [{ statIds: ['dim5'], value: 1 }] },
  sacred_oath: { combat: { armor: 1 }, checks: [{ statIds: ['dim5'], value: 1 }] },
  sword_foundation: { combat: { damage: 1 }, checks: [{ statIds: ['dim3'], value: 1 }] },
  blade_foundation: { combat: { damage: 1 }, checks: [{ statIds: ['dim1'], value: 1 }] },
  spear_foundation: { combat: { accuracy: 1 }, checks: [{ statIds: ['dim1'], value: 1 }] },
  fist_foundation: { combat: { armor: 1 }, checks: [{ statIds: ['dim2'], value: 1 }] },
};

function clone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as T;
}

function depthOf(ability: ProfessionAbilityDef, byId: Map<string, ProfessionAbilityDef>, seen = new Set<string>()): number {
  if (seen.has(ability.id) || !ability.prerequisites?.length) return 1;
  seen.add(ability.id);
  const parents = ability.prerequisites.map(id => byId.get(id)).filter(Boolean) as ProfessionAbilityDef[];
  return parents.length ? 1 + Math.max(...parents.map(parent => depthOf(parent, byId, new Set(seen)))) : 1;
}

function defaultAbilityMechanics(professionId: string, ability: ProfessionAbilityDef, tier: number): ProfessionAbilityMechanics | undefined {
  if (ability.mechanics) return clone(ability.mechanics);
  if (ROOT_MECHANICS[ability.id]) return clone(ROOT_MECHANICS[ability.id]);
  if (ability.type !== 'passive' && ability.type !== 'specialization') return undefined;
  const value = tier >= 4 ? 2 : 1;
  const focus = PROFESSION_PASSIVE_FOCUS[professionId] ?? 'damage';
  return {
    combat: { [focus]: value },
    checks: [{ statIds: [PROFESSION_CHECK_STAT[professionId] ?? 'dim1'], value }],
  };
}

function enrichProfession(source: ProfessionDef): ProfessionDef {
  const abilities = [...clone(source.abilities), ...clone(EXTENSIONS[source.id] ?? [])];
  const byId = new Map(abilities.map(item => [item.id, item]));
  let ultimateSeen = false;
  return {
    ...clone(source),
    visual: {
      emblemKey: isProfessionEmblemKey(source.visual?.emblemKey) ? source.visual.emblemKey : fallbackProfessionEmblem(source.id),
      accentKey: isProfessionAccentKey(source.visual?.accentKey) ? source.visual.accentKey : fallbackProfessionAccent(source.id),
    },
    abilities: abilities.map(item => {
      const type = item.type === 'ultimate' && ultimateSeen ? 'active' : item.type;
      if (type === 'ultimate') ultimateSeen = true;
      const tier = Math.min(4, Math.max(1, item.tier ?? depthOf(item, byId)));
      const combatAction = item.activation?.combatAction ?? (
        type === 'active' || type === 'ultimate'
          ? combat(type === 'ultimate' ? 10 : 4, 'enemy', { cooldownRounds: Math.max(0, item.cooldownTicks ?? 0) })
          : undefined
      );
      const scalingTarget: NonNullable<CombatScalingDefinition['appliesTo']> = (combatAction?.healing ?? 0) > (combatAction?.damage ?? 0) ? 'healing' : 'damage';
      const resolvedCombatAction = combatAction ? {
        ...combatAction,
        id: item.id,
        name: item.name,
        description: item.description,
        scaling: combatAction.scaling?.length ? combatAction.scaling : [{
          statId: PROFESSION_PRIMARY_STAT[source.id] ?? 'dim1',
          coefficient: type === 'ultimate' ? 0.2 : 0.08,
          appliesTo: scalingTarget,
        }],
      } : undefined;
      const mechanics = defaultAbilityMechanics(source.id, item, tier);
      return {
        ...item,
        ...(isProfessionEmblemKey(item.iconKey) ? { iconKey: item.iconKey } : { iconKey: fallbackProfessionEmblem(source.id) }),
        type,
        tier,
        requiredProfessionLevel: Math.min(4, item.requiredProfessionLevel ?? tier),
        ...(mechanics ? { mechanics } : {}),
        ...(resolvedCombatAction ? { activation: { ...(item.activation ?? {}), combatAction: resolvedCombatAction } } : {}),
      };
    }),
  };
}

function makePack(id: string, name: string, description: string, source: ProfessionModuleSchema, tags: string[]): ProfessionPack {
  return {
    ...clone(source),
    schemaVersion: 2,
    freeSkills: clone(source.freeSkillCatalog ?? source.freeSkills ?? []),
    manifest: {
      id,
      name,
      version: '2.0.0',
      schemaVersion: 2,
      description,
      author: '世界漫游指南',
      builtin: true,
      tags,
    },
    professions: source.professions.map(enrichProfession),
  };
}

export function professionPackToV2(pack: ProfessionPack): ProfessionPackV2 {
  return {
    schemaVersion: 2,
    manifest: {
      id: pack.manifest.id,
      name: pack.manifest.name,
      version: pack.manifest.version,
      schemaVersion: 2,
      ...(pack.manifest.description ? { description: pack.manifest.description } : {}),
      ...(pack.manifest.author ? { author: pack.manifest.author } : {}),
      ...(pack.manifest.createdAt === undefined ? {} : { createdAt: pack.manifest.createdAt }),
      ...(pack.manifest.updatedAt === undefined ? {} : { updatedAt: pack.manifest.updatedAt }),
      ...(pack.manifest.builtin === undefined ? {} : { builtin: pack.manifest.builtin }),
      tags: [...(pack.manifest.tags ?? [])],
    },
    professions: pack.professions.map(profession => ({
      id: profession.id,
      name: profession.name,
      description: profession.description,
      ...(profession.archetype ? { archetype: profession.archetype } : {}),
      ...(profession.visual ? { visual: {
        ...(isProfessionEmblemKey(profession.visual.emblemKey) ? { emblemKey: profession.visual.emblemKey } : {}),
        ...(isProfessionAccentKey(profession.visual.accentKey) ? { accentKey: profession.visual.accentKey } : {}),
      } } : {}),
      tags: [...(profession.tags ?? [])],
      abilities: profession.abilities.map(ability => abilityDefinitionFromProfessionAbility(ability, profession.id)),
    })),
    innateTalents: pack.innateTalents.map(abilityDefinitionFromInnateTalent),
    freeSkills: (pack.freeSkillCatalog ?? pack.freeSkills ?? []).map(abilityDefinitionFromSkill),
    creationTalentBudget: Math.max(0, Math.trunc(pack.creationTalentBudget)),
    allowNoProfession: pack.allowNoProfession !== false,
    initialAbilityPoints: Math.max(0, Math.trunc(pack.initialAbilityPoints ?? 0)),
    abilityPointsPerTier: Math.max(0, Math.trunc(pack.abilityPointsPerTier ?? 0)),
    ...(pack.baselineStatus ? { baselineStatus: pack.baselineStatus } : {}),
  };
}

function definitionToLegacyProfessionAbility(definition: AbilityDefinition): ProfessionAbilityDef {
  const mechanics = definition.mechanics;
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    type: definition.abilityType === 'passive' || definition.abilityType === 'specialization' || definition.abilityType === 'ultimate' ? definition.abilityType : 'active',
    ...(definition.maxRank === undefined ? {} : { maxRank: definition.maxRank }),
    ...(definition.pointCost === undefined ? {} : { pointCost: definition.pointCost }),
    ...(definition.rankCosts ? { rankCosts: [...definition.rankCosts] } : {}),
    ...(definition.tier === undefined ? {} : { tier: definition.tier }),
    ...(definition.requiredProfessionLevel === undefined ? {} : { requiredProfessionLevel: definition.requiredProfessionLevel }),
    prerequisites: [...definition.prerequisites],
    prerequisiteMode: definition.prerequisiteMode,
    ...(definition.exclusiveGroup ? { exclusiveGroup: definition.exclusiveGroup } : {}),
    ...(mechanics?.cooldownRounds === undefined ? {} : { cooldownTicks: mechanics.cooldownRounds }),
    ...(mechanics?.diceModifier === undefined ? {} : { diceModifier: mechanics.diceModifier }),
    ...(mechanics?.passiveEffects?.length ? { passiveEffects: clone(mechanics.passiveEffects) } : {}),
    ...(mechanics?.combat || mechanics?.checks?.length ? { mechanics: { ...(mechanics.combat ? { combat: clone(mechanics.combat) } : {}), ...(mechanics.checks?.length ? { checks: clone(mechanics.checks) } : {}) } } : {}),
    ...(mechanics && (mechanics.costs?.length || mechanics.effects?.length || mechanics.rewards?.length || mechanics.combatAction) ? {
      activation: {
        ...(mechanics.costs?.length ? { costs: clone(mechanics.costs) } : {}),
        ...(mechanics.effects?.length ? { effects: clone(mechanics.effects) } : {}),
        ...(mechanics.rewards?.length ? { rewards: clone(mechanics.rewards) } : {}),
        ...(mechanics.combatAction ? { combatAction: clone(mechanics.combatAction) } : {}),
      },
    } : {}),
    tags: [...definition.tags],
    ...(definition.iconKey ? { iconKey: definition.iconKey } : {}),
  };
}

export function professionPackFromV2(pack: ProfessionPackV2): ProfessionPack {
  const freeSkills = pack.freeSkills.map(definition => ({
    id: definition.id,
    name: definition.name,
    description: definition.description,
    rarity: definition.rarity,
    maxRank: definition.maxRank,
    pointCost: definition.pointCost,
    ...(definition.rankCosts ? { rankCosts: [...definition.rankCosts] } : {}),
    prerequisites: [...definition.prerequisites],
    tags: [...definition.tags],
    ...(definition.mechanics?.cooldownRounds === undefined ? {} : { cooldownTicks: definition.mechanics.cooldownRounds }),
    ...(definition.mechanics?.proficiency ? { proficiency: clone(definition.mechanics.proficiency) } : {}),
    ...(definition.mechanics && (definition.mechanics.costs?.length || definition.mechanics.effects?.length || definition.mechanics.rewards?.length) ? { activation: { ...(definition.mechanics.costs?.length ? { costs: clone(definition.mechanics.costs) } : {}), ...(definition.mechanics.effects?.length ? { effects: clone(definition.mechanics.effects) } : {}), ...(definition.mechanics.rewards?.length ? { rewards: clone(definition.mechanics.rewards) } : {}) } } : {}),
    ...(definition.mechanics?.diceModifier === undefined ? {} : { diceModifier: definition.mechanics.diceModifier }),
  }));
  return {
    schemaVersion: 2,
    manifest: {
      ...pack.manifest,
      schemaVersion: 2,
      tags: [...pack.manifest.tags],
    },
    professions: pack.professions.map(profession => ({
      id: profession.id,
      name: profession.name,
      description: profession.description,
      ...(profession.archetype ? { archetype: profession.archetype } : {}),
      ...(profession.visual ? { visual: { ...profession.visual } } : {}),
      tags: [...profession.tags],
      abilities: profession.abilities.map(definitionToLegacyProfessionAbility),
    })),
    innateTalents: pack.innateTalents.map(definition => ({
      id: definition.id,
      name: definition.name,
      description: definition.description,
      cost: definition.pointCost,
      rarity: definition.rarity,
      ...(definition.exclusiveGroup ? { exclusiveGroup: definition.exclusiveGroup } : {}),
      prerequisites: [...definition.prerequisites],
      ...(definition.mechanics?.effects?.length ? { effects: clone(definition.mechanics.effects) } : {}),
      ...(definition.mechanics?.combat || definition.mechanics?.checks?.length ? { mechanics: { ...(definition.mechanics.combat ? { combat: clone(definition.mechanics.combat) } : {}), ...(definition.mechanics.checks?.length ? { checks: clone(definition.mechanics.checks) } : {}) } } : {}),
      tags: [...definition.tags],
      ...(definition.iconKey ? { iconKey: definition.iconKey } : {}),
    })),
    freeSkillCatalog: freeSkills,
    freeSkills: clone(freeSkills),
    creationTalentBudget: pack.creationTalentBudget,
    allowNoProfession: pack.allowNoProfession,
    initialAbilityPoints: pack.initialAbilityPoints,
    abilityPointsPerTier: pack.abilityPointsPerTier,
    ...(pack.baselineStatus ? { baselineStatus: pack.baselineStatus } : {}),
  };
}

export const BUILTIN_PROFESSION_PACKS: ProfessionPack[] = [
  makePack('fantasy-core', '经典幻想职业典藏', '战士、法师、游侠、盗贼、牧师与圣骑士组成的六职业完整能力树。', FANTASY_CORE_PROFESSION_PACK, ['奇幻', 'DND', '冒险']),
  makePack('wuxia-core', '江湖武学职业典藏', '剑、刀、枪、拳、医者与奇门六条道路及独立生活技艺。', WUXIA_CORE_PROFESSION_PACK, ['武侠', '江湖']),
];

/** Canonical v2 packages used by runtime/editor integrations; legacy projections remain for old callers. */
export const BUILTIN_PROFESSION_PACKS_V2: ProfessionPackV2[] = BUILTIN_PROFESSION_PACKS.map(professionPackToV2);

function readUserPacks(): ProfessionPack[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isProfessionPack).map(pack => normalizeProfessionPack(pack)) : [];
  } catch {
    return [];
  }
}

function writeUserPacks(packs: ProfessionPack[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(packs.map(pack => ({ ...pack, manifest: { ...pack.manifest, builtin: false } }))));
}

export function listProfessionPacks(): ProfessionPack[] {
  return [...BUILTIN_PROFESSION_PACKS.map(clone), ...readUserPacks()];
}

export function getProfessionPack(id: string): ProfessionPack | undefined {
  return listProfessionPacks().find(pack => pack.manifest.id === id);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isLegacyV1Value(value: unknown): boolean {
  const raw = asRecord(value);
  const manifest = asRecord(raw?.manifest);
  return raw?.schemaVersion === 1
    || manifest?.schemaVersion === 1
    || raw?.baselineStatus === 'legacy-v1-incomplete';
}

function pushValidationError(errors: ProfessionPackValidationError[], error: ProfessionPackValidationError): void {
  if (!errors.some(item => item.code === error.code && item.path === error.path && item.message === error.message)) errors.push(error);
}

function validateRawIds(value: unknown, errors: ProfessionPackValidationError[]): void {
  const raw = asRecord(value);
  const manifest = asRecord(raw?.manifest);
  if (!manifest || typeof manifest.id !== 'string' || !manifest.id.trim()) {
    pushValidationError(errors, { code: 'invalid-id', path: 'manifest.id', message: '职业包必须有稳定 ID。' });
  }
  const professions = Array.isArray(raw?.professions) ? raw.professions : [];
  for (const [professionIndex, item] of professions.entries()) {
    const profession = asRecord(item);
    if (!profession || typeof profession.id !== 'string' || !profession.id.trim()) {
      pushValidationError(errors, { code: 'invalid-id', path: `professions[${professionIndex}]`, message: '职业必须有稳定 ID。' });
      continue;
    }
    const abilities = Array.isArray(profession.abilities) ? profession.abilities : [];
    for (const [abilityIndex, ability] of abilities.entries()) {
      const node = asRecord(ability);
      if (!node || typeof node.id !== 'string' || !node.id.trim()) {
        pushValidationError(errors, { code: 'invalid-id', path: `professions[${professionIndex}].abilities[${abilityIndex}]`, message: '能力节点必须有稳定 ID。' });
      }
    }
  }
  for (const [index, item] of (Array.isArray(raw?.innateTalents) ? raw.innateTalents : []).entries()) {
    if (!asRecord(item) || typeof asRecord(item)?.id !== 'string' || !String(asRecord(item)?.id).trim()) {
      pushValidationError(errors, { code: 'invalid-id', path: `innateTalents[${index}]`, message: '先天天赋必须有稳定 ID。' });
    }
  }
  const freeSkills = Array.isArray(raw?.freeSkills) ? raw.freeSkills : raw?.freeSkillCatalog;
  for (const [index, item] of (Array.isArray(freeSkills) ? freeSkills : []).entries()) {
    if (!asRecord(item) || typeof asRecord(item)?.id !== 'string' || !String(asRecord(item)?.id).trim()) {
      pushValidationError(errors, { code: 'invalid-id', path: `freeSkills[${index}]`, message: '自由技能必须有稳定 ID。' });
    }
  }
}

export function validateProfessionPack(value: unknown, options: ProfessionPackValidationOptions = {}): ProfessionPackValidationResult {
  const errors: ProfessionPackValidationError[] = [];
  validateRawIds(value, errors);
  const pack = migrateProfessionPack(value);
  const legacyV1 = options.allowLegacyV1 === true && isLegacyV1Value(value);
  const seenIds = new Map<string, string>();
  const registerId = (id: string, path: string) => {
    const previous = seenIds.get(id);
    if (previous) pushValidationError(errors, { code: 'duplicate-id', path, message: `ID「${id}」与 ${previous} 重复。` });
    else seenIds.set(id, path);
  };
  registerId(pack.manifest.id, 'manifest.id');
  if (pack.professions.length === 0) pushValidationError(errors, { code: 'profession-count', path: 'professions', message: '职业包至少需要一个职业。' });
  for (const [professionIndex, profession] of pack.professions.entries()) {
    const professionPath = `professions[${professionIndex}]`;
    registerId(profession.id, `${professionPath}.id`);
    const byId = new Map(profession.abilities.map(ability => [ability.id, ability]));
    const tiers = new Set(profession.abilities.map(ability => ability.tier ?? 1));
    if (!legacyV1 && profession.abilities.length < 8) pushValidationError(errors, { code: 'node-count', path: professionPath, message: `${profession.name} 至少需要 8 个能力节点。` });
    if (!legacyV1 && (tiers.size !== 4 || ![1, 2, 3, 4].every(tier => tiers.has(tier)))) pushValidationError(errors, { code: 'tier-count', path: professionPath, message: `${profession.name} 必须覆盖明确的 1~4 阶。` });
    const ultimateCount = profession.abilities.filter(ability => ability.abilityType === 'ultimate').length;
    if (!legacyV1 && ultimateCount !== 1) pushValidationError(errors, { code: 'ultimate-count', path: professionPath, message: `${profession.name} 必须恰有 1 个终极节点。` });
    const branchCounts = new Map<string, number>();
    for (const [abilityIndex, ability] of profession.abilities.entries()) {
      const path = `${professionPath}.abilities[${abilityIndex}]`;
      registerId(ability.id, `${path}.id`);
      if (!legacyV1 && !isMechanicalAbilityDefinition(ability)) pushValidationError(errors, { code: 'missing-mechanics', path, message: `能力「${ability.name}」没有可执行机械。` });
      if (ability.exclusiveGroup && ability.abilityType === 'specialization') branchCounts.set(ability.exclusiveGroup, (branchCounts.get(ability.exclusiveGroup) ?? 0) + 1);
      for (const prerequisite of ability.prerequisites) {
        const parent = byId.get(prerequisite);
        if (!parent) {
          pushValidationError(errors, { code: 'missing-prerequisite', path, message: `前置「${prerequisite}」不存在。` });
        } else if ((parent.tier ?? 1) > (ability.tier ?? 1)) {
          pushValidationError(errors, { code: 'tier-inversion', path, message: `前置「${prerequisite}」阶层高于当前节点。` });
        }
      }
    }
    if (!legacyV1 && (branchCounts.size < 1 || [...branchCounts.values()].some(count => count < 2))) pushValidationError(errors, { code: 'exclusive-branches', path: professionPath, message: `${profession.name} 至少需要一组包含两条路线的互斥专精节点。` });
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string) => {
      if (visiting.has(id)) {
        pushValidationError(errors, { code: 'cycle', path: `${professionPath}.abilities.${id}`, message: `能力前置图包含循环。` });
        return;
      }
      if (visited.has(id)) return;
      visiting.add(id);
      for (const prerequisite of byId.get(id)?.prerequisites ?? []) if (byId.has(prerequisite)) visit(prerequisite);
      visiting.delete(id);
      visited.add(id);
    };
    for (const ability of profession.abilities) visit(ability.id);
  }
  if (!legacyV1 && pack.innateTalents.length < 12) pushValidationError(errors, { code: 'innate-count', path: 'innateTalents', message: '职业包至少需要 12 个先天天赋。' });
  for (const [index, talent] of pack.innateTalents.entries()) {
    registerId(talent.id, `innateTalents.${talent.id}`);
    if (!legacyV1 && !isMechanicalAbilityDefinition(talent)) pushValidationError(errors, { code: 'missing-mechanics', path: `innateTalents[${index}]`, message: `先天天赋「${talent.name}」没有可执行机械。` });
  }
  if (!legacyV1 && pack.freeSkills.length < 12) pushValidationError(errors, { code: 'free-skill-count', path: 'freeSkills', message: '职业包至少需要 12 个自由技能。' });
  for (const [index, skill] of pack.freeSkills.entries()) {
    registerId(skill.id, `freeSkills.${skill.id}`);
    if (!legacyV1 && !isMechanicalAbilityDefinition(skill)) pushValidationError(errors, { code: 'missing-mechanics', path: `freeSkills[${index}]`, message: `自由技能「${skill.name}」没有可执行机械。` });
  }
  return { ok: errors.length === 0, errors };
}

export function saveProfessionPack(pack: ProfessionPack): ProfessionPack {
  const sourceIsLegacyV1 = isLegacyV1Value(pack);
  const validation = validateProfessionPack(pack, { allowLegacyV1: true });
  if (!validation.ok) throw new Error(`职业包验证失败：${validation.errors.map(error => error.message).join('；')}`);
  const reachesV3Baseline = sourceIsLegacyV1 && validateProfessionPack(pack).ok;
  const next = normalizeProfessionPack({
    ...clone(pack),
    ...(sourceIsLegacyV1 ? { baselineStatus: reachesV3Baseline ? 'v3-complete' as const : 'legacy-v1-incomplete' as const } : {}),
    manifest: { ...pack.manifest, builtin: false, updatedAt: Date.now() },
  });
  const packs = readUserPacks();
  const index = packs.findIndex(item => item.manifest.id === next.manifest.id);
  if (index >= 0) packs[index] = next;
  else packs.push(next);
  writeUserPacks(packs);
  return clone(next);
}

export function deleteProfessionPack(id: string): boolean {
  if (BUILTIN_PROFESSION_PACKS.some(pack => pack.manifest.id === id)) return false;
  const packs = readUserPacks();
  const next = packs.filter(pack => pack.manifest.id !== id);
  if (next.length === packs.length) return false;
  writeUserPacks(next);
  return true;
}

export function duplicateProfessionPack(source: ProfessionPack): ProfessionPack {
  const copy = clone(source);
  const now = Date.now();
  copy.manifest = {
    ...copy.manifest,
    id: `profession-pack-${now}`,
    name: `${copy.manifest.name} · 副本`,
    version: '1.0.0',
    builtin: false,
    createdAt: now,
    updatedAt: now,
  };
  return saveProfessionPack(copy);
}

export function createEmptyProfessionPack(name = '新职业包'): ProfessionPack {
  const now = Date.now();
  const seed = BUILTIN_PROFESSION_PACKS.find(pack => pack.manifest.id === 'fantasy-core');
  if (seed) {
    const draft = clone(seed);
    draft.manifest = {
      ...draft.manifest,
      id: `profession-pack-${now}`,
      name,
      version: '2.0.0',
      builtin: false,
      createdAt: now,
      updatedAt: now,
    };
    draft.professions = draft.professions.slice(0, 1);
    return draft;
  }
  return {
    schemaVersion: 2,
    manifest: { id: `profession-pack-${now}`, name, version: '2.0.0', schemaVersion: 2, builtin: false, createdAt: now, updatedAt: now },
    professions: [{ id: `profession-${now}`, name: '新职业', description: '', abilities: [] }],
    innateTalents: [],
    freeSkillCatalog: [],
    freeSkills: [],
    creationTalentBudget: 3,
    allowNoProfession: true,
    initialAbilityPoints: 1,
    abilityPointsPerTier: 1,
  };
}

/** 将旧世界内嵌的职业树提取为独立用户包；世界随后只保存返回的引用。 */
export function extractLegacyProfessionPack(value: ProfessionModuleSchema, name = '旧世界职业包'): ProfessionWorldBinding {
  const now = Date.now();
  const pack = saveProfessionPack({
    ...clone(value),
    manifest: {
      id: `legacy-profession-pack-${now}`,
      name,
      version: '1.0.0',
      schemaVersion: 1,
      builtin: false,
      createdAt: now,
      updatedAt: now,
      description: '由旧世界内嵌职业配置自动提取。',
    },
  } as ProfessionPack);
  return { packIds: [pack.manifest.id], allowNoProfession: value.allowNoProfession };
}

export function exportProfessionPack(pack: ProfessionPack): string {
  return JSON.stringify({ type: ENVELOPE_TYPE, version: 2, schemaVersion: 2, exportedAt: Date.now(), data: professionPackToV2(pack) }, null, 2);
}

export function importProfessionPack(json: string): ProfessionPack {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error('职业包不是有效的 JSON 文件'); }
  const envelope = asRecord(parsed);
  if (envelope?.type && envelope.type !== ENVELOPE_TYPE) throw new Error('这不是世界漫游指南职业包');
  const raw = envelope?.data ?? parsed;
  const legacyV1 = isLegacyV1Value(raw);
  const validation = validateProfessionPack(raw, { allowLegacyV1: true });
  if (!validation.ok) throw new Error(`职业包验证失败：${validation.errors.map(error => error.message).join('；')}`);
  const normalized = professionPackFromV2(migrateProfessionPack(raw));
  if (legacyV1) normalized.baselineStatus = validateProfessionPack(raw).ok ? 'v3-complete' : 'legacy-v1-incomplete';
  const collision = listProfessionPacks().some(pack => pack.manifest.id === normalized.manifest.id);
  normalized.manifest = {
    ...normalized.manifest,
    id: collision ? `${normalized.manifest.id}-import-${Date.now()}` : normalized.manifest.id,
    builtin: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return normalized;
}

export function normalizeProfessionPack(raw: ProfessionPack): ProfessionPack {
  const pack = clone(raw);
  pack.schemaVersion = 2;
  pack.manifest = {
    ...pack.manifest,
    id: String(pack.manifest.id || `profession-pack-${Date.now()}`),
    name: String(pack.manifest.name || '未命名职业包'),
    version: String(pack.manifest.version || '1.0.0'),
    schemaVersion: 2,
  };
  pack.creationTalentBudget = Math.max(0, Number(pack.creationTalentBudget ?? 3));
  pack.professions = (pack.professions ?? []).map((profession, professionIndex) => {
    const abilities = (profession.abilities ?? []).map((ability, index) => ({
      ...ability,
      id: String(ability.id || `ability-${professionIndex}-${index}`),
      name: String(ability.name || `能力 ${index + 1}`),
      description: String(ability.description || ''),
      tier: Math.max(1, Math.trunc(Number(ability.tier ?? ability.requiredProfessionLevel ?? 1))),
      prerequisites: Array.isArray(ability.prerequisites) ? ability.prerequisites.map(String) : [],
      mechanics: normalizeAbilityMechanics(ability.mechanics),
      iconKey: isProfessionEmblemKey(ability.iconKey) ? ability.iconKey : undefined,
      ...(ability.activation?.combatAction ? {
        activation: {
          ...ability.activation,
          combatAction: {
            ...ability.activation.combatAction,
            scaling: (ability.activation.combatAction.scaling ?? []).flatMap(scaling => (
              scaling && typeof scaling === 'object' && /^attr[AB]$|^dim[1-6]$/.test(String(scaling.statId)) && Number.isFinite(Number(scaling.coefficient))
                ? [{ ...scaling, coefficient: Number(scaling.coefficient) }]
                : []
            )),
          },
        },
      } : {}),
    }));
    return {
      ...profession,
      id: String(profession.id || `profession-${professionIndex}`),
      name: String(profession.name || `职业 ${professionIndex + 1}`),
      description: String(profession.description || ''),
      ...(profession.visual ? { visual: {
        ...(isProfessionEmblemKey(profession.visual.emblemKey) ? { emblemKey: profession.visual.emblemKey } : {}),
        ...(isProfessionAccentKey(profession.visual.accentKey) ? { accentKey: profession.visual.accentKey } : {}),
      } } : {}),
      abilities: abilities.map(item => ({ ...item, prerequisites: item.prerequisites?.filter(id => id !== item.id) })),
    };
  });
  pack.innateTalents = (Array.isArray(pack.innateTalents) ? pack.innateTalents : []).map((talent, index) => ({
    ...talent,
    id: String(talent.id || `innate-${index}`),
    name: String(talent.name || `先天天赋 ${index + 1}`),
    description: String(talent.description || ''),
    cost: Math.max(0, Number(talent.cost ?? 1)),
    mechanics: normalizeAbilityMechanics(talent.mechanics),
    iconKey: isProfessionEmblemKey(talent.iconKey) ? talent.iconKey : undefined,
  }));
  pack.freeSkillCatalog = Array.isArray(pack.freeSkillCatalog) ? pack.freeSkillCatalog : (Array.isArray(pack.freeSkills) ? pack.freeSkills : []);
  pack.freeSkills = clone(pack.freeSkillCatalog);
  return pack;
}

function normalizeAbilityMechanics(value: ProfessionAbilityMechanics | undefined): ProfessionAbilityMechanics | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const combatEntries = Object.entries(value.combat ?? {}).flatMap(([key, raw]) => {
    if (!['damage', 'healing', 'accuracy', 'armor', 'initiative'].includes(key)) return [];
    const amount = Number(raw);
    return Number.isFinite(amount) && amount !== 0 ? [[key, Math.max(-100, Math.min(100, amount))]] : [];
  });
  const checks = (value.checks ?? []).flatMap(item => {
    const amount = Number(item?.value);
    if (!Number.isFinite(amount) || amount === 0) return [];
    const statIds = (item.statIds ?? []).filter(id => /^attr[AB]$|^dim[1-6]$/.test(String(id)));
    return [{ value: Math.max(-20, Math.min(20, amount)), ...(statIds.length ? { statIds } : {}) }];
  });
  if (!combatEntries.length && !checks.length) return undefined;
  return {
    ...(combatEntries.length ? { combat: Object.fromEntries(combatEntries) } : {}),
    ...(checks.length ? { checks } : {}),
  };
}

function isProfessionPack(value: unknown): value is ProfessionPack {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ProfessionPack>;
  return Boolean(item.manifest && typeof item.manifest === 'object' && Array.isArray(item.professions) && Array.isArray(item.innateTalents) && (Array.isArray(item.freeSkillCatalog) || Array.isArray(item.freeSkills) || item.freeSkillCatalog === undefined));
}

function isLegacyModule(value: unknown): value is ProfessionModuleSchema {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as ProfessionModuleSchema).professions));
}

export function isProfessionBinding(value: unknown): value is ProfessionWorldBinding {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as ProfessionWorldBinding).packIds));
}

export function resolveProfessionBinding(value: ProfessionWorldBinding | ProfessionModuleSchema | unknown): ProfessionModuleSchema {
  if (isLegacyModule(value)) {
    const legacyPack = normalizeProfessionPack({
      ...(clone(value) as ProfessionModuleSchema),
      manifest: { id: 'legacy-inline', name: '旧版内嵌职业', version: '1.0.0', schemaVersion: 1 },
    });
    const { manifest: _manifest, ...config } = legacyPack;
    return config;
  }
  const binding: ProfessionWorldBinding = isProfessionBinding(value) ? value : { packIds: [] };
  const packs = binding.packIds.map(getProfessionPack).filter(Boolean) as ProfessionPack[];
  const allowed = binding.enabledProfessionIds?.length ? new Set(binding.enabledProfessionIds) : undefined;
  const professionById = new Map<string, ProfessionDef>();
  const talentById = new Map<string, ProfessionPack['innateTalents'][number]>();
  const skillById = new Map<string, NonNullable<ProfessionPack['freeSkillCatalog']>[number]>();
  for (const pack of packs) {
    for (const profession of pack.professions) if (!allowed || allowed.has(profession.id)) professionById.set(profession.id, clone(profession));
    for (const talent of pack.innateTalents) talentById.set(talent.id, clone(talent));
    for (const skill of pack.freeSkillCatalog ?? []) skillById.set(skill.id, clone(skill));
  }
  return {
    professions: [...professionById.values()],
    innateTalents: [...talentById.values()],
    freeSkillCatalog: [...skillById.values()],
    creationTalentBudget: binding.creationTalentBudget ?? Math.max(0, ...packs.map(pack => pack.creationTalentBudget ?? 0)),
    allowNoProfession: binding.allowNoProfession ?? packs.every(pack => pack.allowNoProfession !== false),
    initialAbilityPoints: Math.max(0, ...packs.map(pack => pack.initialAbilityPoints ?? 0)),
    abilityPointsPerTier: Math.max(0, ...packs.map(pack => pack.abilityPointsPerTier ?? 0)),
  };
}

export function professionAbilityToCombatAction(ability: ProfessionAbilityDef, state: GameState): CombatActionDefinition | undefined {
  if (!state.玩家.能力系统?.职业状态?.已解锁能力?.[ability.id]) return undefined;
  const definition = abilityDefinitionFromProfessionAbility(ability, state.玩家.能力系统?.职业状态?.职业ID ?? undefined);
  const action = definition.mechanics?.combatAction;
  if (!action || (definition.abilityType !== 'active' && definition.abilityType !== 'ultimate')) return undefined;
  return {
    ...clone(action),
    id: `profession:${ability.id}`,
    name: ability.name,
    description: ability.description,
    cooldownRounds: action.cooldownRounds ?? definition.mechanics?.cooldownRounds,
  };
}

export function resolveProfessionCombatActions(state: GameState, config: ProfessionModuleSchema | undefined): CombatActionDefinition[] {
  const profession = config?.professions.find(item => item.id === state.玩家.能力系统?.职业状态?.职业ID);
  if (!profession) return [];
  return profession.abilities.flatMap(ability => {
    const action = professionAbilityToCombatAction(ability, state);
    return action ? [action] : [];
  });
}

export function buildAbilityProposalPrompt(intent: string, category: AbilityProposal['category'] = 'dynamic'): string {
  return `你只负责提出一个能力语义提案，不负责配平，也不能提供伤害、生命、倍率、冷却、消耗或状态数字。
主题：${intent.trim() || '一个可复用的能力'}
只输出 JSON：{"schemaVersion":2,"id":"stable-id","name":"能力名","description":"叙事用途与限制","category":"${category}","rarity":"普通|精良|稀有|史诗|传说","target":"self|ally|enemy|area|none","tags":["语义标签"]}
玩家确认后本地系统才会按品质、来源与目标生成机械定义。`;
}

export function parseAbilityProposal(text: string): AbilityProposal {
  const block = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text.match(/(\{[\s\S]*\})/)?.[1] ?? text;
  let parsed: unknown;
  try { parsed = JSON.parse(block.trim().replace(/[“”]/g, '"').replace(/[‘’]/g, "'")); }
  catch { throw new Error('AI 返回的能力提案不是有效 JSON'); }
  const proposal = normalizeAbilityProposal(parsed);
  if (!proposal) throw new Error('AI 返回的能力提案缺少合法语义字段');
  return proposal;
}

export function buildProfessionPackGenerationPrompt(intent: string, basePack?: ProfessionPack): string {
  const revisionSource = basePack ? JSON.stringify({
    manifest: {
      id: basePack.manifest.id,
      name: basePack.manifest.name,
      description: basePack.manifest.description,
      tags: basePack.manifest.tags ?? [],
    },
    professions: basePack.professions.map(profession => ({
      id: profession.id,
      name: profession.name,
      description: profession.description,
      archetype: profession.archetype,
      visual: profession.visual,
      abilities: profession.abilities.map(ability => ({
        id: ability.id,
        name: ability.name,
        description: ability.description,
        type: ability.type,
        tier: ability.tier,
        prerequisites: ability.prerequisites ?? [],
        exclusiveGroup: ability.exclusiveGroup,
        target: ability.activation?.combatAction?.target,
        tags: ability.tags ?? [],
        iconKey: ability.iconKey,
      })),
    })),
    innateTalents: basePack.innateTalents.map(talent => ({
      id: talent.id,
      name: talent.name,
      description: talent.description,
      rarity: talent.rarity,
      iconKey: talent.iconKey,
      tags: talent.tags ?? [],
    })),
    freeSkillCatalog: (basePack.freeSkillCatalog ?? basePack.freeSkills ?? []).map(skill => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      rarity: skill.rarity,
      target: 'enemy',
      tags: skill.tags ?? [],
    })),
    creationTalentBudget: basePack.creationTalentBudget,
    allowNoProfession: basePack.allowNoProfession,
    initialAbilityPoints: basePack.initialAbilityPoints,
    abilityPointsPerTier: basePack.abilityPointsPerTier,
  }) : '';
  const task = basePack
    ? `在下面现有职业包基础上修订。除非用户明确要求删除或替换，保留已有职业、能力及其稳定 ID；输出修订后的完整职业包，不要只输出差异。\n现有职业包：${revisionSource}`
    : '生成一套新的完整职业包。';
  return `你是独立职业系统设计师。只生成一个可复用的完整职业包，不要生成世界、剧情、NPC、事件或战斗遭遇。
用户需求：${intent.trim() || '生成一套题材自洽、可长期成长的职业体系'}
任务：${task}

只输出 JSON，结构必须为：
{"manifest":{"id":"stable-pack-id","name":"职业包名","version":"1.0.0","schemaVersion":1,"description":"说明","tags":[]},"professions":[{"id":"stable-id","name":"职业名","description":"定位","archetype":"原型","visual":{"emblemKey":"warrior","accentKey":"crimson"},"abilities":[{"id":"stable-id","name":"能力名","description":"语义说明","type":"active|passive|specialization|ultimate","tier":1,"prerequisites":[],"exclusiveGroup":"可选","iconKey":"warrior","rarity":"普通|精良|稀有|史诗|传说","target":"self|ally|enemy|area|none","tags":["语义标签"]}]}],"innateTalents":[{"id":"stable-id","name":"先天天赋","description":"出生特质","iconKey":"warrior","rarity":"普通|精良|稀有|史诗|传说","tags":["语义标签"]}],"freeSkillCatalog":[{"id":"stable-id","name":"自由技能","description":"用途与限制","rarity":"普通|精良|稀有|史诗|传说","target":"enemy","tags":["语义标签"]}],"creationTalentBudget":3,"allowNoProfession":true,"initialAbilityPoints":2,"abilityPointsPerTier":1}
视觉字段只能使用本地白名单：emblemKey/iconKey 允许 warrior、mage、ranger、rogue、cleric、paladin、swordsman、bladesman、spearmaster、unarmed、healer、qimen；accentKey 允许 crimson、amber、jade、azure、violet、silver。不要输出 URL、路径或其他视觉键，缺省时由本地按职业 ID 稳定回退。

硬规则：
1. 生成 3-6 个职业，每个职业至少 8 个节点、明确覆盖 1~4 阶；第 1 阶为根基，第 2-3 阶出现两条互斥专精路线，第 4 阶恰有一个终极能力。
2. prerequisites 只能引用同职业已存在节点，不能成环；tier 必须与前置层级一致。
3. 只提交职业结构与能力语义；不要输出数值、消耗、冷却、倍率、生命、伤害、效果数组或状态细节。
4. ID 使用稳定英文小写短横线，包内唯一；所有玩家可见文字使用中文。解析后每项都会转为 AbilityProposal，由本地配平器生成唯一机械定义，模型内容不会直接写入能力库。`;
}

function proposalTarget(value: unknown, fallback: AbilityProposalTarget): AbilityProposalTarget {
  return value === 'self' || value === 'ally' || value === 'enemy' || value === 'area' || value === 'none' ? value : fallback;
}

function balanceGeneratedAbility(source: AbilityDefinition, category: AbilityCategory, professionId?: string): AbilityDefinition {
  const legacy = asRecord(source.legacy);
  const passive = category === 'innate_talent' || source.abilityType === 'passive' || source.abilityType === 'specialization';
  const proposal = normalizeAbilityProposal({
    schemaVersion: 2,
    id: source.id,
    name: source.name,
    description: source.description,
    category: passive ? 'innate_talent' : category,
    rarity: source.rarity,
    target: proposalTarget(legacy?.target, passive ? 'self' : 'enemy'),
    tags: source.tags,
  });
  if (!proposal) throw new Error(`能力「${source.name}」缺少合法语义字段`);
  const balanced = balanceAbilityProposal(proposal);
  return {
    ...balanced,
    category,
    abilityType: category === 'profession' ? source.abilityType ?? 'active' : category === 'innate_talent' ? 'passive' : 'active',
    ...(professionId ? { professionId } : {}),
    ...(source.tier === undefined ? {} : { tier: source.tier }),
    ...(source.requiredProfessionLevel === undefined ? {} : { requiredProfessionLevel: source.requiredProfessionLevel }),
    prerequisites: [...source.prerequisites],
    prerequisiteMode: source.prerequisiteMode ?? 'all',
    ...(source.exclusiveGroup ? { exclusiveGroup: source.exclusiveGroup } : {}),
    tags: [...source.tags],
    ...(source.iconKey ? { iconKey: source.iconKey } : {}),
    legacy: source.legacy,
  };
}

function balanceGeneratedProfessionPack(input: unknown): ProfessionPackV2 {
  const migrated = migrateProfessionPack(input);
  return {
    ...migrated,
    professions: migrated.professions.map(profession => ({
      ...profession,
      abilities: profession.abilities.map(ability => balanceGeneratedAbility(ability, 'profession', profession.id)),
    })),
    innateTalents: migrated.innateTalents.map(ability => balanceGeneratedAbility(ability, 'innate_talent')),
    freeSkills: migrated.freeSkills.map(ability => balanceGeneratedAbility(ability, 'free_skill')),
  };
}

export function parseGeneratedProfessionPack(text: string): ProfessionPack {
  const block = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text.match(/(\{[\s\S]*\})/)?.[1] ?? text;
  let parsed: unknown;
  try { parsed = JSON.parse(block.trim().replace(/[“”]/g, '"').replace(/[‘’]/g, "'")); }
  catch { throw new Error('AI 返回的职业包不是有效 JSON'); }
  const balanced = balanceGeneratedProfessionPack(parsed);
  const pack = professionPackFromV2(balanced);
  pack.manifest = { ...pack.manifest, id: `profession-pack-${Date.now()}`, builtin: false, createdAt: Date.now(), updatedAt: Date.now() };
  return pack;
}
