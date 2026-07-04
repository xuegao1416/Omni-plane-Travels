// ============================================================
//  奇幻世界模板 — 中世纪魔法 / 龙与地下城风格
// ============================================================

import type { WorldTemplate } from '../types';

export const fantasyTemplate: WorldTemplate = {
  id: 'genre_fantasy',
  name: '奇幻世界',
  description: '中世纪魔法世界，剑与魔法交织，龙与地下城风格的冒险舞台。',
  category: 'fantasy',
  tags: ['奇幻', '魔法', '中世纪', '冒险'],
  icon: 'Wand2',
  coverColor: '#6a1b9a',

  variables: [
    {
      key: 'worldName',
      label: '世界名称',
      type: 'text',
      required: true,
      defaultValue: '艾尔维亚',
      placeholder: '如：艾尔维亚、阿尔特里亚',
      affects: ['全局'],
    },
    {
      key: 'coreConflict',
      label: '核心冲突',
      type: 'select',
      required: true,
      defaultValue: 'dark_lord',
      options: [
        { value: 'dark_lord', label: '魔王复苏 — 黑暗势力蠢蠢欲动' },
        { value: 'kingdoms_war', label: '王国争霸 — 诸国争雄天下大乱' },
        { value: 'ancient_prophecy', label: '古老预言 — 命运之子踏上征途' },
        { value: 'magic_crisis', label: '魔力枯竭 — 世界面临魔力崩坏' },
        { value: 'race_conflict', label: '种族冲突 — 人族与异族的千年仇恨' },
      ],
      affects: ['事件', '势力关系'],
    },
    {
      key: 'magicLevel',
      label: '魔法普及度',
      type: 'select',
      required: true,
      defaultValue: 'moderate',
      options: [
        { value: 'rare', label: '稀有 — 魔法师是传说中的存在' },
        { value: 'moderate', label: '适中 — 魔法学院培养少数精英' },
        { value: 'common', label: '普及 — 魔法融入日常生活' },
      ],
      affects: ['规则', '经济', '文化'],
    },
    {
      key: 'era',
      label: '时代背景',
      type: 'select',
      required: false,
      defaultValue: 'medieval',
      options: [
        { value: 'medieval', label: '中世纪 — 城堡与骑士' },
        { value: 'renaissance', label: '文艺复兴 — 探索与变革' },
        { value: 'ancient', label: '上古时代 — 神话与英雄' },
      ],
      affects: ['世界观', '文化'],
    },
  ],

  scaffold: {
    oneLiner: '{{worldName}}——剑与魔法交织的浩瀚大陆，英雄的传说在此书写。',
    overview: `【世界背景】
{{worldName}}是一片被魔法与剑气笼罩的广袤大陆。在这里，古老的王国矗立于密林与山脉之间，魔法学院的尖塔直插云霄，冒险者公会的酒馆中永远回荡着佣兵们的欢笑与争吵。龙族隐匿于世界的尽头，精灵在月光森林中吟唱着万年前的歌谣，矮人在地底锻造着传说中的神器。

{{coreConflictDesc}}

大陆上散布着数不清的遗迹与地下城，蕴藏着远古文明的秘密与无尽的财富。无数冒险者怀揣着各自的梦想踏上征途——有人为财，有人为名，有人为寻找失落的真相，也有人仅仅是为了活下去。

【时代】{{eraDesc}}
【地点】{{worldName}}大陆
【氛围】壮丽、神秘、充满未知的冒险与危险`,

    worldScale: 'large',
    timePeriod: '{{eraDesc}}',
    coreConflict: '{{coreConflictDesc}}',
    tags: ['奇幻', '魔法', '冒险', '{{eraTag}}'],
    icon: 'Wand2',
    coverColor: '#6a1b9a',
    difficulty: 'medium',
  },

  dimensions: {
    geography: {
      locations: [
        {
          name: '{{worldName}}王都',
          description: '大陆的政治中心，雄伟的城堡俯瞰着繁华的城区。王都分为上城区（贵族与法师塔）和下城区（市集与平民区），冒险者公会总部也设在此处。',
          features: ['王城堡垒', '大法师塔', '冒险者公会', '繁华市集'],
          atmosphere: '庄严而繁忙，权力与金钱在此交汇',
        },
        {
          name: '月光森林',
          description: '古老的精灵栖息地，银色的树叶在月光下闪烁。森林深处有精灵族的秘密城市，普通人类难以找到入口。',
          features: ['精灵结界', '银叶古树', '月光溪流', '远古遗迹'],
          atmosphere: '静谧而神秘，时间在此仿佛凝固',
        },
        {
          name: '铁砧山脉',
          description: '矮人族的家园，巨大的山脉内部被挖空成庞大的地下城市与锻造工坊。山巅终年积雪，山脚有热闹的矮人贸易站。',
          features: ['矮人地下城', '锻造大师工坊', '矿脉隧道', '雪山隘口'],
          atmosphere: '火热而喧嚣，锤击声不绝于耳',
        },
        {
          name: '龙脊荒原',
          description: '大陆北方的荒凉之地，传说中龙族最后的栖息地。荒原上散布着巨大的龙骨与远古战场遗迹。',
          features: ['龙骨残骸', '远古战场', '风暴裂谷', '龙族巢穴'],
          atmosphere: '荒凉而危险，风中似乎仍回荡着龙的咆哮',
        },
        {
          name: '迷雾沼泽',
          description: '大陆南方的广袤沼泽，终年被浓雾笼罩。据说沼泽深处藏着通往地下世界的入口，以及被遗忘的远古种族遗迹。',
          features: ['浓雾迷阵', '沼泽村落', '地下入口', '远古种族遗迹'],
          atmosphere: '阴森潮湿，危机四伏',
        },
      ],
    },

    factions: {
      factions: [
        {
          name: '圣光教廷',
          description: '信仰光明之神的宗教组织，拥有庞大的骑士团与牧师团。教廷在大陆各地设有教堂，是平民的精神支柱。',
          alignment: '友善',
          headquarters: '圣光大教堂',
          philosophy: '以圣光驱散黑暗，守护世间秩序与善良',
          strength: '拥有圣骑士团与高阶牧师，信徒遍布大陆',
        },
        {
          name: '暗影议会',
          description: '由死灵法师、暗影术士与堕落贵族组成的秘密组织。他们追求禁忌知识与永生之力，是大陆最大的暗中威胁。',
          alignment: '敌对',
          headquarters: '未知（传闻在大陆某处的地下宫殿）',
          philosophy: '知识无善恶，力量才是真理',
          strength: '成员身份隐秘，渗透各国政要与魔法学院',
        },
        {
          name: '冒险者公会',
          description: '大陆最大的中立组织，接受各种委托并管理冒险者等级。公会拥有自己的情报网络与物资供应链。',
          alignment: '中立',
          headquarters: '{{worldName}}王都公会总部',
          philosophy: '为冒险者服务，保持中立不干涉政治',
          strength: '遍布大陆的分会网络，大量高阶冒险者',
        },
        {
          name: '精灵联盟',
          description: '以月光森林精灵为核心的种族联盟，包括部分树人与独角兽。对外界人类保持警惕，但并非敌对。',
          alignment: '中立',
          headquarters: '月光森林·银月城',
          philosophy: '守护自然与古老的魔法平衡',
          strength: '强大的自然魔法与漫长寿命带来的智慧',
        },
      ],
    },

    npcs: {
      npcs: [
        {
          name: '艾琳·星辉',
          role: '大法师塔首席',
          description: '大陆最强的法师之一，掌管着大法师塔的日常运作。她对魔法的研究已达到前人未及的境界。',
          personality: '冷静理性，对学术一丝不苟，但对学生有着隐藏的温柔',
          appearance: '银白色长发，紫色瞳孔，身着深蓝色法师长袍',
          background: '出身平民，凭天赋与努力登上首席之位',
          motivation: '探索魔法的本质，寻找传说中的第九环魔法',
        },
        {
          name: '铁锤·石须',
          role: '矮人锻造大师',
          description: '铁砧山脉最负盛名的锻造师，传说他能锻造出媲美远古神器的武器。',
          personality: '豪爽直率，嗜酒如命，对锻造有着近乎偏执的追求',
          appearance: '火红色大胡须，粗壮的臂膀，全身覆盖着锻造的烧伤痕迹',
          background: '矮人王族旁支，放弃王位继承权投身锻造',
          motivation: '锻造出传说中的"灭龙剑"，超越祖先的成就',
        },
        {
          name: '暗影·无面',
          role: '暗影议会密探',
          description: '没人知道他的真实身份，他可以变成任何人的模样。他是暗影议会渗透各国的核心棋子。',
          personality: '阴险狡诈，善于伪装，但偶尔流露出对普通生活的向往',
          appearance: '未知（可变化为任何人）',
          background: '据说是被暗影议会从小培养的孤儿',
          motivation: '完成暗影议会的终极计划，但内心深处渴望找到真实的自我',
        },
        {
          name: '莉亚·晨露',
          role: '精灵联盟使者',
          description: '月光森林精灵族派驻人类世界的外交官，负责维持精灵与人类的脆弱和平。',
          personality: '优雅从容，对人类文明既好奇又警惕，有着精灵特有的傲慢',
          appearance: '金色长发，翡翠绿眼眸，尖耳朵佩戴银色耳饰',
          background: '银月城长老之女，自愿承担危险的外交使命',
          motivation: '保护月光森林不受人类扩张的侵蚀',
        },
      ],
    },

    events: {
      events: [
        {
          name: '百年魔潮',
          description: '每百年一次的魔力暴涨，届时大陆上所有魔法都会增强数倍，但同时也会唤醒沉睡的远古魔兽与封印中的邪恶存在。',
          trigger: '每百年一次（根据天文历法推算）',
          significance: 'major',
        },
        {
          name: '竞技场大赛',
          description: '王都每三年举办一次的盛大比武大会，各路英雄齐聚一堂争夺"大陆最强"的称号与丰厚奖励。',
          trigger: '每三年春季',
          significance: 'minor',
        },
        {
          name: '龙族觉醒',
          description: '传说中沉睡于龙脊荒原的远古巨龙即将苏醒，届时整个大陆都将面临龙焰的考验。',
          trigger: '剧情中期事件',
          significance: 'major',
        },
        {
          name: '暗影议会行动',
          description: '暗影议会发动大规模渗透行动，试图控制各国政要并夺取远古神器。',
          trigger: '剧情推进触发',
          significance: 'major',
        },
      ],
    },

    culture: {
      description: '{{worldName}}的文化以人类王国的骑士精神与魔法学术为核心，精灵的自然崇拜与矮人的工匠精神并存。各族之间的文化差异既是冲突的根源，也是交流的动力。',
      customs: [
        '冒险者等级制度：从铜级到传奇级，等级是身份与实力的象征',
        '魔法契约：重要的承诺需以魔法契约束缚，违约者将受到魔力反噬',
        '丰收祭典：每年秋收时节各城镇举办庆典，感谢大地与光明之神',
      ],
      beliefs: [
        '光明之神信仰：大部分人类信仰光明之神，相信善良终将战胜邪恶',
        '自然平衡论：精灵族信奉万物有灵，自然平衡不可打破',
        '锻造之神崇拜：矮人族信仰锻造之神，认为最伟大的作品是用锤与火创造的',
      ],
      dailyLife: '平民以农耕与手工业为生，贵族则热衷于魔法研究与政治博弈。冒险者是特殊阶层，他们游走于城市与荒野之间，接受委托换取报酬与名声。',
      taboos: [
        '禁忌魔法：死灵术、灵魂操控等被教廷列为禁忌，研习者将被追杀',
        '龙族领地：擅闯龙脊荒原被视为自杀行为',
        '背叛公会：冒险者背叛公会将被全大陆通缉',
      ],
    },

    economy: {
      description: '{{worldName}}的经济以金本位为主，冒险活动带动了庞大的装备与药水市场。魔法物品是高价值商品，由法师塔与矮人工坊垄断供应。',
      currency: {
        name: '金币/银币/铜币',
        symbol: 'G',
        description: '1金币=10银币=100铜币，金币是大陆通用货币',
      },
      priceLevel: '贫富差距明显。普通家庭月开销约5金币，一套附魔铠甲价值数千金币，传说级神器无价。',
    },

    rules: {
      powerSystem: '魔法与武技并重。魔法师通过冥想与学习掌握各系元素魔法（火/水/风/土/光/暗），分为学徒→初级→中级→高级→大法师→传奇六个等级。战士则通过修炼斗气强化体魄与武器。',
      socialStructure: '王权→贵族→平民→奴隶的封建等级制。魔法师与冒险者是特殊阶层，不受普通法律约束。精灵与矮人拥有自治区。',
      specialRules: [
        '魔法等级制度：魔法师分为六个等级，每个等级可施展对应环数的魔法',
        '冒险者公会法：公会拥有独立的司法权，会员纠纷由公会裁决',
        '龙族契约：远古时代龙族与各族签订的和平契约，约束龙族不主动攻击文明领地',
      ],
    },
  },

  modules: {
    enabledModules: ['stat', 'progression', 'dice', 'talent'],
    moduleConfigs: {
      stat: {
        name: '冒险者属性',
        description: '衡量冒险者战斗力与综合素质的数值体系',
        moduleConfig: {
          attrA: { name: '生命值', max: 100 },
          attrB: { name: '魔力值', max: 100 },
          dim1: { name: '力量', range: [0, 100] },
          dim2: { name: '敏捷', range: [0, 100] },
          dim3: { name: '智力', range: [0, 100] },
          dim4: { name: '感知', range: [0, 100] },
          dim5: { name: '魅力', range: [0, 100] },
          dim6: { name: '幸运', range: [0, 100] },
          special: [
            { id: 'magic_power', name: '魔力亲和', value: 0, range: [0, 100], description: '对魔法元素的感知与操控能力' },
            { id: 'resistance', name: '魔法抗性', value: 0, range: [0, 100], description: '对各类魔法攻击的抵抗力' },
          ],
        },
        initialState: {
          attrA: 80, attrB: 50,
          dim1Value: 30, dim2Value: 30, dim3Value: 30,
          dim4Value: 30, dim5Value: 30, dim6Value: 30,
        },
      },
      progression: {
        name: '冒险者等级',
        description: '通过完成委托与战斗获取经验，逐步提升冒险者等级',
        moduleConfig: {
          mode: 'tiered',
          tiers: [
            { name: '铜级新手', description: '刚注册的冒险者，只能接简单委托。', xpRequired: 0 },
            { name: '铁级冒险者', description: '有一定经验，可独立完成中等难度任务。', xpRequired: 200 },
            { name: '银级精英', description: '实力出众的冒险者，小有名气。', xpRequired: 600 },
            { name: '金级勇者', description: '各大公会争抢的人才，已可挑战高难地下城。', xpRequired: 1500 },
            { name: '白金英雄', description: '名震一方的传奇人物，拥有改变局部战局的能力。', xpRequired: 4000 },
            { name: '传奇', description: '传说中的存在，百年难遇的绝世强者。', xpRequired: 10000 },
          ],
          xpFormula: { baseXP: 100, exponent: 1.8, scaleFactor: 1.0 },
          currentTierIndex: 0,
          currentXP: 0,
        },
      },
      dice: {
        name: '冒险检定',
        description: '面对陷阱、交涉、探索等情况时进行骰子检定',
        moduleConfig: { maxHistory: 10, defaultDC: 12 },
        initialState: { history: [] },
      },
      talent: {
        name: '天赋树',
        description: '冒险者在成长过程中解锁的独特能力',
        moduleConfig: { categories: [] },
        initialState: { categories: [] },
      },
    },
  },

  narrativeStyle: {
    tone: '壮丽史诗与轻松冒险交织',
    pacing: '中等节奏，探索与战斗穿插',
    contentWarnings: ['战斗暴力', '怪物描写'],
  },
};
