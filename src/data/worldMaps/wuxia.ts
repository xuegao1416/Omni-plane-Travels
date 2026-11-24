/**
 * 武侠世界 · 九霄山河图。照真实的山川形势排（经纬度投影到画布）：
 * 黄河出河套、过潼关、经洛阳北，长江穿三峡、过岳阳与九江、到金陵入海；
 * 洛阳与嵩山少林居中原，华山、终南山在渭水之南的秦岭北麓，太行之上是飞云绝顶，泰山上是沧浪峰；
 * 岳阳望江楼临洞庭，庐山白莲庵在鄱阳湖畔，峨眉一带是碧落峰，赤水河边是赤霞山；
 * 长城以北是北疆群山（玄冥谷）与塞外大漠（沙城），南海深处一座孤岛。
 */
import type { MapFeature, MapModuleSchema } from '../../domains/map/types';
import { along, area, blob, border, label, land, river, water, wobble, type P } from './draw';

/** 经纬度 → 画布（东经 92°~126°、北纬 45°~17°）。 */
const geo = (lon: number, lat: number): P => [Math.round((lon - 92) * 29.4 * 10) / 10, Math.round((45 - lat) * 25 * 10) / 10];
const line = (points: Array<[number, number]>): P[] => points.map(([lon, lat]) => geo(lon, lat));

