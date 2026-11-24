/**
 * 世界地图（map）模块的数据结构。
 *
 * 世界定义里只存静态地图（WorldModule.moduleConfig，moduleId = 'map'）；
 * 存档里的 `state.map` 只记录当前位置、已发现/已到访的地点和游戏中新出现的地点。
 * 坐标是地图单位：x 从西到东、y 从北到南，默认画布 1000 × 700。
 */

/** 画风：古卷（古代 / 武侠 / 西幻）、现代测绘、科幻星图。 */
export type MapTheme = 'ancient' | 'modern' | 'scifi';
export type MapThemeSetting = MapTheme | 'auto';

/** 地图尺度：决定默认赶路速度（大陆按天、城区按分钟）。 */
export type MapScale = 'world' | 'region' | 'city';

/** 大地形：地图边缘是海、群岛还是内陆；space 为星域。 */
export type MapLandform = 'continent' | 'island' | 'archipelago' | 'coast' | 'inland' | 'space';

export type MapTerrain =
  | 'sea' | 'lake' | 'plains' | 'farmland' | 'forest' | 'hills' | 'mountains' | 'snow'
  | 'desert' | 'swamp' | 'urban' | 'wasteland' | 'void' | 'nebula' | 'asteroid';

export type MapLocationKind =
  | 'capital' | 'city' | 'town' | 'village' | 'fortress' | 'port' | 'temple' | 'academy'
  | 'market' | 'station' | 'ruin' | 'cave' | 'landmark' | 'camp' | 'wild' | 'home';

export type MapRouteKind =
  | 'road' | 'trail' | 'mountain' | 'river' | 'sea' | 'rail' | 'highway' | 'air' | 'warp' | 'secret';

/** 地点提供的服务：rest 可以休整（恢复体力、推进时间）。 */
export type MapService = 'rest' | 'trade' | 'heal' | 'train' | 'supply';

/**
 * 地区或地点给其他模块的修正（统一加成系统 core/modifiers.ts）：
 * 主角身处此地时生效，离开即失效。target 如 `resources.upkeep.water`、`economy.price.sell`、
 * `dice.check`、`stat.dim3`、`map.travel.time`。
 */
export interface MapEffect {
  target: string;
  /** flat 为加减值；mult 为倍率增量（0.2 = +20%）。 */
  mode?: 'flat' | 'mult';
  value: number;
  label?: string;
}

export interface MapRegion {
  id: string;
  name: string;
  terrain: MapTerrain;
  /** 中心与影响半径（地图单位）。地形由各地区的影响范围混合生成。 */
  x: number;
  y: number;
  radius: number;
  description?: string;
  /** 0~5。 */
  danger?: number;
  /** 控制此地的势力名（对应世界书的势力条目）。 */
  faction?: string;
  /** 边界与地名的强调色（#rrggbb）。 */
  color?: string;
  /** 推荐的成长阶段（段位序号 / 等级）。 */
  minTier?: number;
  effects?: MapEffect[];
  /** 伏击时出现的敌人身份（启用战斗模块时）。 */
  encounters?: string[];
}

/** 地点与其他模块的关联。 */
export interface MapLocationLinks {
  /** 经营模块的市场 id：身处此地即可在这些市场交易。 */
  markets?: string[];
  /** 经营模块的产业 id（显示在地图上）。 */
  holdings?: string[];
  /** 生存资源 id：此地可采集，bonus 为采集量倍率增量（0.5 = +50%）。 */
  gather?: Array<{ id: string; bonus?: number }>;
  /** 首次到达时弹出的事件卡（世界事件包里的卡）。 */
  events?: Array<{ eventId: string; packId?: string; repeat?: boolean }>;
  /** 职业 id：这里有该职业的会馆 / 导师。 */
  professions?: string[];
  /** 对应的世界书条目（comment），默认按地名匹配。 */
  lore?: string;
}

export interface MapLocation {
  id: string;
  name: string;
  kind: MapLocationKind;
  x: number;
  y: number;
  regionId?: string;
  description?: string;
  aliases?: string[];
  /** 开局就知道的地点；其余地点要走到附近、听人说起或在正文里出现后才显示。 */
  known?: boolean;
  /** 0~5。 */
  danger?: number;
  minTier?: number;
  services?: MapService[];
  /** 休整一次的花费（主货币）。 */
  restPrice?: number;
  effects?: MapEffect[];
  links?: MapLocationLinks;
  /** 游戏中由正文或 AI 新增的地点。 */
  origin?: 'world' | 'story';
}

