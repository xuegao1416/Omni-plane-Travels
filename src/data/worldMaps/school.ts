/**
 * 日式校园 · 樱丘校园图。照网页地图画一座海边小镇：
 * 樱丘高校在镇子西北（L 形主教学楼、旁边的社团活动楼、西北角的旧校舍、南边的操场跑道与东侧泳池），
 * 正门出来是种满樱花的坡道，接着就是三百米长的商店街「樱坂通」；樱川从学校南边流过、两岸是河川敷，
 * 河口外是海滩与海边小旅馆，神社在镇子西北的小山丘上。比例约 1 单位 = 1.4 米。
 */
import type { MapFeature, MapModuleSchema } from '../../domains/map/types';
import { area, blob, blockBuildings, building, ellipse, frame, inside, label, land, offset, outside, rail, rect, river, road, streetGrid, water, wobble, type P } from './draw';

export function buildSchoolMap(): MapModuleSchema {
  const features: MapFeature[] = [];

  // ── 海岸：东南是樱丘湾 ──
  const coastline = wobble([[700, 730], [760, 640], [830, 590], [900, 548], [960, 500], [1030, 470]], 5, 2401, 10);
  features.push(land([[-30, -30], [1030, -30], ...coastline.slice().reverse(), [-30, 730]]));
  features.push(area([...coastline, ...offset(coastline, 30).reverse()], 'plains', 'beach'));

  // ── 樱川与河川敷 ──
  const riverLine = wobble([[-30, 548], [80, 540], [180, 528], [280, 532], [380, 548], [470, 572], [560, 600], [640, 620], [720, 640], [790, 640]], 5, 2404, 10);
  features.push(area(wobble([[-30, 520], [120, 514], [260, 506], [380, 522], [480, 548], [580, 578], [660, 598], [740, 614], [790, 618], [790, 664], [720, 666], [630, 646], [540, 626], [440, 600], [350, 580], [240, 562], [120, 568], [-30, 576]], 3, 2405, 10, true), 'forest', 'park'));
  features.push(river(riverLine, 16, '樱  川'));

  // ── 镇子北边的林子与神社所在的小山丘（稲荷山）──
  features.push(area(wobble([[-30, -30], [1030, -30], [1030, 150], [880, 162], [760, 140], [600, 136], [470, 150], [300, 170], [190, 214], [60, 226], [-30, 220]], 8, 2419, 14, true), 'forest'));
  features.push(area(wobble([[-30, -30], [1030, -30], [1030, 110], [800, 100], [600, 96], [400, 110], [240, 150], [-30, 160]], 8, 2420, 14, true), 'hills'));
  features.push(area(blob(120, 130, 120, 88, 2406, 0.16, 36, 0.3), 'hills'));
  features.push(area(blob(120, 132, 92, 66, 2407, 0.16, 32, 0.3), 'forest', 'park'));

  // ── 镇子的街网：西边住宅区、学校以东、河南岸 ──
  const townClip = wobble([[-30, 230], [210, 220], [230, 180], [520, 150], [760, 150], [900, 170], [1030, 200], [1030, 440], [940, 482], [860, 532], [780, 586], [700, 636], [620, 612], [520, 580], [420, 554], [300, 530], [160, 516], [-30, 522]], 4, 2408, 12, true);
  const origin: P = [-20, 160];
  const tilt = -0.06;
  const at = frame(origin, tilt);
  const campus = wobble([[234, 196], [508, 180], [522, 412], [252, 426]], 1, 2409, 20, true);
  const shrineHill = blob(120, 132, 98, 70, 2418, 0.1, 30, 0.3);
  const notCampus = (x: number, y: number) => inside(campus, x, y) || inside(shrineHill, x, y);
  const grid = streetGrid({ origin, angle: tilt, du: 46, dv: 36, u0: 0, u1: 1080, v0: 0, v1: 400, clip: townClip, seed: 2410, gaps: 0.12, bend: 0.6 });
  for (const lineSegment of grid.minor) {
    for (const part of outside(lineSegment, campus)) if (!inside(shrineHill, part[0]![0], part[0]![1])) features.push(road(part, 'street', undefined, 2.8));
  }
  const south = wobble([[-30, 590], [200, 590], [400, 612], [560, 646], [660, 690], [660, 730], [-30, 730]], 4, 2411, 12, true);
  const southGrid = streetGrid({ origin: [-20, 600], angle: 0.05, du: 44, dv: 34, u0: 0, u1: 700, v0: 0, v1: 140, clip: south, seed: 2412, gaps: 0.12 });
  for (const lineSegment of southGrid.minor) features.push(road(lineSegment, 'street', undefined, 2.8));

  // 主干道：沿海公路（县道）、学校前的校前通、樱坂通（商店街）、两座桥
  const coastRoad = wobble([[-30, 500], [200, 496], [420, 500], [600, 520], [720, 560], [800, 552], [880, 512], [960, 476], [1030, 446]], 2, 2413, 12);
  features.push(road(coastRoad, 'major', '沿海县道', 5));
  const sakurazaka: P[] = [[506, 410], [536, 432], [572, 456], [610, 480], [648, 504], [686, 528], [716, 546]];
  features.push(road(sakurazaka, 'street', '樱坂通', 4.2));
  features.push(road([[470, 410], [506, 410], [540, 398], [600, 380], [680, 360], [780, 340], [900, 330], [1030, 320]], 'major', '校前通', 4.6));
  features.push(road([[300, 470], [300, 532], [302, 600]], 'major', '樱川桥', 4.6), road([[730, 548], [740, 600], [748, 660]], 'street', '夕阳桥', 3.4));
  // 江之电那样的海边小电车
  features.push(rail(wobble([[-30, 476], [160, 470], [360, 476], [520, 494], [650, 524], [760, 520], [860, 480], [960, 440], [1030, 412]], 1, 2414, 12), undefined, '樱丘电铁'));
  features.push(building(rect(672, 510, 30, 9, 0.22), 0.6), label(672, 494, '樱丘站', 'district'));

  // ── 樱丘高校 ──
  features.push(area(campus, 'urban', 'campus'));
  const c = frame([238, 198], -0.06);
  features.push(area(ellipse(...c(104, 165), 68, 34, -0.06), 'plains', 'track'));
  features.push(area(ellipse(...c(104, 165), 54, 22, -0.06), 'plains', 'sports'));
  features.push(water([c(228, 136), c(254, 136), c(254, 148), c(228, 148)], 'lake'));
  features.push(building([c(70, 14), c(172, 14), c(172, 36), c(92, 36), c(92, 92), c(70, 92)], 2.2)); // 主教学楼（L 形）
  features.push(building([c(214, 22), c(268, 22), c(268, 44), c(214, 44)], 1.6)); // 社团活动楼
  features.push(building([c(10, 8), c(46, 8), c(46, 26), c(10, 26)], 1.1)); // 旧校舍
  features.push(building([c(216, 60), c(266, 60), c(266, 100), c(216, 100)], 1.7)); // 体育馆
  features.push(building([c(222, 164), c(262, 164), c(262, 176), c(222, 176)], 0.5)); // 泳池更衣室
  features.push(building([c(100, 52), c(150, 52), c(150, 92), c(100, 92)], 0.4)); // 中庭
  features.push(building([c(8, 54), c(40, 54), c(40, 64), c(8, 64)], 0.5)); // 弓道场
  features.push(area(blob(...c(24, 40), 18, 12, 2415, 0.2, 18), 'forest', 'park'));

  // ── 房子：住宅区与商店街 ──
  features.push(...blockBuildings({ origin, angle: tilt, du: 46, dv: 36, cells: grid.cells, clip: townClip, seed: 2416, street: 4, fill: 0.92, avoid: notCampus,
    tall: (x, y) => Math.hypot(x - 610, y - 470) < 130 ? 1.4 : 0.6 }));
  features.push(...blockBuildings({ origin: [-20, 600], angle: 0.05, du: 44, dv: 34, cells: southGrid.cells, clip: south, seed: 2417, street: 4, fill: 0.9, tall: () => 0.55 }));
  features.push(building(rect(866, 560, 34, 16, -0.5), 0.8)); // 海边小旅馆
  features.push(building(rect(124, 128, 16, 10, 0.3), 0.5)); // 神社本殿

  features.push(
    label(120, 214, '稲荷山', 'peak'),
    label(110, 380, '樱丘一丁目', 'district'), label(820, 250, '樱丘二丁目', 'district'), label(250, 660, '川向町', 'district'),
  );

  return {
    version: 1,
    title: '樱丘校园图',
    theme: 'modern',
    landform: 'coast',
    scale: 'city',
    metersPerUnit: 1.4,
    seed: 20240408,
    width: 1000,
    height: 700,
    fog: true,
    travel: { minutesPerUnit: 0.02 },
    startLocationId: 'gate',
    regions: [
      { id: 'campus', name: '樱丘高校', terrain: 'urban', x: 380, y: 300, radius: 150, color: '#3a7bd5', description: '四层 L 形主教学楼、社团活动楼、旧校舍、操场与泳池。' },
      { id: 'sakurazaka', name: '樱坂町', terrain: 'urban', x: 620, y: 476, radius: 110, color: '#d9822b', description: '正门坡道下去的商店街，放学后的主要去处。' },
      { id: 'riverside', name: '樱川河畔', terrain: 'plains', x: 420, y: 566, radius: 150, color: '#2f9e6f', description: '沿河的堤坝种满樱花，黄昏骑车载人回家的那条路。' },
      { id: 'shrinehill', name: '稲荷山', terrain: 'hills', x: 120, y: 132, radius: 110, color: '#8e5bd8', description: '镇子西北的小山丘，山上的神社很灵验。' },
      { id: 'bay', name: '樱丘湾', terrain: 'sea', x: 900, y: 620, radius: 140, danger: 1, color: '#2aa3b8', description: '金色的沙滩，夏天合宿和夏日祭都在这里。' },
      { id: 'backyard', name: '旧校舍后庭', terrain: 'forest', x: 262, y: 214, radius: 50, danger: 1, color: '#7a8a3a', description: '旧校舍后面的空地，不良们打架的地方，据说闹鬼。' },
    ],
    locations: [
      { id: 'gate', name: '校门', aliases: ['正门', '坡道'], kind: 'landmark', x: 498, y: 406, regionId: 'campus', known: true, description: '七点半开门、六点关门，风纪委员站岗；门外是种满樱花的长坡道。' },
      { id: 'main', name: '樱丘高校主教学楼', aliases: ['主教学楼', '教室', '图书馆', '保健室', '学生会室', '音乐室', '美术室', '电脑室', '学生食堂', '食堂', '告白角'], kind: 'academy', x: c(130, 26)[0], y: c(130, 26)[1], regionId: 'campus', known: true, services: ['train'], description: '四层 L 形校舍：一楼职员室、图书馆、保健室与食堂，二楼学生会室，四楼音乐、美术、电脑室。' },
      { id: 'club', name: '社团活动楼', aliases: ['社团楼', '戏剧部', '文学部', '管乐部'], kind: 'academy', x: c(241, 33)[0], y: c(241, 33)[1], regionId: 'campus', services: ['train'], description: '旧校舍改建的三层楼，木地板吱呀作响，门上贴着手写的社团名。' },
      { id: 'old', name: '旧校舍', kind: 'ruin', x: c(28, 17)[0], y: c(28, 17)[1], regionId: 'backyard', danger: 1, description: '西北角废弃多年的两层楼，秋庭莲常在这里抽烟；二楼尽头那间活动室没人敢进。' },
      { id: 'field', name: '操场', aliases: ['棒球部', '足球部', '樱花树'], kind: 'landmark', x: c(104, 165)[0], y: c(104, 165)[1], regionId: 'campus', services: ['train'], description: '红色跑道围着草地，体育祭的主场；场边那棵大樱花树春天落花如雨。' },
      { id: 'pool', name: '游泳池', aliases: ['游泳部'], kind: 'landmark', x: c(241, 142)[0], y: c(241, 142)[1], regionId: 'campus', description: '操场东侧的 25 米露天泳池，游泳部的目标是全国大赛。' },
      { id: 'kyudo', name: '弓道场', aliases: ['弓道部'], kind: 'academy', x: c(24, 59)[0], y: c(24, 59)[1], regionId: 'campus', services: ['train'], description: '最安静的社团，每一箭都要全神贯注。' },
      { id: 'sakura', name: '樱坂商店街', aliases: ['樱坂通', '商店街', '文具店', '漫画咖啡厅'], kind: 'market', x: 540, y: 436, regionId: 'sakurazaka', known: true, services: ['trade', 'supply'], description: '正门外三百米长的商店街，便利店、文具店、漫画咖啡厅、二手游戏店一路排开。' },
      { id: 'konbini', name: '便利店', kind: 'market', x: 576, y: 462, regionId: 'sakurazaka', services: ['supply'], description: '放学后买饭团和饮料的地方，店员认得每张熟脸。' },
      { id: 'crepe', name: '可丽饼店 Sugar Bloom', aliases: ['可丽饼店', 'Sugar Bloom'], kind: 'market', x: 614, y: 486, regionId: 'sakurazaka', services: ['rest'], restPrice: 6, description: '现充组的据点，靠窗的位置永远有人占。' },
      { id: 'bookoff', name: 'Book Off 二手书店', aliases: ['Book Off', '二手书店'], kind: 'market', x: 652, y: 510, regionId: 'sakurazaka', services: ['trade'], description: '宅文化组扎堆翻漫画的地方，就在可丽饼店隔壁。' },
      { id: 'karaoke', name: 'Melody 卡拉OK', aliases: ['卡拉OK', 'Melody'], kind: 'landmark', x: 694, y: 536, regionId: 'sakurazaka', services: ['rest'], restPrice: 12, description: '商店街尽头的卡拉OK，考完试全班都来。' },
      { id: 'river', name: '河川敷', aliases: ['樱川', '小桥', '堤坝'], kind: 'landmark', x: 420, y: 560, regionId: 'riverside', description: '沿河的堤坝种满樱花，尽头那座小桥是看夕阳的最佳位置。' },
      { id: 'shrine', name: '神社', aliases: ['稲荷神社', '大银杏'], kind: 'temple', x: 124, y: 140, regionId: 'shrinehill', services: ['rest'], restPrice: 0, description: '小山丘上的古老神社，考试和告白前都来许愿；旁边的大银杏秋天一片金黄。' },
      { id: 'beach', name: '海边', aliases: ['沙滩', '海滩', '夏日祭'], kind: 'landmark', x: 842, y: 588, regionId: 'bay', description: '金色的沙滩，夏天合宿训练、夏日祭的烟花都在这里。' },
      { id: 'inn', name: '海边小旅馆', aliases: ['旅馆'], kind: 'home', x: 878, y: 556, regionId: 'bay', services: ['rest', 'supply'], restPrice: 30, description: '老板娘的海鲜料理远近闻名，合宿时晚上在这里开联欢会。' },
    ],
    routes: [
      { id: 's_gate_main', from: 'gate', to: 'main', kind: 'road', name: '正门坡道', path: [c(250, 210), c(206, 112), c(150, 60)] },
      { id: 's_main_club', from: 'main', to: 'club', kind: 'trail', name: '连廊' },
      { id: 's_main_old', from: 'main', to: 'old', kind: 'trail', name: '后庭小径', path: [c(60, 46)] },
      { id: 's_main_kyudo', from: 'main', to: 'kyudo', kind: 'trail', path: [c(50, 60)] },
      { id: 's_main_field', from: 'main', to: 'field', kind: 'trail', name: '操场侧门', path: [c(110, 110)] },
      { id: 's_field_pool', from: 'field', to: 'pool', kind: 'trail' },
      { id: 's_gate_pool', from: 'gate', to: 'pool', kind: 'trail' },
      { id: 's_gate_sakura', from: 'gate', to: 'sakura', kind: 'road', name: '樱坂', path: [[522, 422]] },
      { id: 's_sakura_konbini', from: 'sakura', to: 'konbini', kind: 'road', name: '樱坂通' },
      { id: 's_konbini_crepe', from: 'konbini', to: 'crepe', kind: 'road', name: '樱坂通' },
      { id: 's_crepe_bookoff', from: 'crepe', to: 'bookoff', kind: 'road', name: '樱坂通' },
      { id: 's_bookoff_karaoke', from: 'bookoff', to: 'karaoke', kind: 'road', name: '樱坂通' },
      { id: 's_sakura_river', from: 'sakura', to: 'river', kind: 'trail', name: '河堤斜坡', path: [[500, 500], [440, 536]] },
      { id: 's_main_river', from: 'main', to: 'river', kind: 'trail', name: '后门小路', path: [c(40, 220), [300, 500], [360, 536]] },
      { id: 's_river_shrine', from: 'river', to: 'shrine', kind: 'mountain', name: '神社参道', danger: 1, path: [[240, 520], [150, 420], [130, 260]] },
      { id: 's_karaoke_beach', from: 'karaoke', to: 'beach', kind: 'road', name: '夕阳桥', path: [[730, 548], [780, 556]] },
      { id: 's_beach_inn', from: 'beach', to: 'inn', kind: 'trail', name: '沙滩小径' },
      { id: 's_river_beach', from: 'river', to: 'beach', kind: 'trail', name: '堤坝自行车道', path: [[560, 590], [700, 624], [780, 610]] },
    ],
    features,
  };
}

