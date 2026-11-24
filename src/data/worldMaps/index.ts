/**
 * 六个内置世界的地图（世界地图模块的 moduleConfig）。
 * 地图归内置定义所有：worldLoader 把它挂到 worlds.json 的世界上，
 * 存档快照与本地副本（改过职业绑定、世界书的内置世界）读出来时也总是换成这里的最新版。
 */
import type { MapModuleSchema } from '../../domains/map/types';
import { buildBorderTradeMap } from './borderTrade';
import { buildWuxiaMap } from './wuxia';
import { buildWastelandMap } from './wasteland';
import { buildIslandMap } from './island';
import { buildSchoolMap } from './school';
import { buildMetropolisMap } from './metropolis';

export interface BuiltinWorldMap {
  description: string;
  build: () => MapModuleSchema;
}

export const BUILTIN_WORLD_MAPS: Record<string, BuiltinWorldMap> = {
  wuxia_world: { description: '江湖全图：照真实山川排布——黄河、长江与洞庭，洛阳少林居中原，华山终南在秦岭北麓，金陵在江南，长城以北是北疆与大漠，南海深处一座孤岛。', build: buildWuxiaMap },
  wasteland_apocalypse: { description: '旧纽约—费城走廊的废土：铁锈镇与地下十三号线，红雾荒原在旧费城以北，南费城的军械库归钢铁黎明，变异森林在新泽西南部，东边是大西洋。', build: buildWastelandMap },
  stranded_island: { description: '困住你们的无名岛：北端火山锥与望崖，中部雨林与青藤谷的溪流，南岸弧形的新月滩、东侧礁石与椰林、西侧泉眼，南面一圈珊瑚礁，东岸的海底洞穴。哪个点能取到什么，图上标着。', build: buildIslandMap },
  japanese_school: { description: '海边小镇上的樱丘高校：L 形主教学楼、社团活动楼、旧校舍、操场与泳池；正门坡道下去是樱坂通商店街，樱川的河川敷、山丘上的神社和樱丘湾的海边都在步行范围里。', build: buildSchoolMap },
  desire_metropolis: { description: '焰江穿城的南方大都市：南岸城中村里的出租屋、楼下便利店与宠物医院、菜市场和江边夜市，北岸金融城的写字楼、商场与湿地公园，地铁一号线钻过江底。', build: buildMetropolisMap },
  border_trade: { description: '1993 年冬的绥芬河：青云市场、边贸一条街、火车站与口岸，过了国界就是格罗迭科沃。照网页地图的样子画，街道、铁路、国界都在。', build: buildBorderTradeMap },
};
