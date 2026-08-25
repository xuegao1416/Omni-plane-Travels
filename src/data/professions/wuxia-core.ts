import type { ProfessionAbilityDef, ProfessionDef, ProfessionModuleSchema, SkillDef } from '../../modules/schema';

const node = (
  id: string, name: string, type: ProfessionAbilityDef['type'], description: string,
  prerequisites: string[] = [], extra: Partial<ProfessionAbilityDef> = {},
): ProfessionAbilityDef => ({ id, name, type, description, prerequisites, pointCost: 1, maxRank: 1, ...extra });

const path = (id: string, name: string, description: string, abilities: ProfessionAbilityDef[]): ProfessionDef => ({
  id, name, description, archetype: '江湖武学', abilities,
});

const lifeSkill = (id: string, name: string, description: string): SkillDef => ({
  id, name, description, rarity: '普通', tags: ['生活技艺'], maxRank: 5, pointCost: 0,
  diceModifier: id === 'medicine' || id === 'divination' ? 2 : 1,
  proficiency: { gainPerUse: 1, thresholdPerRank: 6, maxRank: 5 },
});

export const WUXIA_CORE_PROFESSION_PACK: ProfessionModuleSchema = {
  creationTalentBudget: 3,
  allowNoProfession: true,
  initialAbilityPoints: 2,
  abilityPointsPerTier: 1,
  innateTalents: [
    { id: 'wuxia_keen_bones', name: '根骨清奇', description: '经脉与筋骨适合修习上乘武学。', cost: 2, rarity: '稀有', exclusiveGroup: 'body', mechanics: { combat: { armor: 1 }, checks: [{ statIds: ['dim2'], value: 1 }] } },
    { id: 'wuxia_light_body', name: '身轻如燕', description: '天生协调敏捷，轻功入门更快。', cost: 2, rarity: '稀有', exclusiveGroup: 'body', mechanics: { combat: { initiative: 1 }, checks: [{ statIds: ['dim3'], value: 1 }] } },
    { id: 'wuxia_insight', name: '一点即通', description: '理解招式与心法时常能触类旁通。', cost: 2, rarity: '稀有', exclusiveGroup: 'mind', mechanics: { checks: [{ statIds: ['dim4'], value: 1 }] } },
    { id: 'wuxia_calm', name: '心如止水', description: '面对扰乱心神之事更易保持清醒。', cost: 1, rarity: '普通', exclusiveGroup: 'mind', mechanics: { checks: [{ statIds: ['dim5'], value: 1 }] } },
    { id: 'wuxia_fortune', name: '福缘深厚', description: '更容易在江湖中遇到意外机缘。', cost: 2, rarity: '稀有', mechanics: { checks: [{ statIds: ['dim6'], value: 1 }] } },
    { id: 'wuxia_memory', name: '过目不忘', description: '能迅速记住招式、药方与繁复信息。', cost: 1, rarity: '普通', mechanics: { checks: [{ statIds: ['dim4'], value: 1 }] } },
    { id: 'wuxia_iron_breath', name: '铁息', description: '吐纳沉稳，长途与持久行动更有余裕。', cost: 1, rarity: '普通', mechanics: { combat: { armor: 1 }, checks: [{ statIds: ['dim2'], value: 1 }] } },
    { id: 'wuxia_keen_ears', name: '听风辨位', description: '从细微声息判断来路与危险。', cost: 1, rarity: '普通', mechanics: { checks: [{ statIds: ['dim6'], value: 1 }] } },
    { id: 'wuxia_poison_resist', name: '百毒不侵', description: '身体对常见毒物与药性更有抵抗。', cost: 2, rarity: '稀有', mechanics: { combat: { armor: 1 }, checks: [{ statIds: ['dim2'], value: 1 }] } },
    { id: 'wuxia_grace', name: '江湖风度', description: '懂得在复杂人情中保留体面与余地。', cost: 1, rarity: '普通', mechanics: { checks: [{ statIds: ['dim5'], value: 1 }] } },
    { id: 'wuxia_lucky_coin', name: '机缘铜钱', description: '总能在关键时刻找到一线可能。', cost: 2, rarity: '稀有', mechanics: { checks: [{ statIds: ['dim6'], value: 2 }] } },
    { id: 'wuxia_patient_practice', name: '耐心苦练', description: '重复练习招式时更容易积累熟练。', cost: 2, rarity: '稀有', mechanics: { checks: [{ statIds: ['dim4'], value: 1 }] } },
  ],
  professions: [
    path('swordsman', '剑客', '以剑势、步法与拆招立足江湖。', [
      node('sword_foundation', '剑术根基', 'passive', '掌握剑器、步法与基础剑势。'),
      node('sword_swift', '流云快剑', 'active', '以连贯快剑抢占先机。', ['sword_foundation'], { cooldownTicks: 1 }),
      node('sword_intent', '剑意专精', 'specialization', '以神驭剑，重意不重形。', ['sword_foundation'], { exclusiveGroup: 'sword_path' }),
      node('sword_form', '剑招专精', 'specialization', '精研招式变化与拆解。', ['sword_swift'], { exclusiveGroup: 'sword_path' }),
      node('sword_heart', '剑心通明', 'passive', '心剑合一，不易受外物干扰。', ['sword_intent']),
      node('sword_heaven', '一剑天开', 'ultimate', '凝聚全部剑势斩出决定性一剑。', ['sword_form'], { pointCost: 2, requiredProfessionLevel: 4, cooldownTicks: 6 }),
    ]),
    path('bladesman', '刀客', '以刚猛刀势压迫敌手、破开防线。', [
      node('blade_foundation', '刀术根基', 'passive', '掌握长短刀械与发力法门。'),
      node('blade_cleave', '断岳斩', 'active', '以沉重刀势正面破防。', ['blade_foundation'], { cooldownTicks: 1 }),
      node('blade_fierce', '狂刀专精', 'specialization', '追求连绵不绝的强攻。', ['blade_foundation'], { exclusiveGroup: 'blade_path' }),
      node('blade_calm', '藏锋专精', 'specialization', '收敛锋芒，等待最佳一刀。', ['blade_cleave'], { exclusiveGroup: 'blade_path' }),
      node('blade_pressure', '刀势', 'passive', '以气势和节奏压制对手。', ['blade_fierce']),
      node('blade_final', '天地一刀', 'ultimate', '将精气神尽数汇入一刀。', ['blade_calm'], { pointCost: 2, requiredProfessionLevel: 4, cooldownTicks: 6 }),
    ]),
    path('spearmaster', '枪客', '以距离、变化与冲阵能力控制战局。', [
      node('spear_foundation', '枪术根基', 'passive', '掌握拦、拿、扎与步法配合。'),
      node('spear_thrust', '追星逐月', 'active', '连续突刺封锁敌人退路。', ['spear_foundation'], { cooldownTicks: 1 }),
      node('spear_guard', '守阵专精', 'specialization', '依靠距离与枪圈守住阵地。', ['spear_foundation'], { exclusiveGroup: 'spear_path' }),
      node('spear_charge', '冲阵专精', 'specialization', '以人枪合一之势破开阵线。', ['spear_thrust'], { exclusiveGroup: 'spear_path' }),
      node('spear_circle', '八方枪圈', 'passive', '枪势周密，兼顾多个方向。', ['spear_guard']),
      node('spear_dragon', '游龙贯日', 'ultimate', '人随枪走，贯穿最坚固的防线。', ['spear_charge'], { pointCost: 2, requiredProfessionLevel: 4, cooldownTicks: 6 }),
    ]),
    path('unarmed', '拳师', '锤炼体魄与劲力，近身短打制敌。', [
      node('fist_foundation', '拳脚根基', 'passive', '掌握站桩、发力与贴身短打。'),
      node('fist_burst', '寸劲', 'active', '在极短距离爆发穿透劲力。', ['fist_foundation'], { cooldownTicks: 1 }),
      node('fist_hard', '外家专精', 'specialization', '以筋骨皮肉承载刚猛劲力。', ['fist_foundation'], { exclusiveGroup: 'fist_path' }),
      node('fist_inner', '内家专精', 'specialization', '以呼吸、听劲和借力制敌。', ['fist_burst'], { exclusiveGroup: 'fist_path' }),
      node('fist_guard', '金刚身', 'passive', '长期锤炼使身体更能承受冲击。', ['fist_hard']),
      node('fist_void', '返璞归真', 'ultimate', '招式归于自然，一举一动皆可制敌。', ['fist_inner'], { pointCost: 2, requiredProfessionLevel: 4, cooldownTicks: 6 }),
    ]),
    path('healer', '医者', '以医理、针药与内息救人制毒。', [
      node('healer_foundation', '医道根基', 'passive', '掌握望闻问切与基础药理。'),
      node('healer_needle', '回春针', 'active', '以针法稳定伤势并恢复气血。', ['healer_foundation'], { cooldownTicks: 1 }),
      node('healer_meridian', '经脉专精', 'specialization', '以经脉调理强化治疗与续航。', ['healer_foundation'], { exclusiveGroup: 'healer_path' }),
      node('healer_poison', '药毒专精', 'specialization', '以药性变化制敌并削弱毒患。', ['healer_needle'], { exclusiveGroup: 'healer_path' }),
      node('healer_diagnosis', '辨证', 'passive', '迅速识别伤势、毒性与身体虚实。', ['healer_meridian']),
      node('healer_antidote', '解毒方', 'active', '调配药方解除一种持续伤害状态。', ['healer_poison'], { cooldownTicks: 2 }),
      node('healer_calm', '养气', 'passive', '以呼吸与调息恢复行动余力。', ['healer_meridian']),
      node('healer_needle_rain', '飞针封脉', 'active', '以飞针封住敌人行动与气血。', ['healer_poison'], { cooldownTicks: 2 }),
      node('healer_rebirth', '悬壶济世', 'ultimate', '以毕生医道挽回濒死之人。', ['healer_diagnosis', 'healer_needle_rain'], { pointCost: 2, requiredProfessionLevel: 4, cooldownTicks: 7, prerequisiteMode: 'any' }),
    ]),
    path('qimen', '奇门', '以阵法、机关与术数改变战场条件。', [
      node('qimen_foundation', '奇门根基', 'passive', '掌握阵图、机关与方位基础。'),
      node('qimen_lure', '迷踪步', 'active', '借方位变化扰乱敌人判断。', ['qimen_foundation'], { cooldownTicks: 1 }),
      node('qimen_array', '阵法专精', 'specialization', '布置阵势，强化同伴与防御。', ['qimen_foundation'], { exclusiveGroup: 'qimen_path' }),
      node('qimen_mechanism', '机关专精', 'specialization', '以机关暗器制造突然的打击。', ['qimen_lure'], { exclusiveGroup: 'qimen_path' }),
      node('qimen_foresight', '推演', 'passive', '从细节推演下一步变化与风险。', ['qimen_array']),
      node('qimen_wire', '绊马索', 'active', '用机关限制敌人移动与进攻。', ['qimen_mechanism'], { cooldownTicks: 2 }),
      node('qimen_guard', '借势', 'passive', '借地形与阵眼提高自身防守。', ['qimen_array']),
      node('qimen_hidden_needle', '暗器连发', 'active', '从隐蔽角度连续发射暗器。', ['qimen_mechanism'], { cooldownTicks: 2 }),
      node('qimen_heaven', '天门借法', 'ultimate', '以天地方位之势重写一瞬战局。', ['qimen_foresight', 'qimen_hidden_needle'], { pointCost: 2, requiredProfessionLevel: 4, cooldownTicks: 7, prerequisiteMode: 'any' }),
    ]),
  ],
  freeSkillCatalog: [
    lifeSkill('medicine', '医术', '诊治伤病、辨识毒物与药材。'),
    lifeSkill('qin_art', '琴艺', '演奏、鉴赏音律并安抚心神。'),
    lifeSkill('calligraphy', '书法', '书写、临摹与辨识古籍。'),
    lifeSkill('painting', '绘画', '观察、记录与描摹人物景物。'),
    lifeSkill('tea_art', '茶道', '识茶、制茶并以茶会友。'),
    lifeSkill('divination', '卜算', '依据术数推演有限的征兆。'),
    lifeSkill('herbalism', '采药', '辨认山野药材并判断药性。'),
    lifeSkill('martial_lore', '武学典籍', '辨识门派源流、招式与心法。'),
    lifeSkill('fishing', '渔猎', '在江河山林中寻找食物与线索。'),
    lifeSkill('brewing', '酿造', '调制酒、药酒与基础发酵物。'),
    lifeSkill('forging', '铸兵', '修复兵刃并判断金属与工艺。'),
    lifeSkill('disguise', '易容', '改变外貌、仪态与公开身份线索。'),
  ],
};
