/**
 * 给六个内置世界的 40 张事件卡写上「各选项自己的后果」与触发器，并去掉旧的共享效果节点。
 *
 * 旧数据里每张卡的效果节点挂在选项之后、对所有选项一视同仁（选「假装路过离开」也加好感）。
 * 这里按选项写效果（effects）、检定（check + success/failure）、后续事件（next）、可选条件（requires），
 * 卡片触发器写在世界定义的 events[].trigger 上（随机牌堆 / 监听领域事件 / 一次性 / 冷却）。
 *
 * 用法：node_modules/.bin/bun scripts/events/authorBuiltinCards.ts（可重复执行，结果相同）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Json = Record<string, unknown>;
type Option = Json;
interface CardSpec { trigger?: Json; options: Option[] }

const has = (path: string, value: number) => ({ fact: path, op: '>=', value });
const money = (value: number) => has('player.currency', value);
const stock = (id: string, value: number) => has(`player.resources.${id}`, value);
const goods = (id: string, value: number) => has(`economy.goods.${id}`, value);

const SPEC: Record<string, Record<string, CardSpec>> = {
  japanese_school: {
    confession: {
      trigger: { on: ['turn.ended'], when: { fact: 'flags.心动值', op: '>=', value: 3 }, once: true, description: '心动值攒到 3 以后，在某个放学后出现' },
      options: [
        {
          check: { stat: 'flags.心动值', dc: 11, label: '心动', range: [0, 6] },
          effects: [{ stat: 'attrB', delta: -5 }],
          success: { effects: [{ flag: '恋爱关系', value: true }, { fact: 'flags.心动值', delta: 2 }], note: '对方红着脸点了点头。' },
          failure: { effects: [{ fact: 'flags.心动值', delta: -2 }, { stat: 'attrB', delta: -10 }], note: '对方说想先继续做朋友。' },
        },
        { effects: [{ fact: 'flags.心动值', delta: 1 }, { stat: 'attrB', delta: -5 }] },
        { effects: [{ fact: 'flags.心动值', delta: -1 }] },
      ],
    },
    festival: {
      trigger: { on: ['deck'], once: true, weight: 2 },
      options: [
        { effects: [{ stat: 'attrB', delta: -10 }, { currency: 30 }, { fact: 'flags.班级评价', delta: 1 }] },
        { effects: [{ stat: 'attrB', delta: -15 }, { fact: 'flags.心动值', delta: 1 }] },
        { effects: [{ stat: 'attrB', delta: -8 }, { flag: '鬼屋搭档', value: true }] },
      ],
    },
    rainy_day: {
      trigger: { on: ['deck'], cooldownTurns: 8 },
      options: [
        { effects: [{ fact: 'flags.心动值', delta: 1 }, { flag: '雨天邂逅', value: true }] },
        { effects: [{ stat: 'attrB', delta: -10 }] },
        { effects: [] },
      ],
    },
    sports_festival: {
      trigger: { on: ['deck'], once: true },
      options: [
        {
          check: { stat: 'attrB', dc: 11, label: '体力', range: [0, 100] },
          effects: [{ stat: 'attrB', delta: -20 }],
          success: { effects: [{ flag: '接力赛冠军', value: true }, { fact: 'flags.心动值', delta: 1 }, { fact: 'flags.班级评价', delta: 2 }], note: '最后一棒反超，全班沸腾。' },
          failure: { effects: [{ stat: 'attrA', delta: -5 }], note: '冲线前摔了一跤，膝盖擦破了皮。' },
        },
        { effects: [{ stat: 'attrB', delta: -10 }] },
        { effects: [{ fact: 'flags.班级评价', delta: -2 }] },
      ],
    },
    valentine: {
      trigger: { on: ['deck'], once: true },
      options: [
        { effects: [{ fact: 'flags.心动值', delta: 1 }, { flag: '知道巧克力是谁送的', value: true }] },
        { effects: [{ fact: 'flags.心动值', delta: 1 }] },
        { effects: [{ fact: 'flags.心动值', delta: -1 }] },
      ],
    },
  },

  desire_metropolis: {
    overtime: {
      trigger: { on: ['deck'], cooldownTurns: 5 },
      options: [
        { effects: [{ stat: 'attrA', delta: -10 }, { stat: 'attrB', delta: -20 }, { stat: 'happiness', delta: -5 }, { currency: 150 }] },
        {
          check: { stat: 'dim3', dc: 12 },
          effects: [{ stat: 'attrB', delta: 5 }],
          success: { note: '你跟老板解释清楚，方案宽限了一天。' },
          failure: { effects: [{ currency: -100 }, { stat: 'happiness', delta: -3 }], note: '方案没按时交，被扣了绩效。' },
        },
        {
          check: { stat: 'dim5', dc: 11 },
          success: { effects: [{ stat: 'attrB', delta: -8 }, { currency: 80 }], note: '同事爽快地帮了忙，一起提前做完。' },
          failure: { effects: [{ stat: 'attrB', delta: -15 }], note: '同事都下班了，你只能一个人熬。' },
        },
      ],
    },
    date: {
      trigger: { on: ['deck'], cooldownTurns: 6 },
      options: [
        { requires: money(300), requiresText: '钱袋不足 300', effects: [{ currency: -300 }, { stat: 'romance', delta: 10 }, { stat: 'happiness', delta: 5 }] },
        { effects: [{ currency: -60 }, { stat: 'romance', delta: 6 }, { stat: 'happiness', delta: 6 }] },
        {
          check: { stat: 'dim3', dc: 12 },
          effects: [{ currency: -150 }],
          success: { effects: [{ stat: 'romance', delta: 12 }], note: '酒过三巡，你们聊得很投机。' },
          failure: { effects: [{ stat: 'attrB', delta: -10 }, { stat: 'romance', delta: -3 }], note: '喝多了说错了话，气氛有点尴尬。' },
        },
      ],
    },
    colleague_dinner: {
      trigger: { on: ['deck'], cooldownTurns: 6 },
      options: [
        {
          check: { stat: 'dim5', dc: 12 },
          effects: [{ stat: 'attrB', delta: -10 }],
          success: { effects: [{ stat: 'dim5', delta: 3 }, { flag: '派对人脉', value: true }], note: '你认识了几位能帮上忙的人。' },
          failure: { effects: [{ stat: 'happiness', delta: -4 }], note: '几次搭话都冷了场。' },
        },
        { effects: [{ stat: 'dim3', delta: 2 }] },
        { effects: [{ stat: 'attrB', delta: 5 }, { stat: 'dim5', delta: -1 }] },
      ],
    },
    cook: {
      trigger: { on: ['deck'], cooldownTurns: 4 },
      options: [
        {
          check: { stat: 'dim4', dc: 10 },
          effects: [{ currency: -40 }, { stat: 'attrB', delta: -5 }],
          success: { effects: [{ stat: 'attrA', delta: 10 }, { stat: 'happiness', delta: 6 }, { stat: 'dim4', delta: 1 }], note: '一桌像样的饭菜，吃得心满意足。' },
          failure: { effects: [{ stat: 'happiness', delta: -2 }], note: '火候没掌握好，菜糊了一半。' },
        },
        { effects: [{ currency: -5 }, { stat: 'attrA', delta: 3 }, { stat: 'dim1', delta: -1 }] },
        { effects: [{ currency: -45 }, { stat: 'attrA', delta: 5 }] },
      ],
    },
    gym: {
      trigger: { on: ['deck'], cooldownTurns: 4 },
      options: [
        { effects: [{ currency: -50 }, { stat: 'attrA', delta: -10 }, { stat: 'dim1', delta: 3 }, { stat: 'dim2', delta: 1 }] },
        { effects: [{ stat: 'attrA', delta: -6 }, { stat: 'dim1', delta: 2 }] },
        { effects: [{ stat: 'attrB', delta: 4 }, { stat: 'happiness', delta: -1 }] },
      ],
    },
    moving: {
      trigger: { on: ['deck'], once: true },
      options: [
        { effects: [{ currency: -200 }, { stat: 'attrB', delta: -15 }, { stat: 'happiness', delta: 5 }, { flag: '搬了新家', value: true }] },
        {
          check: { stat: 'dim3', dc: 13 },
          success: { effects: [{ flag: '房租谈下来', value: true }], note: '房东松了口，房租不涨了。' },
          failure: { effects: [{ currency: -150 }], note: '房东寸步不让，房租还是涨了。' },
        },
        { effects: [{ currency: -100 }, { stat: 'happiness', delta: -3 }] },
      ],
    },
    pet_sick: {
      trigger: { on: ['deck'], once: true },
      options: [
        { effects: [{ currency: -250 }, { stat: 'attrB', delta: -8 }, { stat: 'happiness', delta: 3 }] },
        {
          check: { stat: 'dim3', dc: 12, label: '细心' },
          success: { note: '猫咪第二天恢复了胃口。' },
          failure: { effects: [{ currency: -400 }, { stat: 'happiness', delta: -8 }], note: '病情加重，最后还是去了医院。' },
        },
        {
          check: { stat: 'dim3', dc: 14, label: '判断' },
          effects: [{ stat: 'attrB', delta: -5 }],
          success: { effects: [{ currency: -60 }], note: '对症买了药，猫咪慢慢好起来。' },
          failure: { effects: [{ currency: -300 }, { stat: 'happiness', delta: -5 }], note: '判断错了，耽误了治疗，花得更多。' },
        },
      ],
    },
  },

  wuxia_world: {
    duel: {
      trigger: { on: ['deck'], cooldownTurns: 6 },
      options: [
        {
          check: { stat: 'dim1', dc: 12 },
          effects: [{ stat: 'attrB', delta: -15 }],
          success: { effects: [{ stat: 'melancholy', delta: 3 }, { currency: 50 }, { fact: 'flags.江湖声望', delta: 1 }], note: '你技高一筹，围观的江湖人齐声喝彩。' },
          failure: { effects: [{ stat: 'attrA', delta: -30 }], note: '你落败负伤。', next: 'injury' },
        },
        { effects: [{ stat: 'dim5', delta: 2 }, { fact: 'flags.江湖声望', delta: -1 }] },
        {
          check: { stat: 'dim3', dc: 10 },
          effects: [{ stat: 'attrB', delta: -8 }],
          success: { effects: [{ stat: 'dim3', delta: 2 }, { fact: 'flags.江湖声望', delta: 1 }], note: '点到为止，双方都心服口服。' },
          failure: { effects: [{ stat: 'attrA', delta: -10 }], note: '对方收手不及，你挨了一掌。' },
        },
      ],
    },
    treasure_map: {
      trigger: { on: ['deck'], once: true },
      options: [
        {
          requires: money(120), requiresText: '钱袋不足 120',
          check: { stat: 'dim6', dc: 13 },
          effects: [{ currency: -120 }, { flag: '获得藏宝图', value: true }],
          success: { effects: [{ currency: 400 }, { item: '残缺秘籍', delta: 1 }], note: '你在藏宝地找到了前辈的遗物。' },
          failure: { effects: [{ stat: 'attrA', delta: -20 }], note: '藏宝地早被人捷足先登，你还撞上了埋伏。' },
        },
        { effects: [{ stat: 'dim4', delta: 1 }] },
        { effects: [{ currency: -60 }, { flag: '获得藏宝图', value: true }, { fact: 'flags.江湖声望', delta: 1 }] },
      ],
    },
    secret_realm: {
      trigger: { on: ['deck'], once: true },
      options: [
        {
          check: { stat: 'dim5', dc: 12 },
          success: { effects: [{ stat: 'attrB', delta: 30 }, { stat: 'reputation', delta: 5 }, { stat: 'dim4', delta: 3 }], note: '你在洞中参悟了石壁上的心法。' },
          failure: { effects: [{ stat: 'attrA', delta: -25 }, { stat: 'attrB', delta: -20 }], note: '洞中真气紊乱，你被内力反噬。' },
        },
        { effects: [{ stat: 'dim4', delta: 2 }] },
        { effects: [] },
      ],
    },
    rival: {
      trigger: { on: ['deck'], cooldownTurns: 8 },
      options: [
        {
          check: { stat: 'dim1', dc: 14 },
          effects: [{ stat: 'attrB', delta: -20 }],
          success: { effects: [{ stat: 'melancholy', delta: 4 }, { fact: 'flags.江湖声望', delta: 2 }], note: '宿敌落败而逃。' },
          failure: { effects: [{ stat: 'attrA', delta: -40 }], note: '你中了对方淬毒的暗器。', next: 'poison' },
        },
        {
          check: { stat: 'dim5', dc: 13 },
          success: { effects: [{ flag: '化解宿怨', value: true }, { stat: 'dim5', delta: 3 }], note: '多年恩怨，一笑了之。' },
          failure: { effects: [{ stat: 'attrA', delta: -15 }], note: '对方不领情，趁你开口时出手偷袭。' },
        },
        {
          check: { stat: 'dim3', dc: 10 },
          success: { note: '你几个起落便甩开了对方。' },
          failure: { effects: [{ stat: 'attrA', delta: -15 }], note: '被追上挨了一掌。' },
        },
      ],
    },
    poison: {
      trigger: { on: ['deck'], cooldownTurns: 10 },
      options: [
        {
          check: { stat: 'attrB', dc: 11, label: '内息' },
          effects: [{ stat: 'attrB', delta: -30 }],
          success: { note: '毒素被逼出了体外。' },
          failure: { effects: [{ stat: 'attrA', delta: -30 }], note: '内力不济，毒素攻心。' },
        },
        { effects: [{ currency: -80 }, { stat: 'attrA', delta: -10 }] },
        { effects: [{ stat: 'attrA', delta: -45 }, { stat: 'dim2', delta: -2 }] },
      ],
    },
    breakthrough: {
      trigger: { on: ['deck'], once: true, when: { fact: 'turn', op: '>=', value: 10 } },
      options: [
        {
          check: { stat: 'dim4', dc: 12 },
          effects: [{ stat: 'attrB', delta: -30 }],
          success: { effects: [{ stat: 'reputation', delta: 8 }, { stat: 'dim2', delta: 4 }], note: '真气贯通，内功大进。' },
          failure: { effects: [{ stat: 'attrA', delta: -30 }], note: '急于求成，险些走火入魔。' },
        },
        { requires: money(100), requiresText: '钱袋不足 100', effects: [{ currency: -100 }, { stat: 'reputation', delta: 4 }, { stat: 'dim4', delta: 2 }] },
        { effects: [{ stat: 'dim5', delta: 2 }] },
      ],
    },
    injury: {
      trigger: { on: ['deck'], cooldownTurns: 10 },
      options: [
        { effects: [{ stat: 'attrB', delta: -30 }, { stat: 'attrA', delta: 30 }] },
        { requires: money(100), requiresText: '钱袋不足 100', effects: [{ currency: -100 }, { stat: 'attrA', delta: 50 }] },
        { effects: [{ stat: 'attrA', delta: -20 }] },
      ],
    },
    encounter: {
      trigger: { on: ['deck'], once: true },
      options: [
        {
          check: { stat: 'dim6', dc: 12 },
          success: { effects: [{ stat: 'dim4', delta: 6 }, { stat: 'reputation', delta: 6 }, { flag: '隐世高人指点', value: true }], note: '高人传了你一套心法。' },
          failure: { effects: [{ stat: 'dim5', delta: 2 }], note: '高人只留下一句话，便飘然而去。' },
        },
        { effects: [{ stat: 'dim6', delta: 3 }, { flag: '结识隐世高人', value: true }] },
        { effects: [] },
      ],
    },
  },

  wasteland_apocalypse: {
    radiation_storm: {
      trigger: { on: ['deck'], cooldownTurns: 6 },
      options: [
        {
          check: { stat: 'dim3', dc: 11 },
          effects: [{ stat: 'attrB', delta: -10 }],
          success: { note: '你及时钻进了一间地下室。' },
          failure: { effects: [{ stat: 'attrA', delta: -15 }], note: '没找到像样的掩体，淋了一身辐射尘。', next: 'radiation_sickness' },
        },
        {
          check: { stat: 'radiation_res', dc: 12 },
          success: { effects: [{ stat: 'attrA', delta: -5 }], note: '防护装备撑住了。' },
          failure: { effects: [{ stat: 'attrA', delta: -20 }], note: '面罩的滤芯早就失效了。', next: 'radiation_sickness' },
        },
        { effects: [{ stat: 'attrB', delta: -25 }, { stat: 'attrA', delta: -5 }] },
      ],
    },
    mutant_fight: {
      trigger: { on: ['deck'], cooldownTurns: 5 },
      options: [
        {
          check: { stat: 'dim1', dc: 12 },
          effects: [{ stat: 'attrB', delta: -15 }],
          success: { effects: [{ currency: 40 }, { item: '变异体腺体', delta: 1 }], note: '你干掉了变异体，割下了值钱的腺体。' },
          failure: { effects: [{ stat: 'attrA', delta: -25 }], note: '爪子划开了你的护甲。' },
        },
        {
          check: { stat: 'dim2', dc: 10 },
          effects: [{ stat: 'attrB', delta: -20 }],
          success: { note: '你甩掉了它。' },
          failure: { effects: [{ stat: 'attrA', delta: -12 }], note: '逃跑时后背被抓了一道。' },
        },
        {
          requires: { fact: 'flags.异能觉醒', op: '==', value: true }, requiresText: '异能尚未觉醒',
          check: { stat: 'psychic_power', dc: 11 },
          effects: [{ stat: 'attrB', delta: -10 }],
          success: { effects: [{ stat: 'psychic_power', delta: 1 }], note: '异能把变异体撕成了碎片。' },
          failure: { effects: [{ stat: 'attrA', delta: -15 }, { stat: 'dim6', delta: -1 }], note: '异能失控，反伤了自己。' },
        },
      ],
    },
    supply_cache: {
      trigger: { on: ['deck'], cooldownTurns: 8 },
      options: [
        {
          check: { stat: 'dim3', dc: 11 },
          success: { effects: [{ stat: 'attrA', delta: 10 }, { stat: 'attrB', delta: 10 }, { item: '罐头', delta: 3 }, { item: '抗辐射药', delta: 1 }], note: '掩体里还有没过期的补给。' },
          failure: { effects: [{ stat: 'attrA', delta: -12 }], note: '门后连着一颗诡雷。' },
        },
        { effects: [{ stat: 'attrB', delta: -5 }, { item: '罐头', delta: 2 }] },
        { effects: [] },
      ],
    },
    awakening: {
      trigger: {
        on: ['turn.ended'], once: true, chance: 0.35,
        when: { any: [{ fact: 'player.hp', op: '<=', value: 30 }, { fact: 'turn', op: '>=', value: 20 }] },
        description: '濒死（生命 ≤ 30）或旅程进入后期时可能觉醒',
      },
      options: [
        {
          check: { stat: 'dim6', dc: 12 },
          effects: [{ flag: '异能觉醒', value: true }],
          success: { effects: [{ stat: 'psychic_power', delta: 4 }, { stat: 'dim3', delta: 1 }], note: '你驯服了这股力量。' },
          failure: { effects: [{ stat: 'psychic_power', delta: 2 }, { stat: 'attrA', delta: -10 }], note: '力量失控，反噬了身体。' },
        },
        { effects: [{ stat: 'dim6', delta: 1 }] },
        { effects: [{ flag: '异能觉醒', value: true }, { stat: 'psychic_power', delta: 2 }, { flag: '寻找异能导师', value: true }] },
      ],
    },
    radiation_sickness: {
      trigger: { on: ['deck'], cooldownTurns: 10 },
      options: [
        {
          check: { stat: 'dim4', dc: 11 },
          effects: [{ stat: 'attrB', delta: -15 }],
          success: { effects: [{ stat: 'attrA', delta: 15 }, { item: '抗辐射药', delta: 1 }], note: '你在废弃医院找到了药。' },
          failure: { effects: [{ stat: 'attrA', delta: -10 }], note: '药柜早就被搬空了。' },
        },
        { effects: [{ stat: 'attrA', delta: 5 }, { stat: 'attrB', delta: -5 }] },
        {
          check: { stat: 'dim2', dc: 13 },
          success: { effects: [{ stat: 'radiation_res', delta: 1 }], note: '身体扛了过来，对辐射多了些抵抗力。' },
          failure: { effects: [{ stat: 'attrA', delta: -25 }], note: '症状越来越重。' },
        },
      ],
    },
    raider_ambush: {
      trigger: { on: ['deck'], cooldownTurns: 8 },
      options: [
        {
          check: { stat: 'dim1', dc: 13 },
          effects: [{ stat: 'attrB', delta: -20 }],
          success: { effects: [{ currency: 80 }, { item: '弹药', delta: 5 }], note: '你击退了掠夺者，还缴获了物资。' },
          failure: { effects: [{ stat: 'attrA', delta: -30 }, { currency: -100 }], note: '寡不敌众，被抢走了一部分家当。' },
        },
        { effects: [{ currency: -150 }] },
        {
          check: { stat: 'dim3', dc: 12 },
          effects: [{ stat: 'attrB', delta: -15 }],
          success: { note: '你钻进下水道，绕开了包围。' },
          failure: { effects: [{ stat: 'attrA', delta: -15 }, { currency: -50 }], note: '慌乱中丢了钱袋，还中了一枪。' },
        },
      ],
    },
    trader_encounter: {
      trigger: { on: ['deck'], cooldownTurns: 6 },
      options: [
        { requires: money(60), requiresText: '钱袋不足 60', effects: [{ currency: -60 }, { item: '净水', delta: 3 }, { item: '抗辐射药', delta: 1 }] },
        {
          check: { stat: 'dim5', dc: 11 },
          success: { effects: [{ flag: '商队同行', value: true }, { stat: 'attrB', delta: 10 }], note: '商队队长接纳了你。' },
          failure: { note: '队长打量了你一眼，婉拒了。' },
        },
        { effects: [] },
      ],
    },
  },

  stranded_island: {
    water_crisis: {
      trigger: { on: ['resources.low', 'resources.depleted'], when: { event: { type: 'resources.*', where: { id: 'water' } } }, cooldownTurns: 4, description: '淡水告急或耗尽时出现' },
      options: [
        {
          check: { stat: 'player.hp', dc: 10, label: '体能', range: [0, 100] },
          effects: [{ stat: 'attrB', delta: -20 }],
          success: { effects: [{ resource: 'water', delta: 5 }], note: '你在山腰找到了一处清澈的泉眼。' },
          failure: { effects: [{ resource: 'water', delta: 2 }, { stat: 'attrA', delta: -8 }], note: '山路湿滑，打水时摔伤了手肘。' },
        },
        { requires: stock('cloth', 1), requiresText: '需要 1 份布料', effects: [{ resource: 'cloth', delta: -1 }, { resource: 'water', delta: 3 }] },
        { requires: stock('wood', 2), requiresText: '需要 2 份木材', effects: [{ resource: 'wood', delta: -2 }, { resource: 'water', delta: 2 }, { stat: 'attrB', delta: -10 }] },
      ],
    },
    wild_animal: {
      trigger: { on: ['deck'], cooldownTurns: 5 },
      options: [
        { requires: stock('wood', 2), requiresText: '需要 2 份木材', effects: [{ resource: 'wood', delta: -2 }] },
        {
          requires: stock('wood', 1), requiresText: '需要 1 份木材',
          check: { stat: 'attrB', dc: 11, label: '体力', range: [0, 100] },
          effects: [{ resource: 'wood', delta: -1 }],
          success: { effects: [{ resource: 'food', delta: 3 }], note: '你击退了野兽，还得到了一些肉。' },
          failure: { effects: [{ stat: 'attrA', delta: -15 }], note: '野兽扑倒了你。', next: 'injury' },
        },
        { effects: [{ stat: 'attrB', delta: -5 }, { resource: 'food', delta: -1 }] },
      ],
    },
    exploration: {
      trigger: { on: ['deck'], cooldownTurns: 6 },
      options: [
        {
          check: { stat: 'player.hp', dc: 11, label: '体能', range: [0, 100] },
          effects: [{ stat: 'attrB', delta: -15 }],
          success: { effects: [{ resource: 'stone', delta: 4 }, { flag: '发现洞穴', value: true }], note: '洞里有古人留下的石器，还有一处干燥的栖身地。' },
          failure: { effects: [{ stat: 'attrA', delta: -10 }], note: '洞顶落石砸中了你。' },
        },
        { effects: [{ resource: 'herb', delta: 2 }, { resource: 'food', delta: 1 }, { stat: 'attrB', delta: -8 }] },
        { effects: [{ flag: '洞穴位置已标记', value: true }] },
      ],
    },
    rescue_signal: {
      trigger: { on: ['deck'], once: true, when: { fact: 'turn', op: '>=', value: 6 } },
      options: [
        {
          check: { stat: 'attrB', dc: 13, label: '专注', range: [0, 100] },
          effects: [{ stat: 'attrB', delta: -15 }],
          success: { effects: [{ flag: '发报机修好', value: true }, { flag: '发出救援信号', value: true }], note: '发报机发出了微弱的求救电码。' },
          failure: { note: '零件损坏严重，还需要更多材料。' },
        },
        { effects: [{ flag: '发出救援信号', value: true }] },
        { requires: stock('wood', 4), requiresText: '需要 4 份木材', effects: [{ resource: 'wood', delta: -4 }, { flag: '发出救援信号', value: true }, { flag: '烟火信号', value: true }] },
      ],
    },
    injury: {
      trigger: { on: ['deck'], cooldownTurns: 8 },
      options: [
        { requires: stock('cloth', 1), requiresText: '需要 1 份布料', effects: [{ resource: 'cloth', delta: -1 }, { stat: 'attrA', delta: 5 }] },
        {
          check: { stat: 'attrB', dc: 10, label: '体力', range: [0, 100] },
          success: { effects: [{ resource: 'herb', delta: 1 }, { stat: 'attrA', delta: 8 }], note: '你找到了止血的草药。' },
          failure: { effects: [{ status: 'wounded' }], note: '没找到合用的草药，伤口开始发炎。' },
        },
        { effects: [{ status: 'wounded' }] },
      ],
    },
    conflict: {
      trigger: { on: ['deck'], cooldownTurns: 8 },
      options: [
        { requires: stock('food', 1), requiresText: '需要 1 份食物', effects: [{ resource: 'food', delta: -1 }, { fact: 'flags.营地威望', delta: 1 }] },
        { effects: [{ fact: 'flags.营地威望', delta: -1 }] },
        { effects: [{ fact: 'flags.营地威望', delta: 1 }, { flag: '营地结怨', value: true }] },
      ],
    },
  },

  border_trade: {
    deal: {
      trigger: { on: ['deck'], cooldownTurns: 6 },
      options: [
        { requires: money(400), requiresText: '钱袋不足 400', effects: [{ currency: -400 }, { fact: 'economy.goods.羽绒服', delta: 6 }] },
        { requires: money(200), requiresText: '钱袋不足 200', effects: [{ currency: -200 }, { fact: 'economy.goods.羽绒服', delta: 3 }] },
        { requires: money(150), requiresText: '钱袋不足 150', effects: [{ currency: -150 }, { fact: 'economy.goods.羽绒服', delta: 2 }, { fact: 'economy.reputation.local', delta: 3 }, { flag: '有合伙人', value: true }] },
      ],
    },
    smuggle: {
      trigger: { on: ['deck'], cooldownTurns: 10 },
      options: [
        {
          check: { stat: 'economy.reputation.local', dc: 12, label: '门路', range: [-100, 100] },
          success: { effects: [{ currency: 600 }], note: '货顺利过了关。' },
          failure: { effects: [{ currency: -300 }, { fact: 'economy.reputation.local', delta: -10 }], note: '货在口岸被扣下，还交了一笔罚款。' },
        },
        { effects: [] },
        { effects: [{ fact: 'economy.reputation.local', delta: 8 }, { flag: '举报走私', value: true }] },
      ],
    },
    currency_crisis: {
      trigger: { on: ['deck'], when: { fact: 'player.currency', op: '<', value: 600 }, cooldownTurns: 12, description: '钱袋低于 600 时可能出现' },
      options: [
        { effects: [{ currency: 300 }, { flag: '欠朋友人情', value: true }, { fact: 'economy.reputation.local', delta: -2 }] },
        { requires: goods('羽绒服', 2), requiresText: '仓库里不到 2 件羽绒服', effects: [{ fact: 'economy.goods.羽绒服', delta: -2 }, { currency: 110 }] },
        {
          check: { stat: 'economy.reputation.local', dc: 11, label: '信誉', range: [-100, 100] },
          success: { note: '供货商同意宽限一周。' },
          failure: { effects: [{ currency: -200 }, { fact: 'economy.reputation.local', delta: -5 }], note: '供货商当场翻脸，催走了一笔货款。' },
        },
      ],
    },
    network: {
      trigger: { on: ['deck'], once: true },
      options: [
        { requires: money(30), requiresText: '钱袋不足 30', effects: [{ currency: -30 }, { fact: 'economy.reputation.local', delta: 10 }, { flag: '建立人脉', value: true }] },
        {
          check: { stat: 'economy.reputation.local', dc: 11, label: '口碑', range: [-100, 100] },
          success: { effects: [{ fact: 'economy.reputation.local', delta: 5 }, { flag: '建立人脉', value: true }], note: '有人听说过你，主动来攀谈。' },
          failure: { note: '一晚上没人搭理你。' },
        },
        { effects: [] },
      ],
    },
    quality_issue: {
      trigger: { on: ['economy.traded'], when: { event: { type: 'economy.traded', where: { side: 'sell' } } }, chance: 0.2, cooldownTurns: 8, description: '卖货之后偶尔会遇到客户投诉' },
      options: [
        { effects: [{ currency: -120 }, { fact: 'economy.reputation.local', delta: 4 }] },
        { effects: [{ currency: -60 }, { fact: 'economy.reputation.local', delta: 2 }] },
        { effects: [{ fact: 'economy.reputation.local', delta: -10 }] },
      ],
    },
    big_deal: {
      trigger: { on: ['deck'], cooldownTurns: 8 },
      options: [
        { effects: [{ command: 'economy.offerContract', args: { client: '大客户', title: '大批羽绒服', goods: '羽绒服', quantity: 10, days: 7 } }] },
        { effects: [{ command: 'economy.offerContract', args: { client: '大客户', title: '分批交付羽绒服', goods: '羽绒服', quantity: 5, days: 10 } }] },
        { effects: [{ fact: 'economy.reputation.local', delta: -2 }] },
      ],
    },
    scam: {
      trigger: { on: ['deck'], once: true, when: { fact: 'flags.有合伙人', op: '==', value: true }, description: '和人合伙做过生意以后才会出现' },
      options: [
        {
          check: { stat: 'economy.reputation.local', dc: 13, label: '关系', range: [-100, 100] },
          effects: [{ currency: -300 }, { flag: '有合伙人', value: false }],
          success: { effects: [{ currency: 200 }], note: '警方追回了一部分钱。' },
          failure: { note: '报案以后石沉大海。' },
        },
        {
          check: { stat: 'economy.reputation.local', dc: 12, label: '门路', range: [-100, 100] },
          effects: [{ currency: -350 }, { flag: '有合伙人', value: false }],
          success: { effects: [{ currency: 280 }], note: '你托人找到了骗子的下落，追回了大半。' },
          failure: { effects: [{ fact: 'economy.reputation.local', delta: -5 }], note: '追债闹得满城风雨，钱却没要回来。' },
        },
        { effects: [{ currency: -300 }, { flag: '有合伙人', value: false }, { flag: '防骗经验', value: true }] },
      ],
    },
  },
};

/** 荒岛的伤口状态（受伤卡使用）：每天流失生命，检定 -1，三天后自愈或用草药处理。 */
const EXTRA_STATUSES: Record<string, Json[]> = {
  stranded_island: [{
    id: 'wounded', name: '伤口发炎', description: '伤口没有处理好，每天流失生命，做事也更容易出错。',
    severity: 'major', perDay: { hp: -5 }, modifiers: [{ target: 'dice.check', mode: 'flat', value: -1 }], days: 3,
  }],
};

