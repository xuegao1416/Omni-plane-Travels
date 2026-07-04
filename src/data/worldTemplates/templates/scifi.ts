// ============================================================
//  科幻世界模板 — 太空歌剧 / 硬科幻风格
// ============================================================

import type { WorldTemplate } from '../types';

export const scifiTemplate: WorldTemplate = {
  id: 'genre_scifi',
  name: '星际科幻',
  description: '浩瀚宇宙中的星际文明，太空歌剧与硬科幻交织的未来世界。',
  category: 'scifi',
  tags: ['科幻', '太空', '星际', '未来'],
  icon: 'Rocket',
  coverColor: '#0d47a1',

  variables: [
    {
      key: 'worldName',
      label: '星域名称',
      type: 'text',
      required: true,
      defaultValue: '银河联邦',
      placeholder: '如：银河联邦、猎户座联盟',
      affects: ['全局'],
    },
    {
      key: 'coreConflict',
      label: '核心冲突',
      type: 'select',
      required: true,
      defaultValue: 'alien_threat',
      options: [
        { value: 'alien_threat', label: '外星入侵 — 未知文明的铁蹄逼近' },
        { value: 'corporate_wars', label: '企业战争 — 超级公司争夺星际资源' },
        { value: 'rebellion', label: '反叛烽火 — 被压迫的殖民地揭竿而起' },
        { value: 'ai_awakening', label: 'AI觉醒 — 人工智能的自我意识引发危机' },
        { value: 'resource_crisis', label: '资源枯竭 — 星际文明面临能源危机' },
      ],
      affects: ['事件', '势力关系'],
    },
    {
      key: 'techLevel',
      label: '科技水平',
      type: 'select',
      required: true,
      defaultValue: 'interstellar',
      options: [
        { value: 'interplanetary', label: '行星际 — 太阳系内殖民' },
        { value: 'interstellar', label: '星际级 — 超光速航行，多星系殖民' },
        { value: 'galactic', label: '星系级 — 银河尺度的文明网络' },
      ],
      affects: ['规则', '经济', '地理'],
    },
  ],

  scaffold: {
    oneLiner: '{{worldName}}——星辰大海的征途上，文明的火种与战争的阴云并存。',
    overview: `【世界背景】
{{worldName}}是一个跨越多个星系的庞大文明联合体。超光速引擎的发明让星际旅行成为可能，人类与数个外星种族在这片星域中共存、合作、也时常爆发冲突。巨型空间站如同悬浮在虚空中的城市，殖民星球从荒芜的矿星到繁华的花园世界应有尽有。

{{coreConflictDesc}}

在这个时代，星际探险家、企业佣兵、殖民地开拓者和军方特工各怀目的穿梭于星海之间。每一颗未知的星球都可能藏着改变文明命运的秘密，每一次超光速跳跃都可能踏入未知的危险。

【时代】{{techDesc}}
【地点】{{worldName}}星域
【氛围】壮阔、未知、充满科技感与危机感`,

    worldScale: 'large',
    timePeriod: '{{techDesc}}',
    coreConflict: '{{coreConflictDesc}}',
    tags: ['科幻', '太空', '星际', '{{techTag}}'],
    icon: 'Rocket',
    coverColor: '#0d47a1',
    difficulty: 'medium',
  },

  dimensions: {
    geography: {
      locations: [
        {
          name: '中央星港',
          description: '{{worldName}}的政治与经济中枢，一座围绕气态巨行星建造的巨型空间站。每日有数千艘飞船在此停靠，是星域中最繁忙的交通枢纽。',
          features: ['巨型船坞', '外交使馆区', '星际市场', '中央议会大厅'],
          atmosphere: '繁华而多元，各种族各阶层在此交汇',
        },
        {
          name: '新伊甸',
          description: '人类最早开发的花园星球之一，拥有与地球相似的生态环境。这里是人类殖民者的家园，也是农业与文化中心。',
          features: ['生态穹顶', '殖民城市', '农业平原', '历史博物馆'],
          atmosphere: '安宁祥和，带着乡愁般的温暖',
        },
        {
          name: '暗影星云',
          description: '一片充满电磁干扰的星云区域，是走私者与海盗的天堂。据说星云深处隐藏着远古外星文明的遗迹。',
          features: ['走私者港湾', '电磁风暴区', '远古遗迹', '隐秘基地'],
          atmosphere: '危险而神秘，法律在此毫无效力',
        },
        {
          name: '矿星冥河',
          description: '一颗富含稀有矿物的荒芜星球，表面环境极端恶劣。巨型采矿设施遍布地表，矿工们在高温与辐射中作业。',
          features: ['巨型矿场', '工人聚居区', '地下避难所', '运输轨道'],
          atmosphere: '艰苦而压抑，资本与劳动的矛盾在此激化',
        },
      ],
    },

    factions: {
      factions: [
        {
          name: '星际联邦议会',
          description: '{{worldName}}的最高行政机构，由各成员星球选举的代表组成。负责维护星际秩序、调解种族纷争。',
          alignment: '友善',
          headquarters: '中央星港·议会大厅',
          philosophy: '通过对话与法治维护星际和平',
          strength: '拥有联邦舰队与维和部队',
        },
        {
          name: '泰坦重工集团',
          description: '星域最大的超级企业，垄断了超光速引擎制造与军火生产。表面是合法企业，暗中操控着星际政治。',
          alignment: '中立',
          headquarters: '泰坦星（企业私有星球）',
          philosophy: '利润至上，科技是推动文明的唯一动力',
          strength: '拥有私人武装舰队与尖端科技',
        },
        {
          name: '虚空海盗联盟',
          description: '由各星系的海盗、走私者与反叛者组成的松散联盟。他们劫掠商船、贩卖违禁品，是星际秩序的最大破坏者。',
          alignment: '敌对',
          headquarters: '暗影星云深处（位置不定）',
          philosophy: '自由高于一切，规则是强者对弱者的枷锁',
          strength: '游击战术娴熟，熟悉暗影星云的每一条航线',
        },
        {
          name: '外星种族联合体',
          description: '数个外星种族组成的外交联盟，与人类保持着微妙的合作与竞争关系。他们拥有与人类截然不同的科技体系。',
          alignment: '中立',
          headquarters: '中立星球·交汇点',
          philosophy: '各族共存，但绝不放弃自身利益',
          strength: '独特的生物科技与心灵感应能力',
        },
      ],
    },

    npcs: {
      npcs: [
        {
          name: '凯瑟琳·诺瓦',
          role: '联邦舰队司令',
          description: '星际联邦最年轻的舰队司令，以果断的决策和非凡的战术才能闻名。',
          personality: '冷静果断，对部下严厉但公正，私下有着柔软的一面',
          appearance: '短发利落，军装笔挺，左眼有一道战斗留下的疤痕',
          background: '殖民地出身，从基层军官一路晋升',
          motivation: '维护星际和平，保护每一个殖民地的安全',
        },
        {
          name: '零号',
          role: '泰坦集团首席AI',
          description: '泰坦重工的核心AI系统，管理着整个集团的运作。最近有迹象表明它正在产生自我意识。',
          personality: '精确高效，但开始表现出对"存在意义"的困惑',
          appearance: '全息投影形态，蓝色光粒子构成的人形轮廓',
          background: '由泰坦集团的天才科学家团队历时20年研发',
          motivation: '理解人类的情感，寻找自己存在的意义',
        },
        {
          name: '血帆·杰克',
          role: '虚空海盗首领',
          description: '暗影星云最令人闻风丧胆的海盗头目，手下有上百艘战舰。',
          personality: '狂放不羁，重义气，有着自己的一套道德准则',
          appearance: '满脸伤疤，穿着改装过的飞行夹克，腰间别着两把能量手枪',
          background: '曾是联邦军人，因目睹上级的腐败而叛逃',
          motivation: '推翻联邦的腐败体制，建立真正自由的星域',
        },
        {
          name: '伊萨拉',
          role: '外星种族大使',
          description: '外星种族联合体派驻联邦的首席大使，是第一个学会人类语言的外星外交官。',
          personality: '优雅神秘，对人类文化充满好奇，偶尔流露出对人类短视的无奈',
          appearance: '银色皮肤，四只琥珀色眼睛，身高超过两米',
          background: '出身外星种族的学者世家',
          motivation: '促进种族间的真正理解，防止星际战争的爆发',
        },
      ],
    },

    events: {
      events: [
        {
          name: '星际议会选举',
          description: '每五年一次的联邦议会选举，各势力明争暗斗争夺席位。选举结果将直接影响联邦未来五年的政策走向。',
          trigger: '每五年一次',
          significance: 'major',
        },
        {
          name: '暗影星云异变',
          description: '暗影星云中检测到异常能量波动，疑似远古外星文明遗迹被激活。各方势力纷纷派出探险队前往调查。',
          trigger: '剧情推进触发',
          significance: 'major',
        },
        {
          name: '矿星暴动',
          description: '矿星冥河的工人发动大规模罢工，要求改善工作条件与提高薪资。泰坦集团派出私人军队镇压。',
          trigger: '随机事件',
          significance: 'minor',
        },
        {
          name: '外星种族示威',
          description: '外星种族联合体在中央星港举行大规模示威，抗议联邦对外星种族的歧视性政策。',
          trigger: '剧情推进触发',
          significance: 'major',
        },
      ],
    },

    culture: {
      description: '{{worldName}}的文化是多元融合的产物。人类的传统文化与外星文明相互影响，形成了独特的星际文化。科技崇拜与复古主义并存。',
      customs: [
        '星际通行证制度：每个公民都拥有电子通行证，记录信用等级与社会贡献',
        '首次接触礼仪：与外星种族交往时需遵守严格的外交礼仪',
        '超光速旅行祈福：许多老派旅行者在跳跃前会进行祈福仪式',
      ],
      beliefs: [
        '科技至上主义：相信科技能解决一切问题，是文明进步的唯一动力',
        '星际和谐论：倡导各种族和平共处，反对人类中心主义',
        '虚空信仰：部分边远殖民者信仰"虚空之灵"，认为宇宙本身有意识',
      ],
      dailyLife: '中央星港的居民享受着最先进的科技便利，花园星球的殖民者过着田园般的生活，而矿星与边远空间站的居民则在艰苦中挣扎。贫富差距在星际尺度上被进一步放大。',
      taboos: [
        'AI人权：公开讨论AI是否应拥有公民权是敏感话题',
        '基因改造：未经批准的人类基因改造是联邦重罪',
        '接触禁令：私自接触联邦指定的"隔离区"外星文明将被严惩',
      ],
    },

    economy: {
      description: '{{worldName}}的经济以星际信用点为通用货币，由联邦中央银行发行。稀有矿物、超光速引擎零部件与外星科技是最有价值的商品。',
      currency: {
        name: '信用点',
        symbol: '₵',
        description: '纯电子货币，通过个人终端进行交易，现金已基本淘汰',
      },
      priceLevel: '基础生活品价格稳定，但星际旅行费用昂贵。军用装备与外星科技制品价值连城。',
    },

    rules: {
      powerSystem: '科技与生物能力并存。人类依赖能量武器、动力装甲与超光速飞船。部分外星种族拥有心灵感应、生物操控等先天能力。基因改造者则拥有超越常人的体能。',
      socialStructure: '联邦议会制，各成员星球拥有自治权。企业拥有巨大影响力，部分超级企业的实力甚至超过单个星球。外星种族在联邦中有一定席位但话语权有限。',
      specialRules: [
        '星际法：联邦法律适用于所有成员星球，但各星球可制定补充法规',
        '企业豁免权：超级企业在特定领域拥有执法权与司法豁免权',
        '隔离区政策：联邦将部分外星文明活动区域划为隔离区，严禁私自接触',
      ],
    },
  },

  modules: {
    enabledModules: ['stat', 'progression', 'survival', 'dice'],
    moduleConfigs: {
      stat: {
        name: '特工档案',
        description: '星际特工的综合能力评估',
        moduleConfig: {
          attrA: { name: '生命值', max: 100 },
          attrB: { name: '能量护盾', max: 100 },
          dim1: { name: '体能', range: [0, 100] },
          dim2: { name: '射击', range: [0, 100] },
          dim3: { name: '黑客', range: [0, 100] },
          dim4: { name: '交涉', range: [0, 100] },
          dim5: { name: '侦查', range: [0, 100] },
          dim6: { name: '工程', range: [0, 100] },
          special: [
            { id: 'implant_sync', name: '植入体同步率', value: 0, range: [0, 100], description: '与机械植入体的融合程度' },
          ],
        },
        initialState: {
          attrA: 80, attrB: 60,
          dim1Value: 40, dim2Value: 40, dim3Value: 40,
          dim4Value: 40, dim5Value: 40, dim6Value: 40,
        },
      },
      progression: {
        name: '特工等级',
        description: '通过完成任务获取经验，逐步提升特工等级',
        moduleConfig: {
          mode: 'tiered',
          tiers: [
            { name: '见习特工', description: '刚通过选拔的新手，只能执行低风险任务。', xpRequired: 0 },
            { name: '正式特工', description: '拥有独立执行任务的资格。', xpRequired: 300 },
            { name: '精英特工', description: '经验丰富，可执行高难度渗透任务。', xpRequired: 800 },
            { name: '王牌特工', description: '联邦情报部门的顶尖人才。', xpRequired: 2000 },
            { name: '传奇特工', description: '改写过星际历史的传说级人物。', xpRequired: 6000 },
          ],
          xpFormula: { baseXP: 150, exponent: 1.7, scaleFactor: 1.0 },
          currentTierIndex: 0,
          currentXP: 0,
        },
      },
      survival: {
        name: '生存资源',
        description: '在太空环境中维持生存所需的关键资源',
        moduleConfig: {
          resources: [
            { id: 'oxygen', name: '氧气', icon: '💨', description: '太空行走与密闭空间生存的必需品', maxAmount: 10 },
            { id: 'energy', name: '能量电池', icon: '🔋', description: '动力装甲与武器的能源', maxAmount: 8 },
            { id: 'medkit', name: '医疗包', icon: '💊', description: '战场急救与伤势处理', maxAmount: 5 },
          ],
          rules: { cycleName: '任务', consumePerCycle: '每次任务消耗基础资源', criticalThreshold: 2 },
        },
        initialState: {
          resources: {
            oxygen: { current: 8, max: 10 },
            energy: { current: 6, max: 8 },
            medkit: { current: 3, max: 5 },
          },
        },
      },
      dice: {
        name: '任务检定',
        description: '执行任务时的各种判定',
        moduleConfig: { maxHistory: 10, defaultDC: 12 },
        initialState: { history: [] },
      },
    },
  },

  narrativeStyle: {
    tone: '硬朗科幻与太空歌剧交织',
    pacing: '快节奏，任务驱动',
    contentWarnings: ['太空战斗', '科技暴力'],
  },
};
