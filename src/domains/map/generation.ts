/**
 * 地图的 AI 生成：整张地图（世界编织、编辑器「AI 生成地图」）与补全坐标（把世界书里还没上图的地点放上去）。
 * 流程沿用 api/generateWithRepair：解析 → 校验 → 有错误交回 AI 修一次；
 * 修不好的小问题（越界、重叠、断开的路网、漏掉的地点）由 finalize 在本地补齐。
 * 没有 API 时 sketchMapFromLocations 按地名与描述在本地排出一张草图。
 */
import { guessLocationKind, hashString, normalizeMapConfig, resolveMapTheme, terrainOf } from './config';
import { allLocations, buildGraph, placeNear, spreadLocations, suggestRoutes } from './graph';
import {
  MAP_LOCATION_KINDS, MAP_ROUTE_KINDS, MAP_TERRAINS,
  type MapLandform, type MapLocation, type MapModuleSchema, type MapRegion, type MapTerrain, type MapThemeSetting,
} from './types';

export interface MapGenerationInput {
  worldName?: string;
  description: string;
  timePeriod?: string;
  atmosphere?: string;
  tags?: string[];
  /** 必须出现在地图上的地点（世界书的地理条目）。 */
  locations: Array<{ name: string; description?: string }>;
  factions?: Array<{ name: string; description?: string }>;
  theme?: MapThemeSetting;
  /** 可以挂接的其他模块条目（只把已启用模块的列出来）。 */
  links?: {
    markets?: Array<{ id: string; name: string }>;
    holdings?: Array<{ id: string; name: string }>;
    resources?: Array<{ id: string; name: string }>;
    professions?: Array<{ id: string; name: string }>;
    stats?: Array<{ id: string; name: string }>;
    tiers?: string[];
    events?: Array<{ eventId: string; packId?: string; name: string }>;
  };
}

export interface MapIssue {
  level: 'error' | 'warning';
  path: string;
  message: string;
}

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Rec : undefined;
}

/** 同一段 JSON 的几种修法：尾逗号、全角引号、注释、全角冒号逗号当分隔符（不太守格式的模型常见）。 */
function repairs(raw: string): string[] {
  const trailing = (value: string) => value.replace(/,\s*([}\]])/g, '$1');
  const base = trailing(raw);
  const quotes = base.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  const comments = trailing(base.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"\\])\/\/[^\n]*/g, '$1'));
  const punctuation = trailing(comments.replace(/"\s*：/g, '":').replace(/([\d"\]}el])\s*，(?=\s*["{[\d-])/g, '$1,'));
  return [...new Set([base, quotes, comments, punctuation])];
}

/** 取出第一个完整的 JSON 对象；输出到长度上限被截断时，退回最后一个完整的值，再补上没闭合的括号。 */
function closeTruncated(raw: string): string | undefined {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let cut = -1;
  let open: string[] = [];
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') stack.push(char === '{' ? '}' : ']');
    else if (char === '}' || char === ']') {
      stack.pop();
      // 最外层已经闭合：JSON 是完整的，后面跟着的说明文字不要。
      if (!stack.length) return raw.slice(0, index + 1);
      cut = index + 1;
      open = stack.slice();
    } else if (char === ',') {
      cut = index;
      open = stack.slice();
    }
  }
  if (!stack.length || cut < 0) return undefined;
  return raw.slice(0, cut).replace(/,\s*$/, '') + open.reverse().join('');
}

/** 套了一层的结果（{"map": {...}}、{"地图": {...}}）取出里面那张图。 */
function unwrapMap(value: unknown): Rec | undefined {
  const data = rec(value);
  if (!data || Array.isArray(data.locations)) return data;
  const inner = Object.values(data).map(rec).find(item => item && Array.isArray(item.locations));
  return inner ?? data;
}

/**
 * 容错解析：去掉推理模型的思考段，多个代码块时从最后一个开始试，
 * 修尾逗号、全角引号、注释与全角标点，截断的 JSON 补齐括号，套了一层的取出里面那张图。
 */