const file = fileURLToPath(new URL('../../src/data/worlds.json', import.meta.url));
const worlds = JSON.parse(readFileSync(file, 'utf8')) as Json[];
let cards = 0;
for (const world of worlds) {
  const specs = SPEC[String(world.id)];
  if (!specs) continue;
  for (const pack of (world.eventPacks as Json[] | undefined) ?? []) {
    for (const event of (pack.events as Json[] | undefined) ?? []) {
      const spec = specs[String(event.id)];
      if (!spec) throw new Error(`没有为 ${String(world.id)}/${String(event.id)} 写规格`);
      const workflow = event.workflow as { nodes: Json[]; connections: Json[] };
      const choice = workflow.nodes.find(node => String(node.typeId).startsWith('choice.'));
      if (!choice) throw new Error(`${String(event.id)} 没有选项节点`);
      const values = choice.widgetValues as Json;
      const existing = JSON.parse(String(values.options)) as Option[];
      if (existing.length !== spec.options.length) throw new Error(`${String(event.id)} 选项数不一致：${existing.length} vs ${spec.options.length}`);
      values.options = JSON.stringify(existing.map((option, index) => ({ label: option.label, ...(option.aiNote ? { aiNote: option.aiNote } : {}), ...spec.options[index] })));
      const removed = new Set(workflow.nodes.filter(node => String(node.typeId).startsWith('effect.')).map(node => String(node.id)));
      workflow.nodes = workflow.nodes.filter(node => !removed.has(String(node.id)));
      workflow.connections = workflow.connections.filter(connection => !removed.has(String(connection.sourceNodeId)) && !removed.has(String(connection.targetNodeId)));
      if (spec.trigger) event.trigger = spec.trigger;
      else delete event.trigger;
      cards += 1;
    }
  }
  const extra = EXTRA_STATUSES[String(world.id)];
  if (extra) {
    const survival = ((world.modules as Json[] | undefined) ?? []).find(module => module.moduleId === 'survival');
    const config = survival?.moduleConfig as Json | undefined;
    if (!config) throw new Error(`${String(world.id)} 没有生存模块配置`);
    const statuses = Array.isArray(config.statuses) ? config.statuses as Json[] : [];
    config.statuses = [...statuses.filter(status => !extra.some(item => item.id === status.id)), ...extra];
  }
}
writeFileSync(file, `${JSON.stringify(worlds, null, 2)}\n`);
console.log(`已更新 ${cards} 张事件卡`);
