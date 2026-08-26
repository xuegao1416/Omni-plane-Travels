import type { ProfessionAbilityDef, ProfessionDef, ProfessionModuleSchema, SkillDef } from '../../modules/schema';

const ability = (
  id: string,
  name: string,
  type: ProfessionAbilityDef['type'],
  description: string,
  prerequisites: string[] = [],
  extra: Partial<ProfessionAbilityDef> = {},
): ProfessionAbilityDef => ({ id, name, type, description, prerequisites, pointCost: 1, maxRank: 1, ...extra });

const profession = (id: string, name: string, archetype: string, description: string, abilities: ProfessionAbilityDef[]): ProfessionDef => ({
  id, name, archetype, description, abilities,
});

const freeSkill = (id: string, name: string, description: string, diceModifier: number): SkillDef => ({
  id, name, description, rarity: diceModifier >= 2 ? '稀有' : '普通', tags: ['自由技能'], maxRank: 5, pointCost: 1,
  diceModifier, proficiency: { gainPerUse: 1, thresholdPerRank: 6, maxRank: 5 },
});

export const FANTASY_CORE_PROFESSION_PACK: ProfessionModuleSchema = {
  creationTalentBudget: 3,
  allowNoProfession: true,
  initialAbilityPoints: 2,
  abilityPointsPerTier: 1,
  innateTalents: [
    { id: 'keen_mind', name: '敏锐心智', description: '更快理解复杂线索与陌生知识。', cost: 1, rarity: '普通', exclusiveGroup: 'temperament', mechanics: { checks: [{ statIds: ['dim4'], value: 1 }] } },
    { id: 'iron_will', name: '钢铁意志', description: '面对恐惧、诱惑与精神干扰时更为坚定。', cost: 1, rarity: '普通', exclusiveGroup: 'temperament', mechanics: { checks: [{ statIds: ['dim5'], value: 1 }] } },
    { id: 'lucky_star', name: '幸运星', description: '命运偶尔会给你一次额外转机。', cost: 2, rarity: '稀有', mechanics: { checks: [{ statIds: ['dim6'], value: 1 }] } },
    { id: 'tough_body', name: '强健体魄', description: '恢复力与耐力高于常人。', cost: 2, rarity: '稀有', exclusiveGroup: 'physique', mechanics: { combat: { armor: 1 }, checks: [{ statIds: ['dim2'], value: 1 }] } },
    { id: 'nimble_body', name: '轻盈身姿', description: '动作更敏捷，也更善于避开危险。', cost: 2, rarity: '稀有', exclusiveGroup: 'physique', mechanics: { combat: { initiative: 1 }, checks: [{ statIds: ['dim3'], value: 1 }] } },
    { id: 'silver_tongue', name: '巧舌如簧', description: '更擅长谈判、说服与周旋。', cost: 1, rarity: '普通', mechanics: { checks: [{ statIds: ['dim5'], value: 1 }] } },
    { id: 'arcane_sense', name: '奥秘感知', description: '能够隐约察觉魔法与超自然痕迹。', cost: 1, rarity: '普通', mechanics: { checks: [{ statIds: ['dim4', 'dim6'], value: 1 }] } },
    { id: 'heroic_destiny', name: '英雄命格', description: '重大抉择更容易把你推向传奇。', cost: 3, rarity: '史诗', mechanics: { checks: [{ statIds: ['dim6'], value: 2 }] } },
    { id: 'steady_hands', name: '稳健双手', description: '精细操作、射击与手工更可靠。', cost: 1, rarity: '普通', mechanics: { checks: [{ statIds: ['dim3'], value: 1 }] } },
    { id: 'battle_sense', name: '战场直觉', description: '能在混乱中迅速判断威胁。', cost: 2, rarity: '稀有', mechanics: { combat: { accuracy: 1 }, checks: [{ statIds: ['dim6'], value: 1 }] } },
    { id: 'night_eyes', name: '夜行之眼', description: '在昏暗环境中仍能捕捉细节。', cost: 1, rarity: '普通', mechanics: { checks: [{ statIds: ['dim6'], value: 1 }] } },
    { id: 'kindred_bond', name: '同伴羁绊', description: '与可靠伙伴并肩时更能发挥力量。', cost: 2, rarity: '稀有', mechanics: { combat: { healing: 1 }, checks: [{ statIds: ['dim5'], value: 1 }] } },
    { id: 'dragonheart_awakening', name: '龙心觉醒', description: '远古龙血在危难中苏醒，赋予超凡威势与不屈体魄。', cost: 99999, rarity: '传说', tags: ['神技'], mechanics: { combat: { armor: 1 }, checks: [{ statIds: ['dim2'], value: 2 }] } },
    { id: 'fate_spindle', name: '命运纺锤', description: '能够窥见并轻拨命运丝线，让最渺茫的转机成为现实。', cost: 99999, rarity: '传说', tags: ['神技'], mechanics: { combat: { initiative: 1 }, checks: [{ statIds: ['dim6'], value: 2 }] } },
    { id: 'world_whisper', name: '世界低语', description: '世界本身向你低语，揭示表象之下的奥秘与裂隙。', cost: 99999, rarity: '传说', tags: ['神技'], mechanics: { combat: { accuracy: 1 }, checks: [{ statIds: ['dim4', 'dim6'], value: 2 }] } },
  ],
  professions: [
    profession('warrior', '战士', '前排・武器', '以坚韧与武技正面掌控战场。', [
      ability('warrior_training', '武器训练', 'passive', '熟悉常见武器与护甲。'),
      ability('power_strike', '蓄力猛击', 'active', '牺牲速度换取一次强力攻击。', ['warrior_training'], { cooldownTicks: 1 }),
      ability('guardian_stance', '守护姿态', 'specialization', '专注保护自己与同伴。', ['warrior_training'], { exclusiveGroup: 'warrior_path' }),
      ability('weapon_master', '武器大师', 'specialization', '将进攻技巧磨炼到极致。', ['power_strike'], { exclusiveGroup: 'warrior_path' }),
      ability('unyielding', '不屈', 'passive', '身陷险境时仍能坚持战斗。', ['guardian_stance']),
      ability('bladestorm', '剑刃风暴', 'ultimate', '以连续攻势压制周围敌人。', ['weapon_master'], { pointCost: 2, requiredProfessionLevel: 4, cooldownTicks: 5 }),
    ]),
    profession('mage', '法师', '远程・奥术', '研究奥术规律，以法术改变局势。', [
      ability('arcane_study', '奥术研习', 'passive', '掌握施法理论与基础法术。'),
      ability('fire_bolt', '火焰箭', 'active', '发射凝聚火焰攻击目标。', ['arcane_study'], { cooldownTicks: 1 }),
      ability('frost_school', '寒霜学派', 'specialization', '以寒冰限制敌人行动。', ['arcane_study'], { exclusiveGroup: 'mage_school' }),
      ability('flame_school', '烈焰学派', 'specialization', '专注更具破坏性的火焰法术。', ['fire_bolt'], { exclusiveGroup: 'mage_school' }),
      ability('mana_shield', '法力护盾', 'active', '消耗法力抵挡一次威胁。', ['frost_school'], { cooldownTicks: 2 }),
      ability('meteor', '陨星术', 'ultimate', '召来陨星轰击大片区域。', ['flame_school'], { pointCost: 2, requiredProfessionLevel: 4, cooldownTicks: 6 }),
    ]),
    profession('ranger', '游侠', '远程・荒野', '在荒野中追踪、射击并与自然伙伴协作。', [
      ability('ranger_training', '荒野训练', 'passive', '掌握追踪、远射与野外生存。'),
      ability('ranger_shot', '精准射击', 'active', '瞄准弱点射出稳定的一箭。', ['ranger_training'], { cooldownTicks: 1 }),
      ability('ranger_hunter', '猎手专精', 'specialization', '强化追踪、标记与持续压制。', ['ranger_training'], { exclusiveGroup: 'ranger_path' }),
      ability('ranger_companion', '伙伴专精', 'specialization', '与自然伙伴协作，获得灵活支援。', ['ranger_shot'], { exclusiveGroup: 'ranger_path' }),
      ability('ranger_mark', '猎物标记', 'passive', '锁定猎物后更容易持续命中。', ['ranger_hunter']),
      ability('ranger_trap', '荒野陷阱', 'active', '布置陷阱限制敌人移动。', ['ranger_companion'], { cooldownTicks: 2 }),
      ability('ranger_scout', '先行侦察', 'passive', '提前发现危险并选择更有利的位置。', ['ranger_hunter']),
      ability('ranger_volley', '连珠箭', 'active', '连续射击压制多个目标。', ['ranger_companion'], { cooldownTicks: 2 }),
      ability('ranger_apex', '天穹猎杀号', 'ultimate', '以一箭贯穿猎物的全部退路。', ['ranger_mark', 'ranger_volley'], { pointCost: 2, requiredProfessionLevel: 4, cooldownTicks: 6, prerequisiteMode: 'any' }),
    ]),
    profession('rogue', '盗贼', '机动・技巧', '依靠观察、潜行与精准打击解决问题。', [
      ability('streetcraft', '街头本领', 'passive', '熟悉潜行、机关与灰色地带规则。'),
      ability('sneak_attack', '偷袭', 'active', '从优势位置发动精准打击。', ['streetcraft'], { cooldownTicks: 1 }),
      ability('shadow_path', '暗影专精', 'specialization', '强化潜行与隐匿。', ['streetcraft'], { exclusiveGroup: 'rogue_path' }),
      ability('duelist_path', '决斗专精', 'specialization', '擅长单挑、反击与拆招。', ['sneak_attack'], { exclusiveGroup: 'rogue_path' }),
      ability('vanish', '消失', 'active', '短暂摆脱注意并重新寻找位置。', ['shadow_path'], { cooldownTicks: 3 }),
      ability('perfect_opening', '致命破绽', 'ultimate', '抓住一瞬间的破绽完成决定性一击。', ['duelist_path'], { pointCost: 2, requiredProfessionLevel: 4, cooldownTicks: 5 }),
    ]),
    profession('cleric', '牧师', '支援・神术', '借助信仰治愈创伤、驱散邪祟。', [
      ability('divine_cant', '祷言', 'passive', '掌握基础神术与宗教仪式。'),
      ability('healing_word', '治愈祷言', 'active', '快速缓解一名目标的伤势。', ['divine_cant'], { cooldownTicks: 1 }),
      ability('life_domain', '生命领域', 'specialization', '专注治疗与守护。', ['healing_word'], { exclusiveGroup: 'cleric_domain' }),
      ability('light_domain', '光明领域', 'specialization', '以圣光克制黑暗与亡灵。', ['divine_cant'], { exclusiveGroup: 'cleric_domain' }),
      ability('purify', '净化', 'active', '驱散一种负面状态或污染。', ['life_domain'], { cooldownTicks: 3 }),
      ability('divine_intervention', '神圣干预', 'ultimate', '在绝境中呼唤一次强大神迹。', ['light_domain'], { pointCost: 2, requiredProfessionLevel: 4, cooldownTicks: 8 }),
    ]),
    profession('paladin', '圣骑士', '守护・誓约', '以誓言约束自身，用信念保护同伴。', [
      ability('sacred_oath', '神圣誓约', 'passive', '以誓言获得坚定意志与神圣力量。'),
      ability('smite', '神圣惩击', 'active', '将信念灌注武器打击邪恶。', ['sacred_oath'], { cooldownTicks: 1 }),
      ability('oath_devotion', '奉献之誓', 'specialization', '专注保护弱者与维持秩序。', ['sacred_oath'], { exclusiveGroup: 'paladin_oath' }),
      ability('oath_vengeance', '复仇之誓', 'specialization', '追猎并制裁不可饶恕的敌人。', ['smite'], { exclusiveGroup: 'paladin_oath' }),
      ability('aura_guard', '守护灵光', 'passive', '让身边同伴更能抵抗恐惧与侵蚀。', ['oath_devotion']),
      ability('judgment', '最终审判', 'ultimate', '以全部誓约之力完成一次裁决。', ['oath_vengeance'], { pointCost: 2, requiredProfessionLevel: 4, cooldownTicks: 6 }),
    ]),
  ],
  freeSkillCatalog: [
    freeSkill('arcana', '奥术学识', '识读魔法符文、仪式与超自然线索。', 2),
    freeSkill('herbalism', '草药学', '辨识药草并处理基础药材。', 1),
    freeSkill('tracking', '追踪术', '从足迹、气味与环境变化还原行踪。', 2),
    freeSkill('survival', '野外求生', '在陌生荒野中寻找水源、庇护与道路。', 1),
    freeSkill('stealth', '潜行', '控制脚步、视线与遮蔽物降低存在感。', 1),
    freeSkill('lockpicking', '开锁', '处理常见锁具与机关结构。', 1),
    freeSkill('persuasion', '交涉', '用论证、礼仪与同理心推进谈判。', 2),
    freeSkill('medicine', '医疗', '诊断创伤并进行基础急救。', 2),
    freeSkill('sailing', '航海', '辨认风向、潮汐与航线风险。', 1),
    freeSkill('smithing', '锻造', '修理和改良常见武器护具。', 1),
    freeSkill('lore', '历史学', '从遗迹、典籍与传承中还原事实。', 1),
    freeSkill('animal_handling', '驯兽', '理解并安抚野兽，建立可靠协作。', 2),
  ],
};