export function buildWuxiaMap(): MapModuleSchema {
  const features: MapFeature[] = [];

  // ── 海岸线：渤海、山东半岛、长江口、杭州湾、东南沿海、珠江口、雷州 ──
  const coast = line([
    [126, 39.8], [123, 39.6], [121.2, 38.9], [121.8, 40.3], [121.0, 40.9], [119.5, 39.9], [118.0, 39.2], [117.6, 38.6], [118.6, 37.6], [119.3, 37.1],
    [120.7, 37.8], [122.5, 37.4], [121.0, 36.6], [119.9, 35.8], [119.2, 34.8], [120.3, 34.0], [120.9, 32.5], [121.9, 31.7], [121.9, 30.9], [121.0, 30.4],
    [122.1, 29.9], [121.6, 28.5], [120.6, 27.6], [119.6, 26.4], [118.9, 25.1], [117.9, 24.4], [116.6, 23.3], [114.5, 22.5], [113.6, 22.3], [112.6, 21.8],
    [111.0, 21.4], [110.2, 20.3], [109.7, 21.4], [108.5, 21.7], [107.5, 21.5], [106.5, 20.2], [106.0, 19.0], [105.8, 16.6],
  ]);
  const continent: P[] = [[-30, 730], [-30, -30], [1030, -30], ...wobble(coast, 3.2, 7703, 9), [-30, 730]];
  features.push(land(continent));
  features.push(land(blob(...geo(109.7, 19.2), 27, 15, 7710, 0.16, 32, -0.15)));
  features.push(land(blob(...geo(121.0, 23.7), 11, 37, 7711, 0.14, 30, 0.32)));
  features.push(land(blob(...geo(122.2, 30.1), 6, 4, 7712, 0.2, 16)));
  // 南海孤岛与几处礁屿
  const isle = blob(660, 662, 16, 11, 7713, 0.22, 28, 0.4);
  features.push(land(isle), land(blob(694, 642, 4, 3, 7714, 0.3, 12)), land(blob(632, 682, 3.5, 2.5, 7715, 0.3, 12)));

  // ── 湖泊 ──
  const dongting = wobble(blob(612, 401, 21, 12, 7720, 0.24, 26, 0.2), 1.2, 7721, 6, true);
  features.push(water(dongting, 'lake'), land(blob(606, 399, 4.2, 3, 7722, 0.2, 14), 'island'));
  features.push(water(blob(724, 404, 7, 13, 7723, 0.28, 22, 0.2), 'lake'), water(blob(829, 345, 9, 7, 7724, 0.22, 22), 'lake'), water(blob(...geo(100.2, 36.9), 13, 7, 7725, 0.2, 22), 'lake'));

  // ── 山脉、高原、沙漠（抬高地形，古卷上自动画出山峦与沙丘）──
  const plateau = wobble([[-30, 225], [90, 232], [190, 250], [262, 262], [312, 300], [326, 350], [318, 400], [300, 450], [306, 520], [280, 600], [160, 640], [-30, 650]], 10, 7730, 16, true);
  features.push(area(plateau, 'mountains'));
  features.push(area(wobble([[84, 178], [180, 168], [272, 178], [338, 200], [328, 216], [250, 214], [170, 208], [96, 204]], 5, 7731, 12, true), 'mountains'));
  features.push(area(wobble([[372, 282], [430, 278], [500, 288], [560, 290], [612, 300], [606, 316], [540, 314], [470, 314], [400, 314], [366, 302]], 4, 7732, 10, true), 'mountains'));
  features.push(area(wobble([[612, 136], [640, 128], [652, 170], [650, 214], [640, 244], [622, 240], [618, 200], [606, 160]], 3, 7733, 9, true), 'mountains'));
  features.push(area(wobble([[452, 62], [560, 52], [680, 66], [780, 80], [800, 98], [700, 104], [600, 96], [500, 92], [446, 82]], 5, 7734, 12, true), 'mountains'));
  features.push(area(blob(624, 280, 13, 8, 7735, 0.2, 18), 'hills'), area(blob(738, 221, 12, 8, 7736, 0.2, 18), 'mountains'));
  features.push(area(blob(697, 384, 8, 7, 7737, 0.2, 16), 'mountains'));
  features.push(area(wobble([[330, 372], [372, 372], [420, 360], [470, 350], [530, 336], [560, 344], [520, 360], [470, 372], [420, 384], [370, 396], [334, 396]], 4, 7738, 10, true), 'hills'));
  features.push(area(wobble([[470, 452], [560, 446], [660, 458], [740, 470], [780, 490], [720, 510], [640, 500], [560, 492], [480, 490]], 6, 7739, 12, true), 'hills'));
  features.push(area(wobble([[730, 420], [790, 410], [820, 440], [800, 476], [760, 470], [736, 446]], 4, 7740, 10, true), 'hills'));
  features.push(area(wobble([[-30, 40], [120, 30], [260, 44], [420, 70], [430, 120], [330, 150], [200, 150], [90, 140], [-30, 150]], 8, 7741, 14, true), 'desert'));
  features.push(area(wobble([[620, 250], [700, 232], [760, 232], [790, 270], [770, 312], [700, 320], [650, 300]], 5, 7742, 12, true), 'farmland'));
  features.push(area(wobble([[740, 320], [800, 312], [860, 322], [860, 372], [810, 390], [760, 378], [736, 350]], 4, 7743, 10, true), 'farmland'));
  features.push(area(wobble([[488, 470], [540, 466], [600, 476], [640, 470], [700, 480], [760, 488], [740, 508], [690, 520], [640, 506], [590, 500], [540, 506], [496, 494]], 7, 7744, 10, true), 'forest'));

  // ── 江河 ──
  features.push(river(wobble(line([
    [96.5, 34.8], [100, 35.5], [103.8, 36.1], [105.5, 37.5], [106.5, 39.2], [107.5, 40.6], [109.5, 40.6], [111.2, 40.2], [111.0, 38.5], [110.5, 36.5],
    [110.3, 35.5], [110.4, 34.6], [111.5, 34.8], [112.5, 34.9], [113.7, 34.9], [114.7, 34.9], [116.0, 35.6], [117.0, 36.6], [118.0, 37.3], [118.9, 37.7],
  ]), 2.4, 7750, 7), 3.4, '黄  河'));
  const yangtze = wobble(line([
    [97, 33], [100, 31], [103, 29.0], [106.5, 29.6], [108.5, 30.8], [110.5, 30.8], [111.5, 30.4], [112.5, 30.0], [113.1, 29.4], [114.3, 30.6],
    [115.5, 29.9], [116.3, 29.7], [117.2, 30.6], [118.4, 31.4], [118.8, 32.1], [119.8, 32.3], [121.0, 31.8], [121.8, 31.4],
  ]), 2.2, 7751, 7);
  features.push(river(yangtze, 4.2, '长  江'));
  features.push(river(wobble(line([[106.8, 33.1], [109, 32.7], [111.5, 32.4], [112.5, 31.4], [113.5, 30.8], [114.3, 30.6]]), 1.6, 7752, 7), 1.8, '汉水'));
  features.push(river(wobble(line([[104.5, 34.8], [106.5, 34.4], [108.0, 34.3], [109.5, 34.5], [110.3, 34.6]]), 1.2, 7753, 7), 1.6, '渭水'));
  features.push(river(wobble(line([[111, 26], [112.6, 27.3], [112.9, 28.2], [112.85, 28.9]]), 1.4, 7754, 7), 1.6, '湘江'));
  features.push(river(wobble(line([[105.5, 27.6], [105.8, 28.5], [106.2, 28.8], [106.3, 29.4]]), 1, 7755, 6), 1.5, '赤水'));
  features.push(river(wobble(line([[113.4, 31.8], [115.0, 32.6], [116.5, 32.9], [118.2, 33.2], [119.0, 33.3]]), 1.4, 7756, 7), 1.6, '淮水'));

  // ── 长城 ──
  features.push(border(wobble(line([[98.2, 39.8], [100.4, 38.9], [102.6, 37.9], [104.5, 37.6], [106.2, 38.3], [108.0, 38.0], [109.7, 38.3], [111.5, 39.4], [113.3, 40.1], [116.0, 40.35], [118.0, 40.2], [119.8, 40.0]]), 1.6, 7760, 8), 'wall', '长 城'));

  // ── 注记 ──
  features.push(
    label(930, 420, '东 海', 'water'), label(915, 250, '黄 海', 'water'), label(812, 152, '渤海', 'water'),
    label(612, 418, '洞庭', 'water'), label(258, 196, '祁 连 山', 'range'), label(466, 323, '秦 岭', 'range'), label(668, 182, '太行', 'range'),
    label(150, 420, '昆 仑', 'range'), label(612, 484, '南 岭', 'range'),
  );

  return {
    version: 1,
    title: '九霄山河图',
    theme: 'ancient',
    landform: 'continent',
    scale: 'world',
    metersPerUnit: 2600,
    seed: 77031,
    width: 1000,
    height: 700,
    fog: true,
    travel: { minutesPerUnit: 4.8 },
    startLocationId: 'jinling',
    regions: [
      { id: 'mobei', name: '塞外大漠', terrain: 'desert', x: 180, y: 110, radius: 170, danger: 4, color: '#8a6a1f', effects: [{ target: 'map.travel.time', mode: 'mult', value: 1.25, label: '风沙迷道' }], encounters: ['大漠马贼', '沙城刀客'], description: '长城以西的瀚海，西域商队与马贼的天下。' },
      { id: 'beijiang', name: '北疆群山', terrain: 'mountains', x: 580, y: 78, radius: 150, danger: 4, color: '#29507a', encounters: ['天道教巡山弟子'], description: '长城以北终年积雪的群山，天道教总坛藏在深处。' },
      { id: 'zhongyuan', name: '中原', terrain: 'farmland', x: 650, y: 245, radius: 150, danger: 1, color: '#8c2f1c', description: '黄河两岸的千里沃野，洛阳居天下之中。' },
      { id: 'zhongnan', name: '关中', terrain: 'plains', x: 500, y: 278, radius: 90, danger: 2, color: '#6b3f8a', description: '渭水两岸，北有华山之险，南有终南之幽。' },
      { id: 'bashu', name: '巴蜀', terrain: 'hills', x: 380, y: 400, radius: 110, danger: 2, color: '#4f6b26', encounters: ['蜀道剪径的强人'], description: '蜀道难，难于上青天；碧落、赤霞两派隐在群山之间。' },
      { id: 'lianghu', name: '两湖', terrain: 'plains', x: 640, y: 395, radius: 100, danger: 2, color: '#2f5d50', description: '八百里洞庭烟波浩渺，长江从岳阳城下流过。' },
      { id: 'jiangnan', name: '江南', terrain: 'plains', x: 790, y: 360, radius: 110, danger: 1, color: '#7a2f4f', description: '六朝古都金陵与太湖周边的鱼米之乡。' },
      { id: 'nanhai', name: '南海', terrain: 'sea', x: 660, y: 640, radius: 120, danger: 4, color: '#2a5470', encounters: ['四海四老座下'], description: '南海深处，天道教四海四老镇守的孤岛。' },
    ],
    locations: [
      { id: 'jinling', name: '金陵城', aliases: ['金陵', '秦淮河'], kind: 'capital', x: 786, y: 334, regionId: 'jiangnan', known: true, danger: 1, services: ['rest', 'trade', 'supply'], restPrice: 10, description: '六朝古都，江南第一城，秦淮河畔灯火通明；江湖与朝堂在此暗中角力。' },
      { id: 'qixia', name: '栖霞巷', kind: 'market', x: 810, y: 352, regionId: 'jiangnan', danger: 2, services: ['trade'], description: '金陵城内闹中取静的巷陌，灵枢阁旧部设下的暗桩，交易消息与武学残篇。' },
      { id: 'lingshu', name: '灵枢旧宅', kind: 'ruin', x: 762, y: 352, regionId: 'jiangnan', danger: 3, description: '金陵城中柳氏祖宅，当年秘藏《九霄剑经》，暗格重重、机关遍布。' },
      { id: 'luoyang', name: '洛阳城', aliases: ['洛阳', '白马寺', '龙门石窟'], kind: 'city', x: 601, y: 264, regionId: 'zhongyuan', danger: 1, services: ['rest', 'trade', 'supply'], restPrice: 8, description: '九朝古都，天下之中；白马寺高僧云集，龙门石窟传藏《易筋经》。' },
      { id: 'shaolin', name: '少林寺', aliases: ['嵩山', '少室山'], kind: 'temple', x: 632, y: 284, regionId: 'zhongyuan', danger: 2, services: ['train', 'rest', 'heal'], restPrice: 0, links: { events: [{ eventId: 'breakthrough', packId: 'world:wuxia_world:events' }] }, description: '嵩山少室山千年古刹，天下武学正宗，藏经阁内藏洗髓经、易筋经。' },
      { id: 'huashan', name: '华山', aliases: ['西岳', '华山之巅'], kind: 'landmark', x: 532, y: 274, regionId: 'zhongnan', danger: 4, links: { events: [{ eventId: 'duel', packId: 'world:wuxia_world:events' }] }, description: '西岳华山，天下第一险山，三十年一次的华山论剑在此举行。' },
      { id: 'zhongnan', name: '终南山', aliases: ['活死人墓', '问道阶'], kind: 'temple', x: 492, y: 292, regionId: 'zhongnan', danger: 2, services: ['heal', 'train'], restPrice: 0, links: { events: [{ eventId: 'secret_realm', packId: 'world:wuxia_world:events' }] }, description: '道家圣地，药王隐居于此；问道阶三千六百级，从未有人走完。' },
      { id: 'feiyun', name: '飞云绝顶', aliases: ['飞云派'], kind: 'landmark', x: 642, y: 196, regionId: 'zhongyuan', danger: 4, description: '太行之上万丈绝壁，岩壁刻有六派失传剑法，隐世高人独孤云在此潜修。' },
      { id: 'canglang', name: '沧浪峰', aliases: ['六派盟约'], kind: 'fortress', x: 740, y: 216, regionId: 'zhongyuan', danger: 3, description: '六派盟主司徒桓的驻地，楼阁森严如军事要塞，遍布沧浪派精锐。' },
      { id: 'yueyang', name: '望江楼', aliases: ['岳阳', '岳阳楼'], kind: 'landmark', x: 628, y: 386, regionId: 'lianghu', danger: 1, services: ['rest', 'trade'], restPrice: 6, description: '洞庭湖畔岳阳城中的酒楼，各路江湖客汇聚、交换消息之地。' },
      { id: 'junshan', name: '君山', kind: 'wild', x: 606, y: 399, regionId: 'lianghu', danger: 2, description: '洞庭湖中的小岛，住着一群与世无争的渔夫，传说藏着一位退隐的绝世高手。' },
      { id: 'bailian', name: '白莲庵', aliases: ['玄霜派', '庐山'], kind: 'temple', x: 696, y: 378, regionId: 'lianghu', danger: 1, services: ['heal', 'rest'], restPrice: 0, description: '玄霜派女尼的清修之地，门风清净，霜华剑法绵密凌厉。' },
      { id: 'biluo', name: '碧落峰', aliases: ['碧落派'], kind: 'landmark', x: 330, y: 392, regionId: 'bashu', danger: 3, description: '山势险峻如剑指苍穹，峰后竹林深处藏着镇派之宝碧落黄泉剑。' },
      { id: 'chixia', name: '赤霞山', aliases: ['赤霞派', '赤霞宫'], kind: 'landmark', x: 404, y: 428, regionId: 'bashu', danger: 3, description: '山体赤红，夕照如火云；山脚赤水河终年温热，弟子对着瀑布练刚猛掌法。' },
      { id: 'xuanming', name: '玄冥谷', aliases: ['天道教总坛'], kind: 'wild', x: 540, y: 84, regionId: 'beijiang', danger: 5, links: { events: [{ eventId: 'poison', packId: 'world:wuxia_world:events' }] }, description: '北疆群山深处终年不见天日的峡谷，天道教总坛，机关密布、毒瘴弥漫。' },
      { id: 'shacheng', name: '沙城', aliases: ['西域武林'], kind: 'city', x: 98, y: 142, regionId: 'mobei', danger: 3, services: ['rest', 'supply'], restPrice: 10, description: '大漠深处的西域武林中心，城主「大漠孤烟」刀法霸道绝伦。' },
      { id: 'mobei', name: '大漠流沙', aliases: ['塞外大漠'], kind: 'wild', x: 214, y: 104, regionId: 'mobei', danger: 4, description: '寸草不生的流沙地，商队与马贼都绕着走。' },
      { id: 'nanhai', name: '南海孤岛', aliases: ['石牢'], kind: 'wild', x: 660, y: 662, regionId: 'nanhai', danger: 5, description: '与世隔绝的荒岛，石牢壁上刻满殷九州以指力所书的吸元功心法。' },
    ],
    routes: [
      { id: 'w_jinling_qixia', from: 'jinling', to: 'qixia', kind: 'trail', name: '巷口', minutes: 30 },
      { id: 'w_jinling_lingshu', from: 'jinling', to: 'lingshu', kind: 'trail', name: '柳宅后巷', minutes: 30 },
      { id: 'w_lingshu_qixia', from: 'lingshu', to: 'qixia', kind: 'secret', name: '夹墙密道', hidden: true, danger: 2, minutes: 40, path: [[786, 356]] },
      { id: 'w_jinling_yueyang', from: 'jinling', to: 'yueyang', kind: 'river', name: '长江水路', danger: 2, cost: { currency: 8 }, path: along(yangtze, [786, 334], [628, 386], 30) },
      { id: 'w_jinling_bailian', from: 'jinling', to: 'bailian', kind: 'road', name: '江南驿道', path: [[752, 350], [722, 372]] },
      { id: 'w_yueyang_bailian', from: 'yueyang', to: 'bailian', kind: 'trail', name: '湖东小道', path: [[652, 378], [676, 384]] },
      { id: 'w_yueyang_junshan', from: 'yueyang', to: 'junshan', kind: 'river', name: '君山渡', minutes: 60 },
      { id: 'w_luoyang_shaolin', from: 'luoyang', to: 'shaolin', kind: 'road', name: '嵩山道' },
      { id: 'w_luoyang_huashan', from: 'luoyang', to: 'huashan', kind: 'mountain', name: '西岳险道', danger: 3, check: { stat: 'dim3', dc: 13 }, path: [[574, 266], [550, 270]] },
      { id: 'w_huashan_zhongnan', from: 'huashan', to: 'zhongnan', kind: 'trail', name: '秦岭北麓', danger: 2, path: [[512, 286]] },
      { id: 'w_luoyang_zhongnan', from: 'luoyang', to: 'zhongnan', kind: 'road', name: '函谷官道', path: [[572, 260], [540, 262], [512, 276]] },
      { id: 'w_luoyang_canglang', from: 'luoyang', to: 'canglang', kind: 'road', name: '汴洛大道', path: [[656, 256], [706, 236]] },
      { id: 'w_canglang_jinling', from: 'canglang', to: 'jinling', kind: 'road', name: '运河驿道', path: [[752, 256], [770, 296]] },
      { id: 'w_luoyang_jinling', from: 'luoyang', to: 'jinling', kind: 'road', name: '淮上官道', path: [[654, 282], [716, 300], [758, 322]] },
      { id: 'w_luoyang_yueyang', from: 'luoyang', to: 'yueyang', kind: 'road', name: '荆襄古道', path: [[598, 300], [590, 336], [606, 368]] },
      { id: 'w_luoyang_feiyun', from: 'luoyang', to: 'feiyun', kind: 'mountain', name: '太行陉道', danger: 3, check: { stat: 'dim3', dc: 15 }, path: [[620, 236]] },
      { id: 'w_feiyun_xuanming', from: 'feiyun', to: 'xuanming', kind: 'mountain', name: '雪岭险径', danger: 5, check: { stat: 'dim3', dc: 17 }, path: [[624, 150], [584, 116]] },
      { id: 'w_zhongnan_biluo', from: 'zhongnan', to: 'biluo', kind: 'mountain', name: '蜀道', danger: 4, check: { stat: 'dim3', dc: 14 }, path: [[470, 312], [430, 340], [380, 362], [346, 380]] },
      { id: 'w_biluo_chixia', from: 'biluo', to: 'chixia', kind: 'trail', name: '峨眉山道', danger: 3, path: [[364, 414]] },
      { id: 'w_chixia_yueyang', from: 'chixia', to: 'yueyang', kind: 'river', name: '三峡水路', danger: 3, cost: { currency: 6 }, check: { stat: 'dim6', dc: 13 }, path: [[414, 404], ...along(yangtze, [426, 386], [626, 388], 30)] },
      { id: 'w_shacheng_mobei', from: 'shacheng', to: 'mobei', kind: 'trail', name: '沙海驼道', danger: 4, check: { stat: 'dim6', dc: 14 }, path: [[150, 120]] },
      { id: 'w_shacheng_zhongnan', from: 'shacheng', to: 'zhongnan', kind: 'road', name: '河西走廊', danger: 3, check: { stat: 'dim3', dc: 14 }, path: [[182, 146], [247, 166], [312, 190], [350, 226], [420, 262], [466, 280]] },
      { id: 'w_mobei_xuanming', from: 'mobei', to: 'xuanming', kind: 'mountain', name: '长城外道', danger: 4, check: { stat: 'dim3', dc: 14 }, path: [[300, 120], [420, 112], [500, 96]] },
      { id: 'w_jinling_nanhai', from: 'jinling', to: 'nanhai', kind: 'sea', name: '南海洋流', danger: 4, cost: { currency: 40 }, path: [[846, 330], [890, 356], [884, 420], [846, 474], [800, 520], [736, 580], [690, 636]] },
    ],
    features,
  };
}