export function parseMapJson(text: string): Rec {
  const clean = text.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '').replace(/<\/?(think|thinking|reasoning)>/gi, '');
  const blocks = [...clean.matchAll(/```[a-zA-Z]*\s*([\s\S]*?)```/g)].map(match => match[1]!).reverse();
  let fallback: Rec | undefined;
  let lastError: unknown = new Error('没有找到 JSON 对象');
  for (const body of [...blocks, clean]) {
    const start = body.indexOf('{');
    if (start < 0) continue;
    const end = body.lastIndexOf('}');
    const attempts = end > start ? repairs(body.slice(start, end + 1)) : [];
    const closed = closeTruncated(body.slice(start));
    if (closed) attempts.push(...repairs(closed));
    for (const attempt of attempts) {
      try {
        const value = unwrapMap(JSON.parse(attempt));
        if (!value) { lastError = new Error('需要一个 JSON 对象'); continue; }
        if (Array.isArray(value.locations)) return value;
        fallback ??= value;
      } catch (error) { lastError = error; }
    }
  }
  if (fallback) return fallback;
  throw new Error(`JSON 语法错误：${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function bullet(items: Array<{ name: string; description?: string }>, limit: number, length = 60): string {
  return items.slice(0, limit).map(item => `- ${item.name}${item.description ? `：${item.description.replace(/\s+/g, ' ').slice(0, length)}` : ''}`).join('\n');
}

function linkLines(input: MapGenerationInput): string {
  const links = input.links ?? {};
  const lines: string[] = [];
  const idList = (items: Array<{ id: string; name: string }>) => items.slice(0, 20).map(item => `${item.id}=${item.name}`).join('、');
  if (links.markets?.length) lines.push(`- 市场（地点 links.markets 写 id，身处此地即可在该市场交易）：${idList(links.markets)}`);
  if (links.holdings?.length) lines.push(`- 产业（links.holdings）：${idList(links.holdings)}`);
  if (links.resources?.length) lines.push(`- 生存物资（地点 links.gather 写 [{"id","bonus"}]，bonus 为采集量加成 0.2~1；地区 effects 可写 {"target":"resources.upkeep.<id>","value":0.3} 表示此地消耗加快 30%）：${idList(links.resources)}`);
  if (links.professions?.length) lines.push(`- 职业（地点 links.professions 表示有该职业会馆；路线 requires.professions 表示只有该职业能走）：${idList(links.professions)}`);
  if (links.stats?.length) lines.push(`- 检定属性（路线 check.stat）：${idList(links.stats)}`);
  if (links.tiers?.length) lines.push(`- 成长阶段（地区/地点 minTier 写序号，0 为「${links.tiers[0]}」）：${links.tiers.slice(0, 10).map((name, index) => `${index}=${name}`).join('、')}`);
  if (links.events?.length) lines.push(`- 事件卡（地点 links.events 写 [{"eventId","packId"}]，首次到达时弹出）：${links.events.slice(0, 16).map(item => `${item.eventId}（${item.name}）`).join('、')}`);
  return lines.length ? `\n可以挂接的其他系统（只用列出的 id，没有合适的就不写）：\n${lines.join('\n')}\n` : '';
}

const SCHEMA_HINT = `{
  "title": "地图名",
  "theme": "ancient | modern | scifi",
  "landform": "continent | island | archipelago | coast | inland | space",
  "scale": "world | region | city",
  "regions": [{ "id": "英文id", "name": "地区名", "terrain": "地貌", "x": 0, "y": 0, "radius": 160, "danger": 0, "description": "20~40字", "effects": [] }],
  "locations": [{ "id": "英文id", "name": "地名", "kind": "类型", "x": 0, "y": 0, "regionId": "地区id", "description": "30~60字", "danger": 0, "known": false, "services": ["rest"], "links": {} }],
  "routes": [{ "from": "地点id", "to": "地点id", "kind": "路线类型", "danger": 0, "name": "可选", "path": [[0, 0]] }],
  "startLocationId": "地点id",
  "metersPerUnit": 50,
  "features": [{ "kind": "river", "name": "河名", "width": 4, "points": [[0, 0], [0, 0]] }]
}`;

/** AI 只画自然地理与边界；道路由路线来画，建筑太碎，都不让 AI 写。 */
const AI_FEATURE_KINDS = new Set(['land', 'water', 'river', 'area', 'border', 'label']);

function rules(): string {
  return [
    '坐标系：x 为 0~1000（西 → 东），y 为 0~700（北 → 南）。描述里说在北边的要放在上方、沿海的港口要靠近海域。',
    `terrain 只能是：${MAP_TERRAINS.join('/')}。星域地图（landform=space）的地区用 nebula/asteroid/void。`,
    `kind 只能是：${MAP_LOCATION_KINDS.join('/')}。`,
    `路线 kind 只能是：${MAP_ROUTE_KINDS.join('/')}；古代多用 road/trail/mountain/river/sea，现代用 road/highway/rail/air，星域用 warp/air。`,
    '路网必须连通：每个地点有 1~4 条路，不要所有地点都连到同一处；危险的路写 danger（1~5），隐秘小路写 "hidden": true。',
    '地区 4~8 个，radius 80~260，地区之间可以重叠但中心别挤在一起；海、湖也是地区（terrain = sea / lake），放在地图边缘或地点之间。',
    '地点之间至少相隔 30 个单位；都城/首府 known 设为 true；services 可选 rest/trade/heal/train/supply。',
    '路线拐弯时可以写 path：2~6 个途经点 [[x,y],…]（不含两端的地点），不写就是直线。',
    'metersPerUnit 是 1 个坐标单位代表多少米（画比例尺用）：city 2~10，region 20~150，world 200~3000。',
    'features 可选，用来把地图画得像真地图，没把握就整段省略：最多 12 条，每条 4~24 个点，坐标系同上，放在 JSON 最后。'
      + 'kind 只能是 land（陆地轮廓多边形：写了 land，land 以外全部是海，所以所有陆地和岛屿都要画进去，内陆地图不要写）/ water（湖或海湾的多边形，level 写 lake 或 sea）'
      + ' / river（河流折线，从源头画到入海口或地图边缘，width 2~8，可写 name）/ area（山地、森林、沙漠、城区等地块的多边形，terrain 取上面的地貌）'
      + ' / border（国界、州界或城墙折线，level 写 national / region / wall）/ label（单独的注记，1 个点，写 name，level 写 country / district / water / range）。'
      + '不要画道路和建筑，路线本身就是道路。',
  ].map(line => `- ${line}`).join('\n');
}

/** 整张地图的生成提示词。 */
export function buildMapGenerationPrompt(input: MapGenerationInput): string {
  const theme = input.theme && input.theme !== 'auto' ? input.theme : resolveMapTheme('auto', { name: input.worldName ?? '', description: input.description, tags: input.tags ?? [] });
  const count = Math.max(8, Math.min(16, input.locations.length + 6));
  return `你是一位擅长绘制游戏地图的制图师。请为下面的世界设计一张可游玩的地图，只输出 JSON。

世界：${input.worldName || '（未命名）'}
简介：${input.description.slice(0, 600)}
${input.timePeriod ? `时代：${input.timePeriod}\n` : ''}${input.atmosphere ? `氛围：${input.atmosphere}\n` : ''}${input.tags?.length ? `标签：${input.tags.join('、')}\n` : ''}建议画风：${theme}
${input.locations.length ? `\n必须出现在地图上的地点（名字保持不变，可以再补充别的地点）：\n${bullet(input.locations, 24)}\n` : ''}${input.factions?.length ? `\n势力（可写进地区的 faction）：\n${bullet(input.factions, 8, 40)}\n` : ''}${linkLines(input)}
要求：
- 一共 ${count} 个左右的地点，覆盖城市、野外、险地与有故事的地方。
${rules()}

JSON 结构：
${SCHEMA_HINT}`;
}

/** 补全坐标：把还没上图的地点放进已有地图。 */
export function buildMapPlacementPrompt(map: MapModuleSchema, pending: Array<{ name: string; description?: string }>, input: Pick<MapGenerationInput, 'worldName' | 'description'>): string {
  const regions = map.regions.map(region => `- ${region.id}「${region.name}」${region.terrain} 中心(${region.x},${region.y}) 半径${region.radius}`).join('\n');
  const placed = map.locations.map(location => `- ${location.id}「${location.name}」${location.kind} (${Math.round(location.x)},${Math.round(location.y)})`).join('\n');
  return `你是一位制图师。下面这张地图上已经有一些地区和地点，请把「待放置的地点」按它们的描述放到合适的位置，并接入路网。只输出 JSON。

世界：${input.worldName || '（未命名）'}：${input.description.slice(0, 300)}
坐标系：x 0~${map.width}（西 → 东），y 0~${map.height}（北 → 南）。

已有地区：
${regions || '（无）'}
已有地点：
${placed || '（无）'}

待放置的地点：
${bullet(pending, 30, 80)}

要求：
- 位置要符合描述与已有地点的关系；与已有地点至少相隔 30 个单位。
- kind 只能是：${MAP_LOCATION_KINDS.join('/')}；regionId 用已有地区的 id。
- 每个新地点用 routes 接到 1~3 个附近的地点（from/to 可以写地点 id 或地名），路线 kind 只能是：${MAP_ROUTE_KINDS.join('/')}。

JSON 结构：{ "locations": [{ "name", "x", "y", "kind", "regionId", "description" }], "routes": [{ "from", "to", "kind", "danger" }] }`;
}

/** 结构校验（生成 → 校验 → 修复用）。required 为必须出现的地名。 */
export function validateGeneratedMap(value: unknown, required: readonly string[] = [], options: { placement?: boolean } = {}): MapIssue[] {
  const issues: MapIssue[] = [];
  const data = rec(value);
  if (!data) return [{ level: 'error', path: '(整体)', message: '必须是一个 JSON 对象' }];
  const locations = Array.isArray(data.locations) ? data.locations : null;
  if (!locations) return [{ level: 'error', path: 'locations', message: 'locations 必须是数组' }];
  if (!options.placement && locations.length < 3) issues.push({ level: 'error', path: 'locations', message: '至少需要 3 个地点' });
  const names = new Map<string, number>();
  const keys = new Set<string>();
  locations.forEach((item, index) => {
    const location = rec(item);
    const name = typeof location?.name === 'string' ? location.name.trim() : '';
    if (!name) { issues.push({ level: 'error', path: `locations[${index}].name`, message: '地点缺少名字' }); return; }
    names.set(name, (names.get(name) ?? 0) + 1);
    keys.add(name);
    if (typeof location!.id === 'string') keys.add(location!.id);
    for (const axis of ['x', 'y'] as const) {
      // 写成字符串的数字（"x": "120"）规范化时会转成数字，不算错。
      const raw = location![axis];
      const value = typeof raw === 'string' && raw.trim() ? Number(raw) : raw;
      if (typeof value !== 'number' || !Number.isFinite(value)) issues.push({ level: 'error', path: `locations[${index}].${axis}`, message: `「${name}」的 ${axis} 必须是数字` });
    }
    if (typeof location!.kind === 'string' && !(MAP_LOCATION_KINDS as readonly string[]).includes(location!.kind)) {
      issues.push({ level: 'warning', path: `locations[${index}].kind`, message: `「${name}」的 kind「${location!.kind}」不在允许的类型里` });
    }
  });
  for (const [name, count] of names) if (count > 1) issues.push({ level: 'error', path: 'locations', message: `地点「${name}」出现了 ${count} 次` });
  for (const name of required) if (!names.has(name)) issues.push({ level: 'error', path: 'locations', message: `缺少必须出现的地点「${name}」` });
  if (!options.placement) {
    const regions = Array.isArray(data.regions) ? data.regions : [];
    if (!regions.length) issues.push({ level: 'error', path: 'regions', message: '至少需要 1 个地区' });
    regions.forEach((item, index) => {
      const region = rec(item);
      if (typeof region?.terrain === 'string' && !(MAP_TERRAINS as readonly string[]).includes(region.terrain)) {
        // 「海洋」「山地」这类别称规范化时认得出来，只提醒；认不出来的才要 AI 改。
        issues.push({ level: terrainOf(region.terrain) ? 'warning' : 'error', path: `regions[${index}].terrain`, message: `terrain「${region.terrain}」不合法，只能是 ${MAP_TERRAINS.join('/')}` });
      }
    });
  }
  const routes = Array.isArray(data.routes) ? data.routes : [];
  if (!options.placement && !routes.length) issues.push({ level: 'error', path: 'routes', message: '需要路线把地点连起来' });
  routes.forEach((item, index) => {
    const route = rec(item);
    for (const end of ['from', 'to'] as const) {
      const key = typeof route?.[end] === 'string' ? (route[end] as string) : '';
      if (!options.placement && (!key || !keys.has(key))) issues.push({ level: 'error', path: `routes[${index}].${end}`, message: `路线端点「${key || '空'}」不是已有地点` });
    }
  });
  return issues;
}

export function buildMapRepairPrompt(issues: readonly MapIssue[]): string {
  const lines = issues.filter(issue => issue.level === 'error').slice(0, 30).map(issue => `- ${issue.path}：${issue.message}`);
  return `上面生成的地图校验发现以下问题：\n${lines.join('\n')}\n请只修正这些问题，保持其余内容不变，输出修正后的完整 JSON，不要任何解释文字。`;
}

const TERRAIN_WORDS: Array<[RegExp, MapTerrain]> = [
  [/(雪|冰|寒|冻|极地|冰川)/, 'snow'], [/(火山|熔岩|灰烬)/, 'wasteland'], [/(山|峰|岭|关|崖|峡)/, 'mountains'], [/(丘|坡|岗|茶园)/, 'hills'],
  [/(林|森|树|丛林|竹)/, 'forest'], [/(沙|漠|荒原|戈壁)/, 'desert'], [/(沼|泽|湿地|苇)/, 'swamp'], [/(湖|泊|潭)/, 'lake'],
  [/(废土|废墟|辐射|工厂|工业|矿)/, 'wasteland'], [/(田|农|庄园|牧场)/, 'farmland'], [/(星云|nebula)/i, 'nebula'], [/(小行星|碎星|陨石)/, 'asteroid'],
  [/(城|市|街|区|都|镇|京)/, 'urban'],
];

function terrainFromText(text: string, fallback: MapTerrain): MapTerrain {
  for (const [pattern, terrain] of TERRAIN_WORDS) if (pattern.test(text)) return terrain;
  return fallback;
}

/**
 * 不调用 AI：按地名与描述在本地排一张草图（黄金角螺旋布点、按关键词猜地貌、相对邻域图连路）。
 * 作者可以在编辑器里再拖动调整。
 */
export function sketchMapFromLocations(input: Pick<MapGenerationInput, 'locations' | 'theme' | 'worldName' | 'description' | 'tags'> & { seed?: number }): MapModuleSchema {
  const theme = resolveMapTheme(input.theme ?? 'auto', { name: input.worldName ?? '', description: input.description, tags: input.tags ?? [] });
  const landform: MapLandform = theme === 'scifi' && /(星|宇宙|太空|星域|舰)/.test(input.description) ? 'space' : 'continent';
  const seed = input.seed ?? hashString(`${input.worldName ?? ''}|${input.locations.map(item => item.name).join(',')}`) % 2147483647;
  const width = 1000;
  const height = 700;
  const seeds = input.locations.filter(item => item.name.trim()).slice(0, 40);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const rotation = (seed % 628) / 100;
  const placed: MapLocation[] = seeds.map((item, index) => {
    const t = seeds.length <= 1 ? 0 : Math.sqrt((index + 0.5) / seeds.length);
    const angle = index * golden + rotation;
    return {
      id: `loc_${index + 1}`,
      name: item.name.trim(),
      kind: guessLocationKind(item.name, item.description ?? ''),
      x: width / 2 + Math.cos(angle) * t * width * 0.36,
      y: height / 2 + Math.sin(angle) * t * height * 0.36,
      ...(item.description ? { description: item.description.slice(0, 400) } : {}),
    };
  });
  const spread = spreadLocations(placed, width, height, 70);
  const fallbackTerrain: MapTerrain = landform === 'space' ? 'nebula' : theme === 'modern' ? 'urban' : 'plains';
  const regions: MapRegion[] = [];
  for (const location of spread) {
    const terrain = terrainFromText(`${location.name}${location.description ?? ''}`, fallbackTerrain);
    const near = regions.find(region => region.terrain === terrain && Math.hypot(region.x - location.x, region.y - location.y) < 200);
    if (near) {
      near.x = Math.round((near.x + location.x) / 2);
      near.y = Math.round((near.y + location.y) / 2);
      near.radius = Math.min(260, near.radius + 30);
      location.regionId = near.id;
      continue;
    }
    const region: MapRegion = {
      id: `region_${regions.length + 1}`,
      name: terrain === 'urban' || terrain === 'plains' ? `${location.name.slice(0, 2)}一带` : `${location.name.slice(0, 2)}${terrain === 'mountains' ? '群山' : terrain === 'forest' ? '林地' : terrain === 'desert' ? '荒漠' : terrain === 'snow' ? '雪原' : terrain === 'swamp' ? '水泽' : terrain === 'lake' ? '湖区' : '地界'}`,
      terrain: terrain === 'lake' ? 'plains' : terrain,
      x: Math.round(location.x), y: Math.round(location.y), radius: 150,
    };
    regions.push(region);
    location.regionId = region.id;
  }
  const routes = suggestRoutes(spread, [], { landform, maxLength: 320 });
  return normalizeMapConfig({
    version: 1, theme, landform, scale: theme === 'modern' ? 'region' : 'world', seed, width, height, fog: true,
    regions, locations: spread, routes,
    ...(spread[0] ? { startLocationId: spread[0].id } : {}),
  });
}

/** AI 结果落地：规范化、补上漏掉的地点、错开重叠、接通断开的路网。 */
export function finalizeGeneratedMap(value: unknown, input: Pick<MapGenerationInput, 'locations' | 'theme' | 'worldName' | 'description' | 'tags'>, base?: Partial<MapModuleSchema>): MapModuleSchema {
  const raw = rec(value) ?? {};
  const theme = raw.theme === 'ancient' || raw.theme === 'modern' || raw.theme === 'scifi'
    ? raw.theme
    : input.theme && input.theme !== 'auto' ? input.theme : resolveMapTheme('auto', { name: input.worldName ?? '', description: input.description, tags: input.tags ?? [] });
  const features = Array.isArray(raw.features)
    ? raw.features.filter(item => AI_FEATURE_KINDS.has(String(rec(item)?.kind))).slice(0, 24)
    : undefined;
  const config = normalizeMapConfig({
    ...raw,
    features,
    theme: input.theme && input.theme !== 'auto' ? input.theme : theme,
    ...(base?.seed !== undefined ? { seed: base.seed } : raw.seed === undefined ? { seed: hashString(`${input.worldName ?? ''}${input.description}`) % 2147483647 } : {}),
    fog: base?.fog ?? raw.fog,
  });
  const missing = input.locations.filter(item => item.name.trim() && !config.locations.some(location => location.name === item.name.trim()));
  if (missing.length) {
    const center = config.locations.length
      ? { x: config.locations.reduce((sum, item) => sum + item.x, 0) / config.locations.length, y: config.locations.reduce((sum, item) => sum + item.y, 0) / config.locations.length }
      : { x: config.width / 2, y: config.height / 2 };
    let serial = config.locations.length + 1;
    for (const item of missing) {
      const position = placeNear(config, config.locations, center, { seed: hashString(item.name), distance: 'far' });
      while (config.locations.some(location => location.id === `loc_${serial}`)) serial++;
      config.locations.push({ id: `loc_${serial}`, name: item.name.trim(), kind: guessLocationKind(item.name, item.description ?? ''), x: position.x, y: position.y, ...(item.description ? { description: item.description.slice(0, 400) } : {}) });
    }
  }
  config.locations = spreadLocations(config.locations, config.width, config.height, 26);
  config.routes = [...config.routes, ...suggestRoutes(config.locations, config.routes, { landform: config.landform, maxLength: 0 })];
  return normalizeMapConfig(config);
}

/** 补全坐标的结果并进已有地图。 */
export function mergePlacements(map: MapModuleSchema, value: unknown): MapModuleSchema {
  const raw = rec(value) ?? {};
  const incoming = normalizeMapConfig({ ...map, locations: [...map.locations, ...(Array.isArray(raw.locations) ? raw.locations : [])], routes: [...map.routes, ...(Array.isArray(raw.routes) ? raw.routes : [])] });
  incoming.locations = spreadLocations(incoming.locations, incoming.width, incoming.height, 24);
  incoming.routes = [...incoming.routes, ...suggestRoutes(incoming.locations, incoming.routes, { landform: incoming.landform, maxLength: 0 })];
  return normalizeMapConfig(incoming);
}

/** 不调用 AI：把还没上图的地点按描述里的方位放到地图上（以地图中心为参照），再接入路网。 */
export function placePendingLocally(map: MapModuleSchema, pending: ReadonlyArray<{ name: string; description?: string }>): MapModuleSchema {
  if (!pending.length) return map;
  const next = normalizeMapConfig(map);
  const center = next.locations.length
    ? { x: next.locations.reduce((sum, item) => sum + item.x, 0) / next.locations.length, y: next.locations.reduce((sum, item) => sum + item.y, 0) / next.locations.length }
    : { x: next.width / 2, y: next.height / 2 };
  let serial = next.locations.length + 1;
  for (const item of pending) {
    const name = item.name.trim();
    if (!name || next.locations.some(location => location.name === name)) continue;
    const direction = (item.description ?? '').match(/(东北|西北|东南|西南|北|南|东|西)/)?.[1];
    const position = placeNear(next, next.locations, center, { ...(direction ? { direction } : {}), distance: next.locations.length > 6 ? 'far' : 90, seed: hashString(name) });
    while (next.locations.some(location => location.id === `loc_${serial}`)) serial++;
    next.locations.push({ id: `loc_${serial}`, name, kind: guessLocationKind(name, item.description ?? ''), x: position.x, y: position.y, ...(item.description ? { description: item.description.slice(0, 400) } : {}) });
  }
  next.routes = [...next.routes, ...suggestRoutes(next.locations, next.routes, { landform: next.landform, maxLength: 0 })];
  return normalizeMapConfig(next);
}

/** 世界书里有、地图上还没有的地点。 */
export function pendingLocations(map: MapModuleSchema | undefined, locations: ReadonlyArray<{ name: string; description?: string }>): Array<{ name: string; description?: string }> {
  const placed = new Set((map ? allLocations(map) : []).flatMap(location => [location.name, ...(location.aliases ?? [])]));
  return locations.filter(item => item.name.trim() && !placed.has(item.name.trim()));
}

/** 路网是否连通（编辑器的提示用）。 */
export function disconnectedLocations(map: MapModuleSchema): string[] {
  if (map.locations.length < 2) return [];
  const graph = buildGraph(map);
  const start = map.locations[0]!.id;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const id = queue.shift()!;
    for (const edge of graph.adjacency.get(id) ?? []) if (!seen.has(edge.to)) { seen.add(edge.to); queue.push(edge.to); }
  }
  return map.locations.filter(location => !seen.has(location.id)).map(location => location.name);
}
