/**
 * 边境贸易 · 绥芬河口岸图（1993 年冬）。照网页地图的样子画：
 * 老爷岭余脉夹着的河谷里是绥芬河市区（光明街、新华街、通天路围出来的街网，青云市场居中），
 * 滨绥铁路沿市区北缘进站，再钻隧道过境到格罗迭科沃；301 国道穿城往东接口岸大道到公路口岸。
 * 国界沿东边的山脊走，对面是俄罗斯滨海边疆区的格罗迭科沃（波格拉尼奇内）。
 * 比例约 1 单位 = 10 米；格罗迭科沃实际在口岸以东十几公里，图上压近了，过境的路程按实际时长写死。
 */
import type { MapFeature, MapModuleSchema } from '../../domains/map/types';
import { area, between, blob, blockBuildings, border, building, frame, label, rail, rect, river, road, streetGrid, water, wobble, type P } from './draw';

export function buildBorderTradeMap(): MapModuleSchema {
  const features: MapFeature[] = [];

  // ── 地貌：满山的林子（北山、天长山、东边老爷岭国界山脊），中间两条河谷 ──
  features.push(area([[-20, -20], [1020, -20], [1020, 720], [-20, 720]], 'forest'));
  // 绥芬河河谷（往西通绥阳）、口岸山口、对面格罗迭科沃的谷地
  const valley = wobble([[-20, 240], [130, 244], [220, 232], [380, 218], [560, 224], [690, 240], [760, 300], [780, 370], [770, 430], [700, 474], [600, 486], [480, 506], [350, 512], [220, 496], [90, 478], [-20, 484]], 9, 11, 18, true);
  const eastValley = wobble([[836, 262], [930, 246], [1020, 250], [1020, 452], [900, 470], [842, 440], [810, 404], [826, 330]], 8, 12, 18, true);
  features.push(area(valley, 'plains'), area(eastValley, 'plains'));
  features.push(area(wobble([[-20, 252], [120, 254], [148, 300], [140, 352], [160, 402], [192, 444], [176, 480], [60, 472], [-20, 476]], 6, 14, 18, true), 'farmland'));
  features.push(area(wobble([[872, 262], [1020, 256], [1020, 446], [930, 456], [880, 430], [890, 330]], 6, 15, 18, true), 'farmland'));
  features.push(area(blob(452, 588, 92, 48, 21, 0.12, 40, -0.08), 'forest', 'park'));

  // ── 市区：河谷里的街网 ──
  const urban = wobble([[150, 300], [214, 266], [320, 254], [430, 256], [530, 266], [598, 292], [628, 338], [622, 392], [592, 434], [530, 462], [440, 474], [346, 472], [262, 456], [196, 428], [160, 388], [144, 344]], 6, 16, 16, true);
  features.push(area(urban, 'urban'));
  const origin: P = [150, 262];
  const tilt = -0.045;
  const at = frame(origin, tilt);
  const grid = streetGrid({ origin, angle: tilt, du: 26, dv: 22, u0: 0, u1: 494, v0: 0, v1: 220, clip: urban, seed: 1993, gaps: 0.16, bend: 1.2 });
  for (const line of grid.minor) features.push(road(line, 'street'));

  // 河：从口岸那边的山沟里流出来，沿市区南缘往西
  const creek = wobble([[760, 448], [706, 462], [646, 468], [584, 480], [512, 484], [446, 494], [366, 486], [292, 480], [222, 462], [150, 458], [72, 446], [-20, 456]], 13, 17, 10);
  features.push(river(creek, 4.2));
  features.push(water(blob(96, 160, 36, 16, 23, 0.18, 30, 0.2), 'lake'));

  // 主干道（与街网对齐的局部坐标）
  const guangming = [at(-8, 66), at(120, 66), at(250, 66), at(380, 66), at(470, 70)];
  const xinhua = [at(-8, 132), at(120, 132), at(250, 132), at(380, 134), at(470, 144)];
  const tongtian = [at(208, -14), at(208, 60), at(208, 132), at(208, 210)];
  const qingyunlu = [at(130, 4), at(130, 66), at(130, 132), at(130, 200)];
  const zhanqian = [at(364, 30), at(364, 66), at(364, 132)];
  const yingbin = [at(30, 22), at(200, 22), at(364, 26), at(450, 34)];
  features.push(
    road(guangming, 'major', '光明街'),
    road(tongtian, 'major', '通天路'),
    road(qingyunlu, 'major', '青云路'),
    road(zhanqian, 'major', '站前路'),
    road(yingbin, 'major', '迎宾路'),
  );
  // 301 国道：西边进城接新华街；东头出城就是口岸大道，一路到公路口岸
  const g301West = wobble([[-20, 418], [60, 414], [120, 404]], 3, 31, 12);
  const portRoad = [at(470, 144), [652, 404], [700, 414], [752, 420], [786, 421], [826, 414], [868, 398], [900, 372]] as P[];
  features.push(road([...g301West, xinhua[0]!], 'highway', '301国道'), road(portRoad, 'highway', '口岸大道'));
  features.push(road(xinhua, 'highway', '新华街'));
  features.push(road(wobble([[300, 250], [296, 200], [306, 150], [292, 96], [300, 30], [294, -20]], 4, 32, 12), 'street', '北山林道'));
  features.push(road(wobble([[372, 470], [392, 512], [420, 540], [428, 570]], 2, 33, 10), 'path'));

  // ── 铁路：滨绥线沿市区北缘进站，过隧道到格罗迭科沃 ──
  const railWest = wobble([[-20, 262], [80, 268], [170, 276]], 2, 41, 14);
  const railTown = [[170, 276], [260, 279], [360, 280], [460, 282], [520, 286], [580, 292], [640, 298], [690, 302]] as P[];
  const railEast = [[800, 304], [850, 300], [900, 298], [940, 300], [1020, 298]] as P[];
  features.push(rail([...railWest, ...railTown], undefined, '滨绥铁路'), rail([[690, 302], [740, 306], [800, 304]], 'tunnel'), rail(railEast));
  // 站场：几股到发线
  features.push(rail([[470, 290], [520, 294], [575, 299]]), rail([[480, 275], [530, 278], [585, 285]]));

  // ── 国界 ──
  features.push(border(wobble([[792, -20], [778, 80], [794, 170], [780, 250], [790, 330], [784, 420], [796, 500], [780, 600], [792, 720]], 6, 51, 16), 'national'));
  features.push(label(560, 650, '中  国', 'country'), label(912, 545, '俄 罗 斯', 'country'));

  // ── 格罗迭科沃（波格拉尼奇内）──
  const grodUrban = blob(926, 352, 66, 46, 61, 0.12, 36, 0.1);
  features.push(area(grodUrban, 'urban'));
  const grodOrigin: P = [856, 300];
  const grodGrid = streetGrid({ origin: grodOrigin, angle: 0.08, du: 24, dv: 20, u0: 0, u1: 150, v0: 0, v1: 110, clip: grodUrban, seed: 62, gaps: 0.1 });
  for (const line of grodGrid.minor) features.push(road(line, 'street'));
  features.push(road([[868, 398], [900, 372], [930, 352], [980, 336], [1020, 330]], 'major', 'A-184'));

  // ── 建筑 ──
  const avoid = (x: number, y: number) => Math.hypot(x - 360, y - 366) < 22 || Math.hypot(x - 522, y - 304) < 16;
  features.push(...blockBuildings({ origin, angle: tilt, du: 26, dv: 22, cells: grid.cells, clip: urban, seed: 1994, street: 3.2, fill: 0.9, avoid,
    tall: (x, y) => 1 + 2.2 * Math.exp(-Math.hypot(x - 380, y - 360) / 90) }));
  features.push(...blockBuildings({ origin: grodOrigin, angle: 0.08, du: 24, dv: 20, cells: grodGrid.cells, clip: grodUrban, seed: 63, street: 3, fill: 0.8, tall: () => 0.8 }));
  features.push(building(rect(354, 366, 34, 20, tilt), 1.6)); // 青云市场大棚
  features.push(building(rect(522, 304, 28, 9, tilt), 1.2)); // 火车站站房
  features.push(building(rect(756, 412, 20, 11, 0.03), 1)); // 联检大厅
  for (let index = 0; index < 4; index++) features.push(building(rect(588 + index * 15, 362 + (index % 2) * 6, 12, 26, 0.35), 0.7)); // 铁皮仓库

  return {
    version: 1,
    title: '绥芬河口岸图',
    theme: 'modern',
    landform: 'inland',
    scale: 'region',
    metersPerUnit: 10,
    seed: 19931202,
    width: 1000,
    height: 700,
    fog: false,
    travel: { minutesPerUnit: 0.13 },
    startLocationId: 'qingyun',
    regions: [
      { id: 'downtown', name: '绥芬河市区', terrain: 'urban', x: 380, y: 362, radius: 190, color: '#d9822b', description: '河谷里的边境小城，一条光明街、一条新华街，青云市场在正中间。' },
      { id: 'portzone', name: '口岸', terrain: 'plains', x: 690, y: 400, radius: 90, color: '#3a7bd5', description: '公路口岸与铁路货场，一大早就排满了等过关的倒爷和俄罗斯卡车。' },
      { id: 'beishan', name: '北山', terrain: 'hills', x: 470, y: 120, radius: 230, color: '#2f9e6f', danger: 1, description: '城北的林场山地，雪深路滑。' },
      { id: 'tianchang', name: '天长山', terrain: 'hills', x: 420, y: 590, radius: 170, color: '#7a8a3a', description: '城南的山，山上有公园和电视塔，能望见对面的俄罗斯。' },
      { id: 'laoyeling', name: '老爷岭', terrain: 'mountains', x: 790, y: 170, radius: 140, color: '#8e5bd8', danger: 1, description: '国界沿着老爷岭的山脊走，铁路从山肚子里的隧道钻过去。' },
      { id: 'grod', name: '波格拉尼奇内区', terrain: 'urban', x: 926, y: 360, radius: 100, color: '#d64f6a', danger: 2, description: '国界那边的俄罗斯滨海边疆区，格罗迭科沃满街都是来卖中国货的倒爷。' },
    ],
    locations: [
      { id: 'qingyun', name: '绥芬河青云市场', aliases: ['青云市场'], kind: 'market', x: 360, y: 366, regionId: 'downtown', known: true, services: ['trade', 'supply'], links: { markets: ['local'] }, description: '绥芬河最热闹的边贸市场，羽绒服、运动鞋、方便面、白酒、暖水瓶，什么都有，人民币和卢布一起收。' },
      { id: 'street', name: '边贸一条街', kind: 'market', x: 414, y: 394, regionId: 'downtown', known: true, services: ['trade', 'rest'], restPrice: 15, links: { markets: ['local'] }, description: '两边全是边贸公司、报关行、翻译社和录像厅，晚上灯火通明。' },
      { id: 'restaurant', name: '中俄友好饭店', aliases: ['饭店'], kind: 'landmark', x: 466, y: 380, regionId: 'downtown', services: ['rest'], restPrice: 20, description: '老板娘的锅包肉远近闻名，倒爷谈生意的首选，先喝酒再说事。' },
      { id: 'bank', name: '银行', kind: 'temple', x: 426, y: 334, regionId: 'downtown', services: ['trade'], description: '主要业务是换汇，门口总有人拿着计算器算卢布的汇率。' },
      { id: 'blackmarket', name: '黑市换汇巷', kind: 'market', x: 452, y: 306, regionId: 'downtown', danger: 2, services: ['trade'], description: '银行后身的小巷子，汇率比银行划算，就是不知道对面是不是骗子。' },
      { id: 'hotel', name: '旅馆', aliases: ['口岸宾馆', '小旅馆', '地下室旅馆'], kind: 'home', x: 376, y: 318, regionId: 'downtown', services: ['rest', 'supply'], restPrice: 8, description: '中等旅馆一间房挤两三个人，老板认识常客，帮着存货、传消息。' },
      { id: 'post', name: '邮局', kind: 'temple', x: 296, y: 340, regionId: 'downtown', services: ['trade'], description: '倒爷寄钱回家、寄望远镜和军表的地方。' },
      { id: 'barbershop', name: '理发店与澡堂', aliases: ['澡堂', '理发店'], kind: 'market', x: 298, y: 404, regionId: 'downtown', services: ['rest'], restPrice: 10, description: '冬天跑一天，泡个热水澡、搓个澡，顺便听听谁家的货卡在口岸了。' },
      { id: 'railstation', name: '绥芬河火车站', aliases: ['火车站'], kind: 'station', x: 522, y: 312, regionId: 'downtown', known: true, description: '哈尔滨来的车凌晨到站，站前广场停着拉客去青云市场的面包车。' },
      { id: 'warehouse', name: '仓库', aliases: ['铁皮仓库', '货场'], kind: 'ruin', x: 612, y: 372, regionId: 'portzone', services: ['supply'], description: '口岸附近的简易铁皮房，租金按天算，管理员能“通融”着优先出货。' },
      { id: 'checkpoint', name: '口岸联检大厅', aliases: ['口岸', '联检大厅', '公路口岸'], kind: 'fortress', x: 752, y: 426, regionId: 'portzone', services: ['supply'], description: '每天早上八点开关，海关时松时严，大厅外停满了等装货的俄罗斯卡车。' },
      { id: 'grod', name: '格罗迭科沃', aliases: ['波格拉尼奇内', 'Гродеково'], kind: 'city', x: 920, y: 352, regionId: 'grod', danger: 2, services: ['rest', 'supply'], restPrice: 12, description: '与绥芬河一关之隔的俄罗斯小城，小旅馆住满了中国倒爷。' },
      { id: 'grodmarket', name: '格罗迭科沃市场', kind: 'market', x: 954, y: 386, regionId: 'grod', danger: 1, services: ['trade'], links: { markets: ['local'] }, description: '俄罗斯大妈排队买中国的羽绒服和运动鞋，市场里有专门的翻译区。' },
    ],
    routes: [
      { id: 'r_market_street', from: 'qingyun', to: 'street', kind: 'road', name: '边贸一条街', path: [at(225, 120)] },
      { id: 'r_street_restaurant', from: 'street', to: 'restaurant', kind: 'road', name: '边贸一条街' },
      { id: 'r_market_bank', from: 'qingyun', to: 'bank', kind: 'road', name: '光明街', path: [at(208, 66), at(270, 66)] },
      { id: 'r_bank_restaurant', from: 'bank', to: 'restaurant', kind: 'trail', name: '饭店胡同', path: [at(300, 90)] },
      { id: 'r_bank_black', from: 'bank', to: 'blackmarket', kind: 'secret', name: '换汇后巷', hidden: true, danger: 2 },
      { id: 'r_market_hotel', from: 'qingyun', to: 'hotel', kind: 'road', name: '通天路', path: [at(208, 88), at(208, 60)] },
      { id: 'r_market_post', from: 'qingyun', to: 'post', kind: 'road', name: '光明街', path: [at(180, 66), at(150, 66)] },
      { id: 'r_post_barber', from: 'post', to: 'barbershop', kind: 'trail', name: '澡堂巷', path: [at(146, 110)] },
      { id: 'r_market_barber', from: 'qingyun', to: 'barbershop', kind: 'trail', name: '市场后街', path: [at(180, 132)] },
      { id: 'r_hotel_station', from: 'hotel', to: 'railstation', kind: 'road', name: '迎宾路', path: [at(234, 22), at(364, 26)] },
      { id: 'r_station_warehouse', from: 'railstation', to: 'warehouse', kind: 'road', name: '铁路货场', path: [[572, 330]] },
      { id: 'r_restaurant_warehouse', from: 'restaurant', to: 'warehouse', kind: 'road', name: '新华街', path: [at(380, 134), at(450, 140)] },
      { id: 'r_warehouse_port', from: 'warehouse', to: 'checkpoint', kind: 'highway', name: '口岸大道', minutes: 15, path: [[652, 404], [700, 414]] },
      { id: 'r_port_grod', from: 'checkpoint', to: 'grod', kind: 'highway', name: '过境公路', danger: 2, cost: { currency: 5 }, minutes: 50, path: between(portRoad, 4, 7).slice(0, 3) },
      { id: 'r_rail_grod', from: 'railstation', to: 'grod', kind: 'rail', name: '国际列车', minutes: 60, cost: { currency: 12 }, path: [[580, 292], [690, 302], [800, 304], [880, 300]] },
      { id: 'r_grod_market', from: 'grod', to: 'grodmarket', kind: 'trail' },
    ],
    features,
  };
}
