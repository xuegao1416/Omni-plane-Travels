/**
 * 荒岛求生 · 无名岛海图。照世界书排：北端是休眠火山锥（火山口积水成湖、西北缘是望崖），
 * 中部是热带雨林，青藤谷是一条东西走向的河谷、溪流向西入海；南岸是弧形的新月滩，
 * 东侧礁石区与椰林、西侧石灰岩泉眼，南面一圈珊瑚礁，东岸有退潮才露出来的海底洞穴。
 * 海岸线约十公里，比例约 1 单位 = 4.5 米。
 */
import type { MapFeature, MapModuleSchema } from '../../domains/map/types';
import { along, area, blob, label, land, offset, river, road, water, wobble } from './draw';

export function buildIslandMap(): MapModuleSchema {
  const features: MapFeature[] = [];
  const coast = wobble([
    [470, 64], [560, 72], [640, 104], [702, 156], [762, 226], [818, 296], [852, 368], [842, 440], [802, 500], [742, 542], [684, 578], [642, 612],
    [600, 630], [566, 606], [522, 592], [480, 590], [440, 596], [404, 612], [378, 632], [318, 630], [254, 594], [204, 542], [168, 470], [160, 398],
    [190, 328], [240, 258], [300, 188], [360, 128], [410, 88],
  ], 15, 1907, 8, true);
  features.push(land(coast));

  // 南面一圈珊瑚礁与东侧礁石区（浅滩）
  const southShore = along(coast, [250, 600], [700, 570], 60);
  features.push(water([...offset(southShore, -26), ...offset(southShore, -78).reverse()], 'sea', undefined, 'shallow'));
  features.push(water(blob(626, 612, 30, 12, 1909, 0.3, 22, -0.3), 'sea', undefined, 'shallow'));
  features.push(water(blob(852, 410, 18, 30, 1910, 0.3, 22), 'sea', undefined, 'shallow'));

  // 地貌：雨林、火山锥（裸露的火山砾）、沙滩
  features.push(area(offset(coast, -14), 'forest'));
  const cone = blob(505, 160, 128, 92, 1912, 0.1, 40, 0.1);
  features.push(area(cone, 'mountains'));
  features.push(area(blob(505, 150, 52, 36, 1913, 0.14, 28), 'wasteland'));
  features.push(water(blob(505, 146, 12, 9, 1914, 0.2, 18), 'lake'));
  features.push(area(wobble([[372, 628], [404, 604], [440, 586], [480, 582], [522, 584], [566, 598], [604, 622], [640, 606], [660, 588], [610, 586], [566, 572], [520, 566], [478, 566], [436, 570], [398, 584], [366, 606]], 2, 1915, 6, true), 'plains', 'beach'));
  features.push(area(blob(560, 566, 26, 12, 1916, 0.2, 18), 'forest', 'park'));

  // 青藤谷的溪流：火山东南坡发源，沿谷地往西入海
  const stream = wobble([[640, 300], [600, 340], [560, 372], [510, 394], [460, 400], [410, 396], [350, 404], [290, 418], [230, 432], [176, 446]], 5, 1917, 8);
  features.push(river(stream, 3.2, '青藤溪'));
  features.push(river(wobble([[548, 238], [560, 290], [570, 340]], 2, 1918, 8), 1.4));

  // 小径
  const valleyTrail = wobble([[482, 588], [480, 540], [470, 490], [474, 446], [480, 404]], 3, 1920, 7);
  const volcanoTrail = wobble([[480, 404], [520, 352], [534, 300], [524, 246], [500, 200], [470, 160], [452, 128]], 3, 1921, 7);
  const eastTrail = wobble([[482, 588], [530, 586], [560, 578], [600, 590], [640, 600], [700, 560], [760, 500], [812, 430], [820, 402]], 3, 1922, 8);
  features.push(road(valleyTrail, 'path'), road(volcanoTrail, 'path'), road(eastTrail, 'path'), road(wobble([[482, 588], [440, 590], [396, 596]], 2, 1923, 6), 'path'));
  features.push(road(wobble([[480, 404], [440, 400], [400, 394]], 2, 1924, 6), 'path'), road(wobble([[505, 156], [470, 140], [452, 128]], 2, 1925, 6), 'path'));
  features.push(label(880, 610, '外  海', 'water'));

  return {
    version: 1,
    title: '无名岛海图',
    theme: 'modern',
    landform: 'island',
    scale: 'region',
    metersPerUnit: 4.5,
    seed: 20190712,
    width: 1000,
    height: 700,
    fog: true,
    travel: { minutesPerUnit: 0.21 },
    startLocationId: 'crescent',
    regions: [
      { id: 'volcano', name: '火山锥', terrain: 'mountains', x: 505, y: 160, radius: 130, danger: 2, color: '#d64f6a', effects: [{ target: 'map.travel.time', mode: 'mult', value: 1.35, label: '火山坡陡' }], description: '岛屿北端的休眠火山，坡面全是松散的火山砾和蕨类。' },
      { id: 'jungle', name: '雨林', terrain: 'forest', x: 560, y: 340, radius: 170, danger: 1, color: '#2f9e6f', encounters: ['受惊的野猪'], description: '岛屿中部浓密的热带雨林，阳光难以穿透，野猪与毒蛇出没。' },
      { id: 'valley', name: '青藤谷', terrain: 'forest', x: 420, y: 404, radius: 110, danger: 1, color: '#7a8a3a', description: '东西走向的河谷，溪流常年不断，是岛上最重要的资源区。' },
      { id: 'beach', name: '新月滩', terrain: 'plains', x: 490, y: 588, radius: 100, color: '#d9822b', description: '飞机残骸坠落的弧形沙滩，白沙细软，椰树成排。' },
      { id: 'reef', name: '珊瑚礁', terrain: 'sea', x: 500, y: 664, radius: 130, danger: 3, color: '#2aa3b8', description: '环绕南端的珊瑚礁，退潮时露出水面，藤壶锋利。' },
      { id: 'eastcoast', name: '东岸', terrain: 'hills', x: 790, y: 410, radius: 110, danger: 2, color: '#8e5bd8', description: '礁石、悬崖与海湾交错的东海岸，海底洞穴就在这里。' },
    ],
    locations: [
      { id: 'crescent', name: '新月滩', aliases: ['营地', '初期营地'], kind: 'camp', x: 482, y: 588, regionId: 'beach', known: true, services: ['rest', 'supply'], links: { gather: [{ id: 'food', bonus: 1.1 }, { id: 'water', bonus: 1.2 }, { id: 'wood', bonus: 1.2 }] }, description: '飞机残骸旁的最初营地，弧形沙滩长约两百米，六棵高大椰树遮阴。' },
      { id: 'wreck', name: '飞机残骸', aliases: ['残骸', '机尾', '应急电台'], kind: 'ruin', x: 544, y: 600, regionId: 'beach', known: true, danger: 1, links: { gather: [{ id: 'stone', bonus: 1.2 }, { id: 'cloth', bonus: 1.4 }], events: [{ eventId: 'rescue_signal', packId: 'world:stranded_island:events' }] }, description: '散落在沙滩上的机身与座椅，机尾那台坏掉的应急电台修好了就能求救。' },
      { id: 'palm', name: '椰林', kind: 'landmark', x: 564, y: 562, regionId: 'beach', links: { gather: [{ id: 'food', bonus: 1.5 }, { id: 'wood', bonus: 1.3 }] }, description: '沙滩东侧的椰林，每天最多采两颗椰子，椰壳、椰肉、椰纤维都用得上。' },
      { id: 'eastbeach', name: '海滩东侧', aliases: ['礁石区'], kind: 'landmark', x: 628, y: 604, regionId: 'beach', links: { gather: [{ id: 'food', bonus: 1.3 }, { id: 'stone', bonus: 1.2 }] }, description: '绵延约八十米的礁石区，退潮时捡海螺、蛤蜊和螃蟹。' },
      { id: 'westbeach', name: '海滩西侧', aliases: ['泉眼'], kind: 'landmark', x: 396, y: 598, regionId: 'beach', links: { gather: [{ id: 'water', bonus: 1.5 }, { id: 'wood', bonus: 1.2 }] }, description: '石灰岩层下渗出的淡水泉眼，退潮时裸露，每天两三单位淡水。' },
      { id: 'coral', name: '珊瑚礁', kind: 'landmark', x: 470, y: 662, regionId: 'reef', danger: 2, links: { gather: [{ id: 'food', bonus: 1.6 }] }, description: '退潮时露出的礁盘，缝隙里常有搁浅的小鱼。' },
      { id: 'edge', name: '丛林边缘', kind: 'wild', x: 478, y: 530, regionId: 'beach', danger: 1, links: { gather: [{ id: 'wood', bonus: 1.4 }, { id: 'herb', bonus: 1.2 }] }, description: '沙滩与丛林的过渡带，野果和草药多，毒蛇也多。' },
      { id: 'valley', name: '青藤谷', kind: 'camp', x: 480, y: 404, regionId: 'valley', danger: 1, services: ['rest'], links: { gather: [{ id: 'water', bonus: 1.4 }, { id: 'wood', bonus: 1.5 }] }, description: '翻过低矮山脊就到的河谷，两岸植被茂密，是资源区也是风险区。' },
      { id: 'stream', name: '淡水溪流', aliases: ['溪流', '青藤溪'], kind: 'landmark', x: 398, y: 392, regionId: 'valley', links: { gather: [{ id: 'water', bonus: 1.7 }] }, description: '每小时约一桶水，清澈但必须煮沸——上游有野猪。两岸枯木约五十单位。' },
      { id: 'jungle', name: '丛林深处', kind: 'wild', x: 612, y: 330, regionId: 'jungle', danger: 3, links: { gather: [{ id: 'food', bonus: 1.4 }, { id: 'herb', bonus: 1.6 }] }, description: '野猪、毒蛇和昆虫的地盘，能吃的和有毒的植物长得一模一样。' },
      { id: 'slope', name: '火山坡', kind: 'wild', x: 532, y: 262, regionId: 'volcano', danger: 3, links: { gather: [{ id: 'stone', bonus: 1.7 }] }, description: '松散的火山砾坡，有几个小洞穴能临时避雨，攀爬极耗体力。' },
      { id: 'crater', name: '火山口', kind: 'landmark', x: 505, y: 156, regionId: 'volcano', danger: 3, links: { gather: [{ id: 'water', bonus: 1.3 }, { id: 'stone', bonus: 1.5 }] }, description: '直径约五十米的火山口积水成小湖，四周散落着锋利的黑曜石。' },
      { id: 'cliff', name: '火山望崖', aliases: ['望崖'], kind: 'landmark', x: 452, y: 126, regionId: 'volcano', danger: 2, links: { gather: [{ id: 'stone', bonus: 1.4 }] }, description: '岛上最高的瞭望点，晴天能看到方圆四十公里的海面，提前六到八小时看见风暴。' },
      { id: 'seacave', name: '海底洞穴', kind: 'cave', x: 830, y: 404, regionId: 'eastcoast', danger: 3, links: { gather: [{ id: 'water', bonus: 2 }] }, description: '退潮时入口才露出水面，里面干燥通风，深处有岛上最好的泉眼。' },
    ],
    routes: [
      { id: 'i_camp_wreck', from: 'crescent', to: 'wreck', kind: 'trail', name: '残骸下' },
      { id: 'i_camp_palm', from: 'crescent', to: 'palm', kind: 'trail', name: '沙滩东段', path: along(eastTrail, [482, 588], [560, 578], 6) },
      { id: 'i_palm_east', from: 'palm', to: 'eastbeach', kind: 'trail', path: [[600, 590]] },
      { id: 'i_camp_west', from: 'crescent', to: 'westbeach', kind: 'trail', name: '沙滩西段', path: [[440, 590]] },
      { id: 'i_camp_coral', from: 'crescent', to: 'coral', kind: 'trail', name: '礁盘小径', danger: 2 },
      { id: 'i_east_coral', from: 'eastbeach', to: 'coral', kind: 'trail', danger: 1, path: [[560, 650]] },
      { id: 'i_east_cave', from: 'eastbeach', to: 'seacave', kind: 'trail', name: '退潮礁道', danger: 3, path: along(eastTrail, [640, 600], [820, 402], 12) },
      { id: 'i_camp_edge', from: 'crescent', to: 'edge', kind: 'trail', name: '林口', path: along(valleyTrail, [482, 588], [478, 530], 4) },
      { id: 'i_west_edge', from: 'westbeach', to: 'edge', kind: 'trail', path: [[430, 560]] },
      { id: 'i_edge_valley', from: 'edge', to: 'valley', kind: 'trail', name: '翻山小径', danger: 1, path: along(valleyTrail, [478, 530], [480, 404], 8) },
      { id: 'i_valley_stream', from: 'valley', to: 'stream', kind: 'trail', path: [[440, 400]] },
      { id: 'i_valley_jungle', from: 'valley', to: 'jungle', kind: 'trail', name: '藤蔓道', danger: 2, path: [[540, 380], [580, 352]] },
      { id: 'i_jungle_slope', from: 'jungle', to: 'slope', kind: 'mountain', name: '火山渣坡', danger: 3, cost: { resources: { water: 1 } }, path: [[580, 300]] },
      { id: 'i_valley_slope', from: 'valley', to: 'slope', kind: 'mountain', name: '山脊捷径', danger: 2, cost: { resources: { water: 1 } }, path: along(volcanoTrail, [480, 404], [532, 262], 8) },
      { id: 'i_slope_crater', from: 'slope', to: 'crater', kind: 'trail', name: '火山口缘', danger: 2, path: along(volcanoTrail, [532, 262], [500, 200], 6) },
      { id: 'i_crater_cliff', from: 'crater', to: 'cliff', kind: 'trail', danger: 2, path: [[470, 140]] },
      { id: 'i_jungle_crater', from: 'jungle', to: 'crater', kind: 'mountain', name: '火山背坡', danger: 4, cost: { resources: { water: 1.5 } }, path: [[640, 250], [590, 190]] },
    ],
    features,
  };
}

