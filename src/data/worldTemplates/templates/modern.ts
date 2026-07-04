// ============================================================
//  现代世界模板 — 都市 / 悬疑 / 校园
// ============================================================

import type { WorldTemplate } from '../types';

export const modernTemplate: WorldTemplate = {
  id: 'genre_modern',
  name: '现代都市',
  description: '现代社会背景下的都市悬疑、校园生活或职场故事。',
  category: 'modern',
  tags: ['现代', '都市', '悬疑', '日常'],
  icon: 'Building2',
  coverColor: '#37474f',

  variables: [
    {
      key: 'worldName',
      label: '城市名称',
      type: 'text',
      required: true,
      defaultValue: '临海市',
      placeholder: '如：临海市、星城、海东市',
      affects: ['全局'],
    },
    {
      key: 'settingType',
      label: '场景类型',
      type: 'select',
      required: true,
      defaultValue: 'urban_mystery',
      options: [
        { value: 'urban_mystery', label: '都市悬疑 — 罪案与推理' },
        { value: 'campus', label: '校园青春 — 友情与成长' },
        { value: 'workplace', label: '职场风云 — 商战与人性' },
        { value: 'supernatural', label: '都市异能 — 隐藏的超自然力量' },
      ],
      affects: ['世界观', '势力', 'NPC'],
    },
    {
      key: 'tone',
      label: '故事基调',
      type: 'select',
      required: true,
      defaultValue: 'serious',
      options: [
        { value: 'serious', label: '严肃写实 — 接近现实的沉重叙事' },
        { value: 'light', label: '轻松日常 — 温馨治愈的生活流' },
        { value: 'thriller', label: '紧张刺激 — 悬疑惊悚的节奏' },
      ],
      affects: ['叙事风格', '事件'],
    },
    {
      key: 'coreConflict',
      label: '核心冲突',
      type: 'select',
      required: true,
      defaultValue: 'mystery',
      options: [
        { value: 'mystery', label: '悬案追查 — 真相隐藏在迷雾中' },
        { value: 'conspiracy', label: '阴谋揭露 — 平静表面下的暗流' },
        { value: 'survival', label: '生存挑战 — 在城市丛林中求生' },
        { value: 'relationship', label: '情感纠葛 — 人与人之间的复杂关系' },
      ],
      affects: ['事件', 'NPC动机'],
    },
  ],

  scaffold: {
    oneLiner: '{{worldName}}——霓虹灯下的秘密，每一个角落都藏着不为人知的故事。',
    overview: `【世界背景】
{{worldName}}是一座拥有数百万人口的现代化都市。高楼大厦与老旧街区并存，繁华的商业中心背后是错综复杂的利益网络。这座城市表面上光鲜亮丽，但在霓虹灯照不到的角落，罪恶与秘密如同暗流般涌动。

{{coreConflictDesc}}

在这座城市里，每个人都有自己的故事——警察在追查真相，记者在挖掘新闻，商人在博弈利益，而普通人则在日常的琐碎中寻找生活的意义。一个看似普通的事件，往往牵扯出令人意想不到的连锁反应。

【时间】现代（当代）
【地点】{{worldName}}
【氛围】{{toneDesc}}`,

    worldScale: 'small',
    timePeriod: '现代（当代）',
    coreConflict: '{{coreConflictDesc}}',
    tags: ['现代', '都市', '{{settingTag}}', '{{toneTag}}'],
    icon: 'Building2',
    coverColor: '#37474f',
    difficulty: 'easy',
  },

  dimensions: {
    geography: {
      locations: [
        {
          name: '市中心商务区',
          description: '{{worldName}}的经济心脏，摩天大楼林立，各大企业总部汇聚于此。白天是西装革履的白领世界，夜晚则变成灯红酒绿的不夜城。',
          features: ['摩天大楼群', '高端商场', '酒吧街', '地铁枢纽'],
          atmosphere: '繁华而冷漠，金钱与权力的气息弥漫',
        },
        {
          name: '老城区',
          description: '城市最早开发的区域，建筑老旧但充满生活气息。小巷中隐藏着各种小店与美食摊位，邻里之间关系密切。',
          features: ['老式居民楼', '街边小吃', '社区公园', '老店铺'],
          atmosphere: '温暖而嘈杂，充满市井烟火气',
        },
        {
          name: '大学城',
          description: '{{worldName}}的文教区，聚集了数所高校。年轻人的活力与理想主义在此碰撞，也是各种新思潮的发源地。',
          features: ['大学校园', '学生公寓', '咖啡馆', '图书馆'],
          atmosphere: '青春洋溢，充满理想与躁动',
        },
        {
          name: '港口工业区',
          description: '城市的工业命脉，巨大的港口每天吞吐着无数货物。工厂、仓库与集装箱码头构成了灰色的钢铁森林。',
          features: ['集装箱码头', '废弃工厂', '工人宿舍', '物流中心'],
          atmosphere: '粗犷而压抑，是城市光鲜外表的另一面',
        },
      ],
    },

    factions: {
      factions: [
        {
          name: '市公安局',
          description: '{{worldName}}的执法机构，负责维护社会治安与打击犯罪。刑警队是其中最精锐的部门。',
          alignment: '友善',
          headquarters: '市公安局大楼',
          philosophy: '以法律为准绳，守护市民安全',
          strength: '拥有完整的执法体系与刑侦技术',
        },
        {
          name: '海天集团',
          description: '{{worldName}}最大的民营企业，业务涵盖房地产、金融与科技。创始人是城市首富，但集团的发家史充满争议。',
          alignment: '中立',
          headquarters: '海天大厦（市中心最高建筑）',
          philosophy: '商业利益至上，用资本改变城市',
          strength: '雄厚的财力与广泛的人脉网络',
        },
        {
          name: '地下势力',
          description: '暗中操控城市灰色地带的各种势力，包括赌场、高利贷与非法交易。首领身份成谜。',
          alignment: '敌对',
          headquarters: '未知（分散在城市各处）',
          philosophy: '在规则的缝隙中谋取利益',
          strength: '信息网络庞大，渗透城市各个角落',
        },
        {
          name: '新闻媒体',
          description: '{{worldName}}的各大媒体机构，包括传统报社与新媒体平台。记者们在真相与利益之间艰难抉择。',
          alignment: '中立',
          headquarters: '各媒体总部',
          philosophy: '追求真相，但真相有时是危险的',
          strength: '舆论影响力巨大，可成就也可毁灭一个人',
        },
      ],
    },

    npcs: {
      npcs: [
        {
          name: '陈浩然',
          role: '刑警队长',
          description: '{{worldName}}刑警队的灵魂人物，破案率极高的老刑警。外表粗犷但心思缜密。',
          personality: '正义感强烈，不善言辞但对案件有着近乎偏执的执着',
          appearance: '国字脸，短发，总是穿着一件洗得发白的夹克',
          background: '从警二十年，亲手破获多起大案，但也因此失去了家庭',
          motivation: '让每一个受害者都得到正义',
        },
        {
          name: '林思琪',
          role: '调查记者',
          description: '《{{worldName}}日报》的王牌调查记者，以深度报道闻名。她正在追踪一个可能撼动整个城市的真相。',
          personality: '聪明敏锐，有着不服输的倔强，但内心善良',
          appearance: '马尾辫，戴着黑框眼镜，随身携带录音笔',
          background: '新闻系高材生，入职后一直坚持做深度调查报道',
          motivation: '揭露真相，让公众知道被掩盖的事实',
        },
        {
          name: '赵天成',
          role: '海天集团总裁',
          description: '{{worldName}}首富，海天集团的掌舵人。表面上是成功的企业家，背后却有着不为人知的秘密。',
          personality: '儒雅从容，善于伪装，每一步都经过精密计算',
          appearance: '西装革履，保养得当，永远挂着得体的微笑',
          background: '白手起家，从一个小商贩成长为商业帝国的掌门人',
          motivation: '维护自己的商业帝国，保护不被揭露的过去',
        },
        {
          name: '小七',
          role: '街头混混/线人',
          description: '老城区的街头混混，但实际上是警方与地下势力的双面线人。在两个世界之间游走求生。',
          personality: '油嘴滑舌，看似不靠谱但关键时刻靠得住',
          appearance: '瘦小灵活，穿着嘻哈风格的衣服，总是嚼着口香糖',
          background: '孤儿出身，在街头长大，靠聪明活到现在',
          motivation: '活下去，找到属于自己的位置',
        },
      ],
    },

    events: {
      events: [
        {
          name: '重大案件',
          description: '一桩离奇的命案打破了{{worldName}}的平静，受害者身份特殊，案件背后可能牵扯到城市顶层的权力结构。',
          trigger: '剧情开始触发',
          significance: 'major',
        },
        {
          name: '媒体风暴',
          description: '一篇爆炸性的调查报道引发全城关注，舆论压力迫使各方势力做出反应。',
          trigger: '剧情推进触发',
          significance: 'major',
        },
        {
          name: '商业峰会',
          description: '{{worldName}}年度商业峰会，各路企业家齐聚一堂。表面是商务交流，暗地里是利益交换的舞台。',
          trigger: '年度事件',
          significance: 'minor',
        },
        {
          name: '城市庆典',
          description: '{{worldName}}建城周年庆典，全城放假庆祝。但在欢乐的表象下，有人正在密谋行动。',
          trigger: '年度事件',
          significance: 'minor',
        },
      ],
    },

    culture: {
      description: '{{worldName}}的文化是传统与现代的融合。老一辈保持着传统的生活方式，年轻人则追逐潮流与新鲜事物。城市的文化生活丰富多彩，但也暗藏着精神空虚与价值观冲突。',
      customs: [
        '早茶文化：{{worldName}}人热爱早茶，周末的茶楼是社交的重要场所',
        '夜市文化：夜幕降临后，各种小吃摊位点亮了城市的另一面',
        '邻里互助：老城区的居民保持着互帮互助的传统',
      ],
      beliefs: [
        '务实主义：{{worldName}}人普遍务实，相信努力工作能改变命运',
        '关系网络：人脉在城市中至关重要，"认识人"是解决问题的万能钥匙',
        '低调哲学：闷声发大财是许多成功人士的座右铭',
      ],
      dailyLife: '上班族每天挤地铁往返于家与公司之间，学生在校园中度过青春岁月，退休老人在公园中锻炼聊天。城市的生活节奏快而规律，但偶尔的意外事件会打破这种平衡。',
      taboos: [
        '不要轻易相信陌生人',
        '不要在深夜独自前往偏僻地区',
        '不要随意打探他人的隐私',
      ],
    },

    economy: {
      description: '{{worldName}}的经济以人民币为货币，房地产、金融与科技是支柱产业。城市的消费水平较高，但贫富差距明显。',
      currency: {
        name: '人民币',
        symbol: '¥',
        description: '中国法定货币，电子支付极为普及',
      },
      priceLevel: '普通白领月薪5000-15000元，市中心房价每平米3-8万元，一顿普通快餐15-30元。',
    },

    rules: {
      powerSystem: '现实社会规则。没有超自然力量（除非选择都市异能设定）。权力来自金钱、人脉、知识与体力。',
      socialStructure: '现代社会的阶层结构。公务员、企业高管、白领、蓝领、自由职业者等构成复杂的社会网络。',
      specialRules: [
        '法律体系：完善的法律制度，但执行中存在灰色地带',
        '媒体监督：新闻媒体对社会事件有重要影响力',
        '社交规则：人际关系是城市生活的隐形规则',
      ],
    },
  },

  modules: {
    enabledModules: ['stat', 'dice'],
    moduleConfigs: {
      stat: {
        name: '人物档案',
        description: '衡量角色综合素质的数值体系',
        moduleConfig: {
          attrA: { name: '体力', max: 100 },
          attrB: { name: '精力', max: 100 },
          dim1: { name: '力量', range: [0, 20] },
          dim2: { name: '敏捷', range: [0, 20] },
          dim3: { name: '智力', range: [0, 20] },
          dim4: { name: '洞察', range: [0, 20] },
          dim5: { name: '魅力', range: [0, 20] },
          dim6: { name: '意志', range: [0, 20] },
          special: [],
        },
        initialState: {
          attrA: 80, attrB: 70,
          dim1Value: 10, dim2Value: 10, dim3Value: 12,
          dim4Value: 12, dim5Value: 10, dim6Value: 10,
        },
      },
      dice: {
        name: '事件检定',
        description: '面对突发状况时的能力判定',
        moduleConfig: { maxHistory: 10, defaultDC: 10 },
        initialState: { history: [] },
      },
    },
  },

  narrativeStyle: {
    tone: '{{toneStyle}}',
    pacing: '根据剧情需要灵活调整',
    contentWarnings: ['犯罪描写', '社会问题'],
  },
};
