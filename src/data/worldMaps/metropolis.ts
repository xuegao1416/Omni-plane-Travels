/**
 * 烟火人间 · 焰城测绘图。照网页地图画一座大江穿城的南方大都市：
 * 焰江从西往东横穿，北岸是金融城的写字楼、商场与湿地公园，西北是老城区与三甲医院；
 * 南岸是城中村和老小区——出租屋楼下就是便利店和宠物医院，隔壁是菜市场，江边一条夜市；
 * 地铁一号线从南岸钻过江底进金融城，二号线沿北岸东西走。比例约 1 单位 = 4 米。
 */
import type { MapFeature, MapModuleSchema } from '../../domains/map/types';
import { along, area, blob, blockBuildings, building, label, offset, outside, rail, rect, river, road, streetGrid, water, wobble, type P } from './draw';

export function buildMetropolisMap(): MapModuleSchema {
  const features: MapFeature[] = [];

  // ── 焰江与两岸绿带 ──
  const river0 = wobble([[-30, 404], [150, 414], [300, 442], [450, 462], [600, 452], [750, 432], [900, 452], [1030, 472]], 6, 4101, 14);
  features.push(area([...offset(river0, 58), ...offset(river0, -58).reverse()], 'forest', 'park'));
  features.push(river(river0, 74, '焰  江'));
  // 北岸湿地公园（公司附近）
  const wetland = blob(842, 378, 92, 40, 4102, 0.16, 34, -0.1);
  features.push(area(wetland, 'swamp', 'park'));
  features.push(water(blob(820, 372, 30, 12, 4103, 0.3, 22), 'lake'), water(blob(880, 388, 18, 9, 4104, 0.3, 18), 'lake'));

  // ── 街网 ──
  const north = wobble([[-30, -30], [1030, -30], [1030, 404], [900, 392], [750, 372], [600, 392], [450, 402], [300, 382], [150, 356], [-30, 346]], 2, 4105, 20, true);
  const south = wobble([[-30, 462], [150, 472], [300, 500], [450, 522], [600, 512], [750, 492], [900, 512], [1030, 532], [1030, 730], [-30, 730]], 2, 4106, 20, true);
  const cbdZone = wobble([[470, 150], [800, 140], [820, 360], [760, 368], [600, 386], [480, 392]], 2, 4107, 20, true);
  const village = blob(300, 612, 92, 66, 4108, 0.14, 30, 0.2);
  // 北岸：金融城大街区 + 西边老城的中等街区
  const cbd = streetGrid({ origin: [470, 140], angle: 0, du: 82, dv: 64, u0: 0, u1: 360, v0: 0, v1: 260, clip: cbdZone, seed: 4110 });
  for (const line of [...cbd.minor, ...cbd.major]) features.push(road(line, 'street', undefined, 4.2));
  const westGrid = streetGrid({ origin: [-30, 90], angle: 0.04, du: 52, dv: 44, u0: 0, u1: 520, v0: 0, v1: 300, clip: north, seed: 4111, gaps: 0.1, bend: 1.4 });
  for (const line of westGrid.minor) for (const part of outside(line, cbdZone)) features.push(road(part, 'street', undefined, 3));
  const eastGrid = streetGrid({ origin: [800, 60], angle: -0.05, du: 56, dv: 46, u0: 0, u1: 260, v0: 0, v1: 330, clip: north, seed: 4112, gaps: 0.1 });
  for (const line of eastGrid.minor) for (const part of outside(line, wetland)) features.push(road(part, 'street', undefined, 3));
  // 南岸：老小区街区，城中村里是窄巷
  const southGrid = streetGrid({ origin: [-30, 470], angle: 0.08, du: 46, dv: 36, u0: 0, u1: 1100, v0: 0, v1: 260, clip: south, seed: 4113, gaps: 0.1, bend: 1 });
  for (const line of southGrid.minor) for (const part of outside(line, village)) features.push(road(part, 'street', undefined, 2.8));
  const lanes = streetGrid({ origin: [200, 540], angle: 0.2, du: 16, dv: 14, u0: 0, u1: 200, v0: 0, v1: 150, clip: village, seed: 4114, gaps: 0.25, bend: 1.6 });
  for (const line of lanes.minor) features.push(road(line, 'path', undefined, 1.2));

  // 主干道、滨江路、过江大桥、内环高架
  const northBank = offset(river0, 66);
  const southBank = offset(river0, -66);
  features.push(road(northBank, 'major', '滨江北路', 6), road(southBank, 'major', '滨江南路', 6));
  const central: P[] = [[470, 250], [560, 248], [640, 246], [720, 244], [820, 240]];
  features.push(road(central, 'major', '中心大道', 6.5));
  features.push(road([[640, 140], [640, 246], [636, 330], [632, 400]], 'major', '金融大道', 6.5));
  features.push(road([[380, 90], [384, 220], [390, 330], [394, 400]], 'major', '医院路', 5));
  features.push(road([[250, 380], [258, 470], [262, 560], [270, 730]], 'major', '人民桥', 6), road([[700, 360], [706, 450], [712, 540], [716, 730]], 'major', '江湾大桥', 6));
  features.push(road([[-30, 160], [300, 150], [600, 120], [920, 110], [1030, 112]], 'highway', '内环高架', 7), road([[920, 110], [930, 300], [940, 460], [930, 600], [940, 730]], 'highway', '内环高架', 7));
  features.push(road(wobble([[300, 470], [304, 540], [310, 600], [320, 680], [326, 730]], 1, 4115, 10), 'major', '城中村大街', 4.6));

  // ── 地铁 ──
  const line1 = wobble([[372, 730], [370, 640], [372, 562], [420, 480], [520, 400], [636, 336], [760, 220], [900, 100], [1030, 40]], 1, 4120, 12);
  const line2 = wobble([[-30, 320], [200, 326], [392, 316], [520, 330], [636, 336], [760, 344], [900, 350], [1030, 356]], 1, 4121, 12);
  features.push(rail(line1, 'metro', '地铁一号线', '#e03c31'), rail(line2, 'metro', '地铁二号线', '#3aa655'));

  // ── 建筑：金融城的高楼、老城的多层、城中村的握手楼 ──
  features.push(...blockBuildings({ origin: [470, 140], angle: 0, du: 82, dv: 64, cells: cbd.cells, clip: cbdZone, seed: 4130, street: 7, fill: 0.95,
    tall: (x, y) => 3 + 7 * Math.exp(-Math.hypot(x - 620, y - 290) / 120) }));
  features.push(...blockBuildings({ origin: [-30, 90], angle: 0.04, du: 52, dv: 44, cells: westGrid.cells, clip: north, seed: 4131, street: 5, fill: 0.9,
    avoid: (x, y) => x > 466 && x < 822 && y > 136 && y < 392, tall: () => 1.6 }));
  features.push(...blockBuildings({ origin: [800, 60], angle: -0.05, du: 56, dv: 46, cells: eastGrid.cells, clip: north, seed: 4132, street: 5, fill: 0.85,
    avoid: (x, y) => Math.hypot(x - 842, y - 378) < 100, tall: () => 2.2 }));
  features.push(...blockBuildings({ origin: [-30, 470], angle: 0.08, du: 46, dv: 36, cells: southGrid.cells, clip: south, seed: 4133, street: 4.5, fill: 0.92,
    avoid: (x, y) => Math.hypot(x - 300, y - 612) < 96, tall: () => 1.5 }));
  features.push(...blockBuildings({ origin: [200, 540], angle: 0.2, du: 16, dv: 14, cells: lanes.cells, clip: village, seed: 4134, street: 1.4, fill: 0.98, tall: () => 1.1 }));
  features.push(building(rect(690, 340, 70, 34, 0), 2.6), building(rect(380, 290, 48, 30, 0.04), 2)); // 商场、医院
  features.push(area(rect(690, 300, 50, 20, 0), 'plains', 'park'));

  features.push(
    label(470, 680, '城 中 村', 'district'),
    label(880, 300, '江 湾', 'district'),
  );

  const metroPath = along(line1, [372, 562], [636, 336], 12);
  return {
    version: 1,
    title: '焰城测绘图',
    theme: 'modern',
    landform: 'inland',
    scale: 'city',
    metersPerUnit: 4,
    seed: 20240416,
    width: 1000,
    height: 700,
    fog: false,
    travel: { minutesPerUnit: 0.055 },
    startLocationId: 'home',
    regions: [
      { id: 'oldtown', name: '老城住区', terrain: 'urban', x: 300, y: 610, radius: 170, color: '#3a7bd5', description: '江南岸的城中村和老小区，握手楼挤在一起，楼下什么都有。' },
      { id: 'cbd', name: '金融城', terrain: 'urban', x: 640, y: 290, radius: 180, color: '#8e5bd8', description: '江北岸的金融城，玻璃幕墙的写字楼，周末才去的商场。' },
      { id: 'nightquarter', name: '滨江夜市', terrain: 'urban', x: 560, y: 548, radius: 80, color: '#d9822b', description: '南岸江边的夜市，烧烤、小龙虾、臭豆腐，人均五六十吃到撑。' },
      { id: 'northgreen', name: '湿地公园', terrain: 'forest', x: 842, y: 378, radius: 90, color: '#2f9e6f', description: '公司附近免费开放的湿地公园，傍晚遛狗跳广场舞的都在这里。' },
      { id: 'westside', name: '老城区', terrain: 'urban', x: 220, y: 250, radius: 160, color: '#2aa3b8', description: '江北岸的老城区，三甲医院就在这片。' },
    ],
    locations: [
      { id: 'home', name: '出租屋', aliases: ['家', '房间'], kind: 'home', x: 300, y: 610, regionId: 'oldtown', known: true, services: ['rest'], description: '一室一厅的出租屋，房东十年前的审美，但牙刷有了固定的位置。' },
      { id: 'konbini', name: '楼下便利店', aliases: ['便利店'], kind: 'market', x: 326, y: 596, regionId: 'oldtown', known: true, services: ['supply', 'trade'], description: '闭着眼都能找到泡面货架，老板知道你买什么烟、几点来买宵夜。' },
      { id: 'petclinic', name: '宠物医院', kind: 'temple', x: 276, y: 630, regionId: 'oldtown', services: ['heal'], restPrice: 80, links: { events: [{ eventId: 'pet_sick', packId: 'world:desire_metropolis:events' }] }, description: '楼下那家宠物医院，兽医说「没什么大问题」的那一刻比升职还开心。' },
      { id: 'foodmarket', name: '菜市场', kind: 'market', x: 372, y: 646, regionId: 'oldtown', known: true, services: ['trade', 'supply'], description: '小区旁边的菜市场，早六点开到晚八点，可以赊账，别超过一周。' },
      { id: 'metro', name: '地铁站', aliases: ['地铁', '地铁一号线'], kind: 'station', x: 372, y: 562, regionId: 'oldtown', known: true, services: ['supply'], effects: [{ target: 'map.travel.time', mode: 'mult', value: 0.85, label: '地铁换乘' }], description: '早高峰七点半到九点是人间炼狱，「借过」是一门艺术。' },
      { id: 'nightmarket', name: '夜市', aliases: ['滨江夜市'], kind: 'market', x: 560, y: 548, regionId: 'nightquarter', services: ['trade', 'rest'], restPrice: 60, links: { events: [{ eventId: 'colleague_dinner', packId: 'world:desire_metropolis:events' }] }, description: '周末晚上的夜市，你不在乎热量，只在乎这一刻的快乐。' },
      { id: 'office', name: '写字楼', aliases: ['公司', '工位', '茶水间'], kind: 'landmark', x: 612, y: 286, regionId: 'cbd', known: true, links: { events: [{ eventId: 'overtime', packId: 'world:desire_metropolis:events' }] }, description: '开放式办公区中间的工位，左边摸鱼达人，右边卷王，领导的目光扫得到每个人。' },
      { id: 'cafe', name: '咖啡店', kind: 'market', x: 652, y: 306, regionId: 'cbd', services: ['rest'], restPrice: 25, links: { events: [{ eventId: 'date', packId: 'world:desire_metropolis:events' }] }, description: '楼下那家独立咖啡店，美式二十五，坐一下午也没人赶。' },
      { id: 'gym', name: '健身房', kind: 'landmark', x: 548, y: 266, regionId: 'cbd', services: ['train'], restPrice: 30, links: { events: [{ eventId: 'gym', packId: 'world:desire_metropolis:events' }] }, description: '公司附近的连锁健身房，月卡三百，跑步机永远有人占。' },
      { id: 'mall', name: '商圈', aliases: ['商场', '电影院', '美食广场'], kind: 'market', x: 690, y: 344, regionId: 'cbd', services: ['trade', 'rest'], restPrice: 40, links: { events: [{ eventId: 'colleague_dinner', packId: 'world:desire_metropolis:events' }] }, description: '地下一层美食广场，顶楼电影院，爆米花比电影票还贵。' },
      { id: 'park', name: '城市公园', aliases: ['湿地公园', '奶茶店'], kind: 'landmark', x: 842, y: 362, regionId: 'northgreen', services: ['rest'], restPrice: 15, description: '傍晚遛狗的大爷、跳广场舞的阿姨、跑步的年轻人各占一方。' },
      { id: 'hospital', name: '医院', aliases: ['三甲医院', '体检中心'], kind: 'temple', x: 380, y: 292, regionId: 'westside', services: ['heal'], restPrice: 120, description: '公司年度体检的那家三甲医院，最怕听到「需要进一步检查」。' },
    ],
    routes: [
      { id: 'm_home_konbini', from: 'home', to: 'konbini', kind: 'trail', name: '楼道口' },
      { id: 'm_home_pet', from: 'home', to: 'petclinic', kind: 'trail', name: '楼下' },
      { id: 'm_home_food', from: 'home', to: 'foodmarket', kind: 'road', name: '早市巷', path: [[338, 640]] },
      { id: 'm_home_metro', from: 'home', to: 'metro', kind: 'trail', name: '小区后门', path: [[330, 576]] },
      { id: 'm_metro_office', from: 'metro', to: 'office', kind: 'rail', name: '地铁一号线', minutes: 18, path: metroPath },
      { id: 'm_office_cafe', from: 'office', to: 'cafe', kind: 'trail', name: '楼下' },
      { id: 'm_office_gym', from: 'office', to: 'gym', kind: 'road', name: '中心大道', path: [[580, 248]] },
      { id: 'm_cafe_mall', from: 'cafe', to: 'mall', kind: 'road' },
      { id: 'm_office_mall', from: 'office', to: 'mall', kind: 'road', name: '金融大道', path: [[636, 330]] },
      { id: 'm_mall_park', from: 'mall', to: 'park', kind: 'road', name: '滨江北路', path: along(northBank, [720, 370], [800, 372], 6) },
      { id: 'm_mall_hospital', from: 'mall', to: 'hospital', kind: 'rail', name: '地铁二号线', minutes: 12, path: along(line2, [636, 336], [392, 316], 8) },
      { id: 'm_food_night', from: 'foodmarket', to: 'nightmarket', kind: 'trail', name: '夜市口', path: [[440, 610], [510, 566]] },
      { id: 'm_night_metro', from: 'nightmarket', to: 'metro', kind: 'road', name: '滨江南路', path: along(southBank, [540, 520], [400, 528], 6) },
      { id: 'm_mall_night', from: 'mall', to: 'nightmarket', kind: 'road', name: '江湾大桥', path: [[706, 400], [708, 470], [640, 540]] },
      { id: 'm_metro_hospital', from: 'metro', to: 'hospital', kind: 'road', name: '人民桥', path: [[300, 540], [262, 470], [258, 400], [330, 340]] },
    ],
    features,
  };
}
