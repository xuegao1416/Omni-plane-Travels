// ============================================================
//  历史世界模板 — 三国/唐朝/维多利亚时代
// ============================================================

import type { WorldTemplate } from '../types';

export const historicalTemplate: WorldTemplate = {
  id: 'genre_historical',
  name: '历史架空',
  description: '以真实历史为蓝本的架空世界，三国、唐朝、维多利亚时代等经典背景。',
  category: 'historical',
  tags: ['历史', '架空', '权谋', '战争'],
  icon: 'Crown',
  coverColor: '#bf360c',

  variables: [
    {
      key: 'worldName',
      label: '天下/国家名称',
      type: 'text',
      required: true,
      defaultValue: '中原',
      placeholder: '如：中原、大不列颠、罗马帝国',
      affects: ['全局'],
    },
    {
      key: 'era',
      label: '历史背景',
      type: 'select',
      required: true,
      defaultValue: 'three_kingdoms',
      options: [
        { value: 'three_kingdoms', label: '三国乱世 — 群雄逐鹿，智谋为王' },
        { value: 'tang_dynasty', label: '盛唐气象 — 万国来朝，诗酒风流' },
        { value: 'victorian', label: '维多利亚时代 — 工业革命，帝国扩张' },
        { value: 'warring_states', label: '战国纷争 — 百家争鸣，变法图强' },
        { value: 'renaissance', label: '文艺复兴 — 艺术与科学的觉醒' },
      ],
      affects: ['世界观', '文化', '势力'],
    },
    {
      key: 'coreConflict',
      label: '核心冲突',
      type: 'select',
      required: true,
      defaultValue: 'throne',
      options: [
        { value: 'throne', label: '皇位争夺 — 谁能问鼎天下' },
        { value: 'reform', label: '变法维新 — 守旧与革新的对决' },
        { value: 'invasion', label: '外敌入侵 — 民族存亡的关头' },
        { value: 'rebellion', label: '农民起义 — 揭竿而起的怒火' },
        { value: 'succession', label: '权力交接 — 老王驾崩后的暗流' },
      ],
      affects: ['事件', '势力关系'],
    },
    {
      key: 'protagonistRole',
      label: '主角身份',
      type: 'select',
      required: true,
      defaultValue: 'strategist',
      options: [
        { value: 'strategist', label: '谋士 — 运筹帷幄之中' },
        { value: 'general', label: '武将 — 驰骋疆场之上' },
        { value: 'merchant', label: '商人 — 富可敌国的幕后操盘手' },
        { value: 'noble', label: '贵族 — 身处权力漩涡中心' },
        { value: 'commoner', label: '平民 — 从底层崛起的英雄' },
      ],
      affects: ['NPC关系', '初始状态'],
    },
  ],

  scaffold: {
    oneLiner: '{{worldName}}——{{eraName}}的风云变幻，英雄与时势的碰撞在此上演。',
    overview: `【世界背景】
{{worldName}}正处于{{eraName}}的动荡时期。{{eraDesc}}在这个礼崩乐坏、群雄并起的时代，智谋与武力是生存的根本，忠诚与背叛只在一念之间。

{{coreConflictDesc}}

朝堂之上，权臣弄政、外戚干政；江湖之远，百姓流离、义军四起。在这片风云变幻的{{worldName}}大地上，每一个人都在时代的洪流中寻找自己的位置——有人追逐权力，有人守护信念，有人只求苟全性命于乱世。

【时代】{{eraName}}
【地点】{{worldName}}大地
【氛围】肃杀、苍凉、壮志豪情、权谋暗涌`,

    worldScale: 'large',
    timePeriod: '{{eraName}}',
    coreConflict: '{{coreConflictDesc}}',
    tags: ['历史', '架空', '{{eraTag}}', '{{conflictTag}}'],
    icon: 'Crown',
    coverColor: '#bf360c',
    difficulty: 'hard',
  },

  dimensions: {
    geography: {
      locations: [
        {
          name: '帝都',
          description: '{{worldName}}的政治中心，皇宫巍峨壮丽，百官云集。帝都分为内城（皇城与官署）和外城（商业区与民居），是天下权力的象征。',
          features: ['皇宫大内', '朝堂', '市集', '城门关隘'],
          atmosphere: '庄严肃穆，暗藏杀机',
        },
        {
          name: '边关要塞',
          description: '抵御外敌的第一道防线，常年驻扎重兵。边关将士浴血奋战，是{{worldName}}最危险也最光荣的地方。',
          features: ['城墙堡垒', '军营', '烽火台', '边市'],
          atmosphere: '苍凉悲壮，战鼓声声',
        },
        {
          name: '江南水乡',
          description: '{{worldName}}最富庶的地区，鱼米之乡，文人墨客辈出。但富庶也引来了贪婪的目光。',
          features: ['水乡古镇', '丝绸工坊', '书院', '盐商宅院'],
          atmosphere: '温婉秀美，但暗流涌动',
        },
        {
          name: '西域商路',
          description: '连接{{worldName}}与外部世界的贸易大动脉，商旅往来不绝，但马贼与沙匪也在此横行。',
          features: ['驿站', '绿洲城镇', '沙漠', '商队'],
          atmosphere: '苍茫辽阔，机遇与危险并存',
        },
      ],
    },

    factions: {
      factions: [
        {
          name: '朝廷',
          description: '{{worldName}}的正统政权，名义上统治天下。但皇帝年幼/昏庸，实权被权臣/外戚/宦官把持。',
          alignment: '中立',
          headquarters: '帝都皇宫',
          philosophy: '维护正统，延续国祚',
          strength: '拥有正规军与官僚体系，但内部腐败严重',
        },
        {
          name: '割据诸侯',
          description: '各拥重兵、据地自雄的地方势力。他们名义上臣服朝廷，实际上各行其是，伺机扩张。',
          alignment: '中立',
          headquarters: '各自的领地',
          philosophy: '扩充实力，等待时机',
          strength: '各拥精兵数万，占据要地',
        },
        {
          name: '世家大族',
          description: '传承数百年的名门望族，掌握着巨大的经济与文化资源。他们通过联姻与门生关系编织着庞大的权力网络。',
          alignment: '中立',
          headquarters: '各地祖宅',
          philosophy: '家族利益高于一切',
          strength: '经济实力雄厚，门生故吏遍天下',
        },
        {
          name: '江湖势力',
          description: '游离于朝廷之外的民间力量，包括绿林好汉、游侠剑客与秘密结社。他们或劫富济贫，或图谋大事。',
          alignment: '中立',
          headquarters: '分散各地',
          philosophy: '替天行道/各怀目的',
          strength: '人数众多但组织松散',
        },
      ],
    },

    npcs: {
      npcs: [
        {
          name: '诸葛星',
          role: '隐世谋士',
          description: '传说中得其者可得天下的旷世奇才，隐居山林等待明主。',
          personality: '睿智深沉，淡泊名利，但胸中自有百万雄兵',
          appearance: '羽扇纶巾，面如冠玉，目若朗星',
          background: '出身世家，师从隐世高人，学贯百家',
          motivation: '辅佐明主，结束乱世，还天下太平',
        },
        {
          name: '赵云龙',
          role: '忠义武将',
          description: '万军之中取上将首级如探囊取物的绝世猛将，以忠义闻名天下。',
          personality: '忠勇无双，重情重义，沉默寡言',
          appearance: '身长八尺，浓眉大眼，银甲白马',
          background: '出身行伍，凭军功一路晋升',
          motivation: '追随明主，保境安民',
        },
        {
          name: '柳如烟',
          role: '情报头子',
          description: '掌握着天下情报网络的神秘女子，以歌舞坊为掩护，暗中操控着许多事件的走向。',
          personality: '风情万种，心思缜密，亦正亦邪',
          appearance: '绝世容颜，善舞，衣着华贵',
          background: '前朝遗孤，为复仇建立了庞大的情报网',
          motivation: '复仇/寻找真相',
        },
        {
          name: '铁面判官',
          role: '清廉御史',
          description: '朝廷中少数清廉正直的官员，以铁面无私著称，但也因此树敌无数。',
          personality: '刚正不阿，嫉恶如仇，不近人情',
          appearance: '面色严肃，不苟言笑，官服整洁',
          background: '寒门出身，科举入仕',
          motivation: '肃清吏治，还天下一个朗朗乾坤',
        },
      ],
    },

    events: {
      events: [
        {
          name: '群雄会盟',
          description: '各路诸侯借某件大事齐聚一堂，表面上是共商国是，实际上是试探与博弈的舞台。',
          trigger: '剧情触发',
          significance: 'major',
        },
        {
          name: '边关告急',
          description: '外敌大举入侵，边关烽火连天。朝廷面临是战是和的艰难抉择。',
          trigger: '剧情推进',
          significance: 'major',
        },
        {
          name: '科举大比',
          description: '三年一度的科举考试，天下英才齐聚帝都。这不仅是选拔人才的盛会，更是各方势力拉拢新秀的战场。',
          trigger: '每三年一次',
          significance: 'minor',
        },
        {
          name: '宫廷政变',
          description: '朝堂上的权力斗争终于爆发，一场惊心动魄的宫廷政变即将上演。',
          trigger: '剧情高潮',
          significance: 'major',
        },
      ],
    },

    culture: {
      description: '{{worldName}}的文化以儒家思想（或对应时代的主流思想）为核心，讲究礼义廉耻、忠孝节义。但乱世之中，理想与现实的冲突无处不在。',
      customs: [
        '科举取士：通过考试选拔人才，是寒门子弟改变命运的唯一正途',
        '门第观念：世家大族与寒门之间的鸿沟难以逾越',
        '忠义精神：忠臣不事二主，义气是江湖中人的行为准则',
      ],
      beliefs: [
        '天命观：王朝兴衰皆有天命，但英雄可以逆天改命',
        '儒家伦理：仁义礼智信是为人处世的根本',
        '实用主义：乱世之中，生存压过一切道德教条',
      ],
      dailyLife: '士大夫吟诗作对、纵论天下；武将操练兵马、征战四方；百姓耕田织布、艰难求生。战乱年代，普通人最大的愿望不过是太平安宁。',
      taboos: [
        '谋逆：意图推翻朝廷是诛九族的大罪',
        '辱没门风：世家子弟的行为代表家族颜面',
        '卖国求荣：勾结外敌是天下人的公敌',
      ],
    },

    economy: {
      description: '{{worldName}}的经济以农业为基础，商业在重农抑商的政策下艰难发展。战乱导致通货膨胀，粮食比金银更珍贵。',
      currency: {
        name: '铜钱/银两',
        symbol: '两',
        description: '铜钱用于日常交易，银两用于大宗买卖，金锭极为稀有',
      },
      priceLevel: '一两银子可让普通三口之家生活一个月。一把好刀需十两，一匹战马百两，一座宅院千两以上。',
    },

    rules: {
      powerSystem: '武力与智谋并重。武将通过修炼武艺提升战斗力，谋士通过学习兵法韬略增强影响力。个人武力可以百人敌，但千军万马面前仍需依靠兵法与阵型。',
      socialStructure: '皇权→官僚→士族→平民→奴婢的严格等级制。科举制度为寒门提供了上升通道，但世家大族仍垄断着大量资源。',
      specialRules: [
        '朝堂博弈：政治斗争通过弹劾、结党、联姻等方式进行',
        '战场规则：大规模战役需考虑粮草、地形、士气等因素',
        '江湖规矩：绿林道有自己的行为准则，背信弃义者将被天下人唾弃',
      ],
    },
  },

  modules: {
    enabledModules: ['stat', 'progression', 'dice'],
    moduleConfigs: {
      stat: {
        name: '人物属性',
        description: '衡量角色文韬武略的数值体系',
        moduleConfig: {
          attrA: { name: '体力', max: 100 },
          attrB: { name: '气力', max: 100 },
          dim1: { name: '武力', range: [0, 100] },
          dim2: { name: '统率', range: [0, 100] },
          dim3: { name: '智力', range: [0, 100] },
          dim4: { name: '政治', range: [0, 100] },
          dim5: { name: '魅力', range: [0, 100] },
          dim6: { name: '幸运', range: [0, 100] },
          special: [
            { id: 'reputation', name: '名望', value: 0, range: [0, 100], description: '在天下人心中的声望' },
            { id: 'loyalty', name: '忠诚度', value: 50, range: [0, 100], description: '部下对你的忠诚程度' },
          ],
        },
        initialState: {
          attrA: 80, attrB: 60,
          dim1Value: 30, dim2Value: 30, dim3Value: 40,
          dim4Value: 30, dim5Value: 35, dim6Value: 30,
        },
      },
      progression: {
        name: '官职/爵位',
        description: '通过功绩与声望提升社会地位',
        moduleConfig: {
          mode: 'tiered',
          tiers: [
            { name: '白身', description: '无官无职的普通人。', xpRequired: 0 },
            { name: '县令/校尉', description: '基层官吏或低级军官。', xpRequired: 150 },
            { name: '郡守/将军', description: '独当一面的地方大员或领兵将领。', xpRequired: 500 },
            { name: '州牧/大将军', description: '掌握一州军政大权的封疆大吏。', xpRequired: 1500 },
            { name: '丞相/王爵', description: '一人之下万人之上的权臣或裂土封王。', xpRequired: 4000 },
            { name: '开国之君', description: '终结乱世、开创王朝的千古一帝。', xpRequired: 10000 },
          ],
          xpFormula: { baseXP: 100, exponent: 1.9, scaleFactor: 1.0 },
          currentTierIndex: 0,
          currentXP: 0,
        },
      },
      dice: {
        name: '命运检定',
        description: '在关键时刻掷出命运的骰子',
        moduleConfig: { maxHistory: 10, defaultDC: 10 },
        initialState: { history: [] },
      },
    },
  },

  narrativeStyle: {
    tone: '苍凉壮阔，带有古典文学的韵味',
    pacing: '慢热，注重谋略与人物刻画',
    contentWarnings: ['战争场面', '权谋算计', '历史暴力'],
  },
};