export interface MapRoute {
  id: string;
  from: string;
  to: string;
  kind: MapRouteKind;
  name?: string;
  /** 赶路时长（分钟）；不写时按距离、路况与地图尺度估算。 */
  minutes?: number;
  /** 0~5：危险的路要过检定，可能遇到伏击。 */
  danger?: number;
  /** 检定属性（dim1~dim6 或属性名）与难度。 */
  check?: { stat?: string; dc?: number };
  cost?: { stamina?: number; currency?: number; resources?: Record<string, number> };
  requires?: { professions?: string[]; item?: string; minTier?: number };
  /** 隐秘路线：发现之前不显示、不能走。 */
  hidden?: boolean;
  oneWay?: boolean;
  /** 途经点（不含两端）：路线沿真实道路走，画法与路程都按这条折线算。 */
  path?: Array<[number, number]>;
}

/**
 * 手绘地理要素：地图上的水面、陆地轮廓、地块、河流、道路、铁路、边界、建筑与注记。
 * 水面 / 陆地 / 地块 / 河流会改写地形（2D 底图与 3D 沙盘一致），其余只画出来，不参与赶路结算。
 * - water：水面多边形（terrain 'lake' 为湖、默认海；level 'shallow' 为浅滩礁盘）
 * - land：陆地轮廓多边形（有任何 land 时，岛屿 / 群岛 / 海岸地图以它为海岸线）
 * - area：地块多边形，terrain 决定地貌；level 细分用途（park / campus / industrial / beach / sports / cemetery）
 * - river：河流折线，width 为河宽
 * - road：道路折线，level 为 highway / major / street / path
 * - rail：铁路折线，level 'metro' 为地铁（可写 color），'tunnel' 为隧道段
 * - border：边界折线，level 'national' 为国界（默认），'region' 为区界，'wall' 为城墙 / 长城
 * - building：建筑轮廓多边形（城区尺度），height 为层高倍数
 * - label：注记，只用第一个点；level 'country' / 'district' / 'water' / 'peak'
 */
export type MapFeatureKind = 'water' | 'land' | 'area' | 'river' | 'road' | 'rail' | 'border' | 'building' | 'label';

export interface MapFeature {
  kind: MapFeatureKind;
  points: Array<[number, number]>;
  name?: string;
  terrain?: MapTerrain;
  level?: string;
  /** 河宽 / 路宽（地图单位）。 */
  width?: number;
  /** 地铁线等的颜色（#rrggbb）。 */
  color?: string;
  /** 建筑高度倍数（1 ≈ 普通多层）。 */
  height?: number;
}

export interface MapTravelSettings {
  /** 每个地图单位的步行分钟数；不写时按尺度给默认值。 */
  minutesPerUnit?: number;
  /** 每小时赶路消耗的体力（启用数值属性时）。 */
  staminaPerHour?: number;
  /** 每 8 小时赶路额外消耗的物资（启用生存资源时），如 { food: 1 }。 */
  supplies?: Record<string, number>;
  /** 危险路线是否可能遇到伏击（启用战斗模块时）。 */
  ambush?: boolean;
}

/** 世界定义里的地图（moduleConfig）。 */
export interface MapModuleSchema {
  version: 1;
  title?: string;
  theme: MapThemeSetting;
  landform: MapLandform;
  scale: MapScale;
  /** 地形噪声种子：同一种子总是生成同一片山川。 */
  seed: number;
  width: number;
  height: number;
  /** 迷雾：只显示已知与走过的地方。 */
  fog?: boolean;
  startLocationId?: string;
  regions: MapRegion[];
  locations: MapLocation[];
  routes: MapRoute[];
  travel?: MapTravelSettings;
  /** 手绘地理要素（内置世界的地图用它画出真实的海岸、河流与街道）。 */
  features?: MapFeature[];
  /** 1 个地图单位代表多少米（比例尺与 3D 楼高用）；不写时按尺度：城区 10、一方 50、天下 200。 */
  metersPerUnit?: number;
}

export interface MapTrailEntry {
  from?: string;
  to: string;
  turn: number;
  minutes: number;
  via: 'travel' | 'story' | 'start';
}

