/**
 * 末日废土 · 废土生存图。照世界书写的旧纽约—费城走廊排：
 * 特拉华河从北边下来，过特伦顿（铁锈镇）折向西南流经旧费城；十三号线沿走廊埋在地下，
 * 七号站·锈市在铁锈镇南，三号站·诊所站在旧费城东北；红雾荒原在旧费城以北约四十公里，
 * 钢铁黎明占着南费城的旧海军船坞（军械库），变异森林是新泽西南部的松林荒原，东边是大西洋。
 * 比例约 1 单位 = 110 米（经纬度投影；旧纽约在图外东北，地铁北段通往新布朗斯维克）。
 */
import type { MapFeature, MapModuleSchema } from '../../domains/map/types';
import { along, area, blob, label, rail, river, road, water, wobble, type P } from './draw';

/** 经纬度 → 画布（西经 75.45°~74.15°、北纬 40.56°~39.867°）。 */
const geo = (lon: number, lat: number): P => [Math.round(((lon + 75.45) / 1.3) * 1000 * 10) / 10, Math.round(((40.56 - lat) / 0.693) * 700 * 10) / 10];
const line = (points: Array<[number, number]>): P[] => points.map(([lon, lat]) => geo(lon, lat));

export function buildWastelandMap(): MapModuleSchema {
  const features: MapFeature[] = [];

  // ── 水库与河口（大西洋在图外东边）──
  features.push(water(wobble(line([[-75.04, 40.47], [-74.99, 40.45], [-75.0, 40.42], [-75.05, 40.43]]), 1.2, 3301, 6, true), 'lake'));
  features.push(water(blob(...geo(-74.52, 40.41), 16, 7, 3302, 0.25, 20, 0.5), 'lake'));

  // ── 河流 ──
  const delaware = wobble(line([
    [-75.21, 40.86], [-75.19, 40.69], [-75.06, 40.55], [-74.95, 40.36], [-74.83, 40.27], [-74.76, 40.21], [-74.71, 40.15], [-74.80, 40.10], [-74.86, 40.07],
    [-74.98, 40.02], [-75.06, 39.99], [-75.12, 39.95], [-75.15, 39.90], [-75.24, 39.87], [-75.36, 39.84], [-75.45, 39.78],
  ]), 3, 3310, 8);
  features.push(river(delaware, 7, '特拉华河'));
  features.push(river(wobble(line([[-75.50, 40.16], [-75.40, 40.11], [-75.31, 40.07], [-75.24, 40.02], [-75.20, 39.97], [-75.20, 39.885]]), 2, 3311, 8), 3, '斯库基尔河'));
  features.push(river(wobble(line([[-74.75, 40.57], [-74.60, 40.55], [-74.45, 40.49], [-74.34, 40.50], [-74.27, 40.51]]), 2, 3312, 8), 3.2, '拉里坦河'));
  features.push(river(wobble(line([[-74.70, 40.36], [-74.66, 40.31], [-74.72, 40.24], [-74.76, 40.215]]), 1.4, 3313, 8), 1.8));

  // ── 地块：废城、红雾荒原、松林荒原（变异森林）──
  features.push(area(wobble(line([[-75.32, 40.10], [-75.06, 40.12], [-74.97, 40.03], [-75.02, 39.90], [-75.14, 39.87], [-75.30, 39.90], [-75.34, 40.00]]), 5, 3320, 10, true), 'wasteland', 'industrial'));
  features.push(area(wobble(line([[-75.28, 40.05], [-75.10, 40.06], [-75.07, 39.97], [-75.12, 39.91], [-75.25, 39.92]]), 4, 3321, 9, true), 'urban'));
  features.push(area(wobble(line([[-75.135, 39.96], [-75.08, 39.965], [-75.05, 39.92], [-75.10, 39.90], [-75.13, 39.92]]), 3, 3330, 8, true), 'urban'));
  features.push(area(blob(...geo(-74.76, 40.22), 40, 30, 3322, 0.18, 30), 'urban'));
  features.push(area(blob(...geo(-74.45, 40.49), 46, 30, 3323, 0.2, 28), 'urban'));
  features.push(area(blob(...geo(-74.66, 40.35), 22, 16, 3325, 0.2, 22), 'urban', 'campus'));
  features.push(area(blob(...geo(-74.85, 40.15), 34, 22, 3331, 0.22, 24, 0.6), 'urban'));
  features.push(area(blob(...geo(-74.92, 40.02), 40, 24, 3332, 0.22, 24, 0.5), 'urban'));
  features.push(area(blob(...geo(-75.15, 40.31), 150, 96, 3326, 0.22, 40, 0.3), 'wasteland', 'hazard'));
  features.push(area(wobble([[560, 730], ...line([[-74.78, 39.93], [-74.62, 40.02], [-74.42, 40.04], [-74.24, 40.12], [-74.15, 40.10]]), [1030, 730]], 8, 3327, 12, true), 'forest'));
  features.push(area(blob(...geo(-74.98, 40.48), 150, 64, 3328, 0.2, 36, -0.35), 'forest'));
  features.push(area(blob(...geo(-74.40, 40.25), 120, 70, 3329, 0.24, 32, 0.2), 'farmland'));

  // ── 旧世界的路网（州际公路、一号公路、130 号公路；十三号线埋在地下）──
  const i95 = wobble(line([[-75.24, 39.87], [-75.15, 39.94], [-75.04, 40.03], [-74.92, 40.11], [-74.82, 40.18], [-74.77, 40.235], [-74.84, 40.30], [-74.93, 40.36], [-75.05, 40.42]]), 1.5, 3330, 8);
  features.push(road(i95, 'highway', 'I-95'));
  const us1 = wobble(line([[-74.76, 40.22], [-74.66, 40.31], [-74.58, 40.38], [-74.45, 40.49], [-74.36, 40.57]]), 1.2, 3332, 8);
  features.push(road(us1, 'major', '一号公路'));
  const r130 = wobble(line([[-75.12, 39.93], [-75.02, 39.99], [-74.92, 40.03], [-74.83, 40.08], [-74.73, 40.14], [-74.70, 40.20], [-74.74, 40.215]]), 1.2, 3333, 8);
  features.push(road(r130, 'major', '130号公路'));
  features.push(road(wobble(line([[-75.17, 39.952], [-75.17, 39.92], [-75.175, 39.888]]), 0.4, 3335, 5), 'major', '南布罗德街'));
  features.push(road(wobble(line([[-75.21, 39.955], [-75.15, 39.952], [-75.10, 39.948], [-75.06, 39.94]]), 0.5, 3336, 6), 'major', '市场街'));
  const line13 = wobble(line([[-75.155, 39.955], [-75.10, 39.99], [-75.03, 40.04], [-74.95, 40.09], [-74.86, 40.15], [-74.78, 40.205], [-74.70, 40.27], [-74.60, 40.35], [-74.47, 40.47]]), 1, 3337, 8);
  features.push(rail(line13, 'metro', '十三号线（地下）', '#c0392b'));

  features.push(
    label(...geo(-75.33, 40.50), '旧 宾 夕 法 尼 亚', 'district'), label(...geo(-74.42, 40.18), '旧 新 泽 西', 'district'),
    label(...geo(-74.24, 40.54), '旧纽约 →', 'district'), label(...geo(-74.22, 40.03), '大西洋 →', 'district'),
  );

  const at = (lon: number, lat: number) => geo(lon, lat);
  const [rx, ry] = at(-74.755, 40.215);
  return {
    version: 1,
    title: '废土生存图',
    theme: 'modern',
    landform: 'inland',
    scale: 'region',
    metersPerUnit: 110,
    seed: 20870419,
    width: 1000,
    height: 700,
    fog: true,
    travel: { minutesPerUnit: 2 },
    startLocationId: 'rusttown',
    regions: [
      { id: 'rusttown', name: '铁锈镇', terrain: 'urban', x: rx, y: ry, radius: 70, danger: 2, color: '#d9822b', description: '旧特伦顿工厂区上的地表聚落，三层废铁与钢板墙围着八十口人。' },
      { id: 'under', name: '十三号线沿线', terrain: 'plains', x: 320, y: 440, radius: 120, danger: 2, color: '#c0392b', description: '地下二十米的混凝土隧道，十四个旧车站里有七个住着人。' },
      { id: 'redmist', name: '红雾荒原', terrain: 'wasteland', x: geo(-75.15, 40.30)[0], y: geo(-75.15, 40.30)[1], radius: 120, danger: 5, color: '#d64f6a', effects: [{ target: 'map.travel.time', mode: 'mult', value: 1.3, label: '辐射尘雾' }], encounters: ['辐射变异兽', '雾中掠夺者'], description: '核爆核心区的下风沉降带，终年淡红色的辐射尘雾，能见度不足十五米。' },
      { id: 'oldcity', name: '旧费城废墟', terrain: 'wasteland', x: geo(-75.17, 39.96)[0], y: geo(-75.17, 39.96)[1], radius: 95, danger: 3, color: '#7a8a3a', encounters: ['拾荒帮', '安保机器人'], description: '扭曲的钢筋骨架和倒塌的混凝土墙，拾荒者的天堂，也随时会塌。' },
      { id: 'mutant', name: '变异森林', terrain: 'forest', x: geo(-74.56, 39.95)[0], y: geo(-74.56, 39.95)[1], radius: 130, danger: 4, color: '#2f9e6f', encounters: ['变异兽群', '孢子幻影'], description: '新泽西南部的松林荒原长成了发光的变异森林，孢子雾让人产生幻觉。' },
      { id: 'military', name: '军事禁区', terrain: 'wasteland', x: geo(-75.175, 39.89)[0], y: geo(-75.175, 39.89)[1], radius: 45, danger: 5, color: '#8e5bd8', encounters: ['钢铁黎明巡逻队'], description: '南费城的旧海军船坞，钢铁黎明占着军械库，安保机器人还在巡逻。' },
    ],
    locations: [
      { id: 'rusttown', name: '铁锈镇', kind: 'town', x: rx, y: ry, regionId: 'rusttown', known: true, danger: 1, services: ['rest', 'trade', 'supply'], restPrice: 5, description: '建在旧避难所地表扩展区上的聚落，周围废弃工厂一片铁锈色。' },
      { id: 'tavern', name: '锈蚀酒馆', kind: 'home', x: rx - 16, y: ry - 18, regionId: 'rusttown', known: true, danger: 1, services: ['rest'], restPrice: 3, description: '独眼老兵开的酒馆，墙上贴满悬赏令，各势力在这里暂时放下恩怨。' },
      { id: 'purify', name: '净化站', kind: 'station', x: rx + 20, y: ry - 12, regionId: 'rusttown', known: true, services: ['supply'], description: '退伍老兵汉克维护的旧世界净水设备，每天五十升净水。' },
      { id: 'line13', name: '十三号线入口', aliases: ['地铁口', '十三号线'], kind: 'station', x: rx + 6, y: ry + 20, regionId: 'rusttown', known: true, danger: 2, description: '镇子底下的旧避难所连着十三号线，往南是七号站，往北通旧纽约。' },
      { id: 'rustmarket', name: '七号站·锈市', aliases: ['锈市', '七号站'], kind: 'market', x: geo(-74.86, 40.15)[0], y: geo(-74.86, 40.15)[1], regionId: 'under', danger: 2, services: ['trade', 'supply'], description: '废土最大的地下交易市场，站台两侧摆满子弹、抗辐宁、旧世界零件和变异兽皮。' },
      { id: 'clinic', name: '三号站·诊所站', aliases: ['诊所站', '三号站', '老白的诊所'], kind: 'temple', x: geo(-75.06, 40.03)[0], y: geo(-75.06, 40.03)[1], regionId: 'under', danger: 2, services: ['heal'], restPrice: 8, description: '老白在旧世界医院的器械上开的诊所，做外伤处理和辐射净化。' },
      { id: 'oldmetro', name: '旧世界地铁站', kind: 'station', x: geo(-75.155, 39.958)[0] + 8, y: geo(-75.155, 39.958)[1] - 10, regionId: 'oldcity', danger: 2, description: '十三号线费城端的塌方车站，隧道里有东西在动。' },
      { id: 'ruins', name: '旧世界废墟', aliases: ['旧费城'], kind: 'ruin', x: geo(-75.165, 39.952)[0] - 14, y: geo(-75.165, 39.952)[1] + 8, regionId: 'oldcity', danger: 3, description: '旧费城市中心，只剩扭曲的钢筋骨架和倒塌的混凝土墙。' },
      { id: 'hospital', name: '旧世界医院', kind: 'ruin', x: geo(-75.20, 39.95)[0] - 22, y: geo(-75.20, 39.95)[1] - 6, regionId: 'oldcity', danger: 3, services: ['heal'], description: '大学城的旧医院，可能还藏着医疗设备与药品，辐射值也高。' },
      { id: 'factory', name: '旧世界工厂', kind: 'ruin', x: geo(-75.10, 39.935)[0] + 10, y: geo(-75.10, 39.935)[1] + 8, regionId: 'oldcity', danger: 3, description: '河对岸卡姆登的老厂区，机器、零件和原材料，外加还在转的安保机器人。' },
      { id: 'base', name: '旧军事基地', aliases: ['军械库', '海军船坞', '钢铁黎明'], kind: 'fortress', x: geo(-75.175, 39.89)[0], y: geo(-75.175, 39.89)[1], regionId: 'military', danger: 5, links: { events: [{ eventId: 'raider_ambush', packId: 'world:wasteland_apocalypse:events' }] }, description: '钢铁黎明占据的旧费城军械库，存着大量旧世界武器与动力装甲。' },
      { id: 'supermarket', name: '旧世界超市', kind: 'ruin', x: geo(-74.95, 40.10)[0], y: geo(-74.95, 40.10)[1], regionId: 'under', danger: 3, services: ['supply'], description: '郊区的大卖场，货架早被洗劫过，也许仓库里还剩几箱罐头。' },
      { id: 'housing', name: '旧世界住宅', kind: 'ruin', x: geo(-74.88, 39.99)[0], y: geo(-74.88, 39.99)[1], regionId: 'under', danger: 2, description: '河东一片连排旧住宅，家具电器还在，也可能藏着掠夺者。' },
      { id: 'substation', name: '旧世界发电站', kind: 'ruin', x: geo(-74.79, 40.08)[0], y: geo(-74.79, 40.08)[1], regionId: 'under', danger: 4, links: { events: [{ eventId: 'awakening', packId: 'world:wasteland_apocalypse:events' }] }, description: '河边的旧电厂，发电机和变压器都在，辐射也在。' },
      { id: 'slavemarket', name: '奴隶市场', aliases: ['血狼帮'], kind: 'market', x: geo(-74.70, 40.14)[0], y: geo(-74.70, 40.14)[1], regionId: 'rusttown', danger: 4, description: '血狼帮在废车场里开的市场，有技术的俘虏能卖五十发以上。' },
      { id: 'library', name: '旧世界图书馆', kind: 'academy', x: geo(-74.66, 40.35)[0], y: geo(-74.66, 40.35)[1], regionId: 'under', danger: 2, description: '普林斯顿的旧图书馆，书大多烂了，地图与资料室也许还在。' },
      { id: 'school', name: '旧世界学校', kind: 'academy', x: geo(-74.45, 40.50)[0], y: geo(-74.45, 40.50)[1] - 10, regionId: 'under', danger: 3, services: ['supply'], description: '新布朗斯维克的旧大学校园，电脑和教学设备早被搬空，只剩书。' },
      { id: 'redmist', name: '红雾荒原', kind: 'wild', x: geo(-75.12, 40.26)[0], y: geo(-75.12, 40.26)[1], regionId: 'redmist', danger: 5, description: '踩上去像雪的灰白辐射粉尘，扭曲的建筑残骸上长着辐射苔藓。' },
      { id: 'radiation', name: '辐射区', kind: 'wild', x: geo(-75.25, 40.36)[0], y: geo(-75.25, 40.36)[1], regionId: 'redmist', danger: 5, description: '全套防化装备也只能撑四个小时，辐射晶石的产地。' },
      { id: 'mforest', name: '变异森林', kind: 'wild', x: geo(-74.66, 39.965)[0], y: geo(-74.66, 39.965)[1], regionId: 'mutant', danger: 4, links: { events: [{ eventId: 'mutant_fight', packId: 'world:wasteland_apocalypse:events' }] }, description: '树干长满发光真菌、叶子发紫发蓝的松林，净化者进去采药每次都是九死一生。' },
      { id: 'nest', name: '变异兽巢穴', kind: 'cave', x: geo(-74.47, 39.905)[0], y: geo(-74.47, 39.905)[1], regionId: 'mutant', danger: 5, description: '松林深处的巢穴，三支武装小队进去，没有一个人回来。' },
    ],
    routes: [
      { id: 'x_rust_tavern', from: 'rusttown', to: 'tavern', kind: 'trail', name: '镇中街' },
      { id: 'x_rust_purify', from: 'rusttown', to: 'purify', kind: 'road', name: '净水塔下' },
      { id: 'x_rust_line13', from: 'rusttown', to: 'line13', kind: 'road', name: '地铁口' },
      { id: 'x_line13_market', from: 'line13', to: 'rustmarket', kind: 'rail', name: '十三号线 · 七号站方向', danger: 2, path: along(line13, [rx + 6, ry + 20], geo(-74.86, 40.15), 12) },
      { id: 'x_market_clinic', from: 'rustmarket', to: 'clinic', kind: 'rail', name: '十三号线 · 三号站方向', danger: 2, path: along(line13, geo(-74.86, 40.15), geo(-75.06, 40.03), 12) },
      { id: 'x_clinic_metro', from: 'clinic', to: 'oldmetro', kind: 'rail', name: '塌方隧道', danger: 3, path: along(line13, geo(-75.06, 40.03), geo(-75.15, 39.955), 10) },
      { id: 'x_line13_school', from: 'line13', to: 'school', kind: 'rail', name: '十三号线 · 北段', danger: 3, path: along(line13, [rx + 6, ry + 20], geo(-74.47, 40.46), 14) },
      { id: 'x_rust_redmist', from: 'rusttown', to: 'redmist', kind: 'trail', name: '风蚀沟', danger: 4, path: [geo(-74.86, 40.25), geo(-75.0, 40.27)] },
      { id: 'x_redmist_rad', from: 'redmist', to: 'radiation', kind: 'trail', danger: 5 },
      { id: 'x_rust_slave', from: 'rusttown', to: 'slavemarket', kind: 'trail', name: '废车场', danger: 3 },
      { id: 'x_rust_library', from: 'rusttown', to: 'library', kind: 'road', name: '一号公路', path: along(us1, [rx, ry], geo(-74.66, 40.35), 8) },
      { id: 'x_library_school', from: 'library', to: 'school', kind: 'road', name: '一号公路', path: along(us1, geo(-74.66, 40.35), geo(-74.45, 40.49), 8) },
      { id: 'x_rust_super', from: 'rusttown', to: 'supermarket', kind: 'road', name: 'I-95', danger: 2, path: along(i95, [rx, ry], geo(-74.95, 40.10), 10) },
      { id: 'x_super_clinic', from: 'supermarket', to: 'clinic', kind: 'trail', danger: 2 },
      { id: 'x_rust_ruins', from: 'clinic', to: 'ruins', kind: 'road', name: '旧国道', danger: 2, path: along(i95, geo(-75.06, 40.03), geo(-75.15, 39.95), 8) },
      { id: 'x_ruins_metro', from: 'ruins', to: 'oldmetro', kind: 'trail' },
      { id: 'x_ruins_hospital', from: 'ruins', to: 'hospital', kind: 'road', name: '市场街' },
      { id: 'x_ruins_factory', from: 'ruins', to: 'factory', kind: 'road', name: '富兰克林大桥', danger: 2 },
      { id: 'x_ruins_base', from: 'ruins', to: 'base', kind: 'road', name: '南布罗德街', danger: 4 },
      { id: 'x_slave_sub', from: 'slavemarket', to: 'substation', kind: 'road', name: 'I-295', danger: 3 },
      { id: 'x_sub_housing', from: 'substation', to: 'housing', kind: 'road', danger: 3 },
      { id: 'x_housing_factory', from: 'housing', to: 'factory', kind: 'road', name: '70号公路', danger: 3 },
      { id: 'x_housing_forest', from: 'housing', to: 'mforest', kind: 'trail', name: '林缘', danger: 3 },
      { id: 'x_slave_forest', from: 'slavemarket', to: 'mforest', kind: 'trail', name: '松林北缘', danger: 4 },
      { id: 'x_forest_nest', from: 'mforest', to: 'nest', kind: 'trail', danger: 5 },
    ],
    features,
  };
}