/** 存档里的地图进度（state.map）。 */
export interface MapRuntimeState {
  version: 1;
  current?: string;
  discovered: string[];
  visited: string[];
  /** 已发现的隐秘路线 id。 */
  routes: string[];
  /** 游戏中新出现的地点与路线。 */
  extraLocations: MapLocation[];
  extraRoutes: MapRoute[];
  trail: MapTrailEntry[];
  /** 已经触发过的到达事件 `${locationId}/${eventId}`。 */
  fired: string[];
}

export const MAP_TERRAINS: readonly MapTerrain[] = [
  'sea', 'lake', 'plains', 'farmland', 'forest', 'hills', 'mountains', 'snow',
  'desert', 'swamp', 'urban', 'wasteland', 'void', 'nebula', 'asteroid',
];

export const MAP_LOCATION_KINDS: readonly MapLocationKind[] = [
  'capital', 'city', 'town', 'village', 'fortress', 'port', 'temple', 'academy',
  'market', 'station', 'ruin', 'cave', 'landmark', 'camp', 'wild', 'home',
];

export const MAP_ROUTE_KINDS: readonly MapRouteKind[] = [
  'road', 'trail', 'mountain', 'river', 'sea', 'rail', 'highway', 'air', 'warp', 'secret',
];

export const MAP_SERVICES: readonly MapService[] = ['rest', 'trade', 'heal', 'train', 'supply'];

export const TERRAIN_LABELS: Record<MapTerrain, string> = {
  sea: '海域', lake: '湖泽', plains: '平原', farmland: '田野', forest: '森林', hills: '丘陵', mountains: '山脉', snow: '雪原',
  desert: '荒漠', swamp: '沼泽', urban: '城区', wasteland: '废土', void: '虚空', nebula: '星云', asteroid: '小行星带',
};

export const LOCATION_KIND_LABELS: Record<MapLocationKind, string> = {
  capital: '都城', city: '城市', town: '城镇', village: '村落', fortress: '要塞', port: '港口', temple: '寺庙圣所', academy: '学府',
  market: '集市', station: '驿站', ruin: '遗迹', cave: '洞窟', landmark: '名胜', camp: '营地', wild: '秘境', home: '居所',
};

export const ROUTE_KIND_LABELS: Record<MapRouteKind, string> = {
  road: '官道', trail: '小径', mountain: '山道', river: '水路', sea: '航线', rail: '铁路', highway: '公路', air: '航空', warp: '跃迁', secret: '密道',
};

export const SERVICE_LABELS: Record<MapService, string> = {
  rest: '休整', trade: '交易', heal: '疗伤', train: '修习', supply: '补给',
};

export const THEME_LABELS: Record<MapTheme, string> = { ancient: '古卷', modern: '测绘', scifi: '星图' };
export const LANDFORM_LABELS: Record<MapLandform, string> = {
  continent: '大陆', island: '岛屿', archipelago: '群岛', coast: '海岸', inland: '内陆', space: '星域',
};
export const SCALE_LABELS: Record<MapScale, string> = { world: '天下', region: '一方', city: '城区' };

/** 现代与星图用的叫法（「官道」「天下」是古卷的说法）。 */
const ROUTE_KIND_THEME_LABELS: Partial<Record<MapTheme, Partial<Record<MapRouteKind, string>>>> = {
  modern: { road: '道路', trail: '步道', mountain: '山路', river: '水路', sea: '航线', secret: '小道' },
  scifi: { road: '航道', trail: '支线航道', mountain: '险峻航道', river: '星流', sea: '星海航线', secret: '隐秘航道' },
};
const SCALE_THEME_LABELS: Partial<Record<MapTheme, Record<MapScale, string>>> = {
  modern: { world: '全境', region: '区域', city: '城区' },
  scifi: { world: '星区', region: '星系', city: '站区' },
};

export function routeKindLabel(kind: MapRouteKind, theme?: MapTheme): string {
  return (theme ? ROUTE_KIND_THEME_LABELS[theme]?.[kind] : undefined) ?? ROUTE_KIND_LABELS[kind];
}

export function scaleName(scale: MapScale, theme?: MapTheme): string {
  return (theme ? SCALE_THEME_LABELS[theme]?.[scale] : undefined) ?? SCALE_LABELS[scale];
}
