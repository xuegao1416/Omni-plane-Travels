/**
 * AI 生成的模块初始数据校验（世界编织的「生成 → 校验 → 修复」用）。
 *
 * 检查结构与数值是否合理、id 是否唯一、引用是否存在；最后把数据放进一个临时世界交给玩法宿主
 * 跑一次开局（prepare），确认真的能玩。错误交回 AI 修一次，修不好的留给作者在第 3 步手改。
 */
import type { WorldDef } from '../data/worlds-schema';
import { createDefaultGameState } from '../schema/variables';
import { createGameplayHost } from '../core/registry';
import type { RepairableIssue } from '../api/generateWithRepair';

export interface ModuleIssue extends RepairableIssue {
  /** 出问题的字段，如 resources[2].max。 */
  path: string;
}

export const GENERATED_MODULE_LABELS: Record<string, string> = {
  stat: '数值属性', progression: '成长体系', survival: '生存资源', business: '经营资产', talent: '天赋与技能',
};

const ID = /^[A-Za-z][A-Za-z0-9_]*$/;
const DIMS = ['dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'] as const;

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Rec : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function text(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

class Issues {
  readonly list: ModuleIssue[] = [];
  error(path: string, message: string) { this.list.push({ level: 'error', path, message }); }
  warn(path: string, message: string) { this.list.push({ level: 'warning', path, message }); }
}

function checkRange(out: Issues, path: string, value: unknown, range: unknown) {
  const pair = Array.isArray(range) && range.length === 2 ? [num(range[0]), num(range[1])] : undefined;
  if (!pair || pair[0] === undefined || pair[1] === undefined || pair[0] >= pair[1]) {
    out.error(`${path}.range`, 'range 必须是 [最小值, 最大值]，且最小值小于最大值');
    return;
  }
  // 初始值可以不写（角色创建时分配）；写了就必须在范围内。
  if (value === undefined) return;
  const current = num(value);
  if (current === undefined) out.error(`${path}.value`, 'value 必须是数字');
  else if (current < pair[0] || current > pair[1]) out.error(`${path}.value`, `value ${current} 不在 ${pair[0]}~${pair[1]} 之间`);
}

function uniqueIds(out: Issues, path: string, items: unknown[], seen = new Set<string>()): Set<string> {
  items.forEach((item, index) => {
    const id = rec(item)?.id;
    if (typeof id !== 'string' || !ID.test(id)) out.error(`${path}[${index}].id`, `id 必须是英文字母开头的标识（字母、数字、下划线），现在是 ${JSON.stringify(id)}`);
    else if (seen.has(id)) out.error(`${path}[${index}].id`, `id「${id}」重复`);
    else seen.add(id);
  });
  return seen;
}

function validateStat(data: Rec, out: Issues) {
  for (const key of ['attrA', 'attrB'] as const) {
    const attr = rec(data[key]);
    if (!attr) { out.error(key, `缺少 ${key}（${key === 'attrA' ? '生命类' : '能量类'}属性）`); continue; }
    if (!text(attr.name)) out.error(`${key}.name`, '缺少名称');
    const max = num(attr.max);
    const current = num(attr.current);
    if (max === undefined || max <= 0) out.error(`${key}.max`, 'max 必须是大于 0 的数字');
    if (attr.current !== undefined && (current === undefined || current < 0 || (max !== undefined && current > max))) out.error(`${key}.current`, 'current 必须在 0 与 max 之间');
  }
  for (const dim of DIMS) {
    if (data[dim] === undefined) continue;
    const stat = rec(data[dim]);
    if (!stat) { out.error(dim, '格式不对'); continue; }
    if (!text(stat.name)) out.error(`${dim}.name`, '缺少名称');
    checkRange(out, dim, stat.value, stat.range);
  }
  const special = data.special === undefined ? [] : data.special;
  if (!Array.isArray(special)) { out.error('special', 'special 必须是数组'); return; }
  if (special.length > 4) out.warn('special', `特色属性最多 4 个，现在 ${special.length} 个`);
  uniqueIds(out, 'special', special, new Set(['attrA', 'attrB', ...DIMS]));
  special.forEach((item, index) => {
    const stat = rec(item) ?? {};
    if (!text(stat.name)) out.error(`special[${index}].name`, '缺少名称');
    checkRange(out, `special[${index}]`, stat.value, stat.range);
  });
  const scale = num(data.pointScale);
  if (data.pointScale !== undefined && (scale === undefined || scale < 0.5 || scale > 2)) out.warn('pointScale', 'pointScale 应在 0.5~2.0 之间（超出会被钳制）');
}

function validateProgression(data: Rec, out: Issues) {
  if (data.mode !== 'tiered' && data.mode !== 'level') out.error('mode', 'mode 只能是 tiered（段位制）或 level（等级制）');
  const formula = rec(data.xpFormula);
  for (const key of ['baseXP', 'exponent', 'scaleFactor'] as const) {
    const value = num(formula?.[key]);
    if (value === undefined || value <= 0) out.error(`xpFormula.${key}`, `${key} 必须是大于 0 的数字`);
  }
  if (data.mode === 'tiered') {
    const tiers = Array.isArray(data.tiers) ? data.tiers : [];
    if (tiers.length < 2) out.error('tiers', '段位制至少要有 2 个段位');
    const names = new Set<string>();
    tiers.forEach((tier, index) => {
      const name = rec(tier)?.name;
      if (!text(name)) out.error(`tiers[${index}].name`, '段位缺少名称');
      else if (names.has(String(name))) out.error(`tiers[${index}].name`, `段位名「${String(name)}」重复`);
      else names.add(String(name));
    });
  }
  if (data.mode === 'level') {
    const max = num(rec(data.levelData)?.maxLevel);
    if (max === undefined || !Number.isInteger(max) || max < 2) out.error('levelData.maxLevel', '等级制的 maxLevel 必须是不小于 2 的整数');
  }
  const rewards = Array.isArray(data.activityRewards) ? data.activityRewards : [];
  uniqueIds(out, 'activityRewards', rewards);
  rewards.forEach((item, index) => {
    const rate = num(rec(item)?.rate);
    if (rate === undefined || rate <= 0 || rate > 1) out.error(`activityRewards[${index}].rate`, 'rate 是占升级所需经验的比例，必须在 0~1 之间');
  });
}

function validateSurvival(data: Rec, out: Issues) {
  const resources = Array.isArray(data.resources) ? data.resources : undefined;
  if (!resources?.length) { out.error('resources', '至少要有 1 种资源'); return; }
  const ids = uniqueIds(out, 'resources', resources);
  const names = new Set(resources.map(item => String(rec(item)?.name ?? '')));
  resources.forEach((item, index) => {
    const resource = rec(item) ?? {};
    if (!text(resource.name)) out.error(`resources[${index}].name`, '缺少名称');
    const max = num(resource.max);
    const amount = num(resource.amount);
    if (max === undefined || max <= 0) out.error(`resources[${index}].max`, 'max 必须是大于 0 的数字');
    if (amount === undefined || amount < 0 || (max !== undefined && amount > max)) out.error(`resources[${index}].amount`, 'amount 必须在 0 与 max 之间');
  });
  const known = (key: string) => ids.has(key) || names.has(key);
  const rules = rec(data.rules);
  if (!rules || !text(rules.cycleName)) out.error('rules.cycleName', '缺少结算周期名（如「一天」）');
  for (const [key, value] of Object.entries(rec(rec(data.consumption)?.perCycle) ?? {})) {
    if (!known(key)) out.error(`consumption.perCycle.${key}`, `消耗的资源「${key}」不存在`);
    if (num(value) === undefined || Number(value) < 0) out.error(`consumption.perCycle.${key}`, '每周期消耗必须是不小于 0 的数字');
  }
  (Array.isArray(data.recipes) ? data.recipes : []).forEach((item, index) => {
    const recipe = rec(item) ?? {};
    for (const key of Object.keys(rec(recipe.inputs) ?? {})) if (!known(key)) out.error(`recipes[${index}].inputs.${key}`, `配方材料「${key}」不存在`);
    const output = rec(recipe.output);
    if (!output || !known(String(output.resourceId ?? ''))) out.error(`recipes[${index}].output`, '配方产出的资源不存在');
  });
}

function validateBusiness(data: Rec, out: Issues) {
  const funds = num(data.funds);
  if (funds === undefined || funds < 0) out.error('funds', 'funds 必须是不小于 0 的数字');
  if (!text(data.cycleName)) out.error('cycleName', '缺少结算周期名（如「天」）');
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const goods = Array.isArray(rec(data.market)?.items) ? rec(data.market)!.items as unknown[] : [];
  // 只做买卖的世界可以没有产业，但至少要有能买卖的商品。
  if (!assets.length && !goods.length) { out.error('assets', '至少要有 1 项资产或 1 种市场商品'); return; }
  const goodsNames = new Set<string>();
  goods.forEach((item, index) => {
    const entry = rec(item) ?? {};
    const name = String(entry.name ?? '').trim();
    if (!name) out.error(`market.items[${index}].name`, '商品缺少名称');
    else if (goodsNames.has(name)) out.error(`market.items[${index}].name`, `商品「${name}」重复`);
    else goodsNames.add(name);
    const price = num(entry.basePrice);
    if (price === undefined || price <= 0) out.error(`market.items[${index}].basePrice`, 'basePrice 必须是大于 0 的数字');
  });
  uniqueIds(out, 'assets', assets);
  assets.forEach((item, index) => {
    const asset = rec(item) ?? {};
    const at = `assets[${index}]`;
    if (!text(asset.name)) out.error(`${at}.name`, '缺少名称');
    const maxLevel = num(asset.maxLevel);
    const level = num(asset.level);
    if (maxLevel === undefined || !Number.isInteger(maxLevel) || maxLevel < 1) out.error(`${at}.maxLevel`, 'maxLevel 必须是不小于 1 的整数');
    if (level === undefined || !Number.isInteger(level) || level < 1 || (maxLevel !== undefined && level > maxLevel)) out.error(`${at}.level`, 'level 必须是 1 到 maxLevel 之间的整数');
    if (num(rec(asset.income)?.base) === undefined) out.error(`${at}.income.base`, '缺少基础收益数字');
    for (const key of ['maintenance', 'purchaseCost', 'upgradeCost'] as const) {
      if (asset[key] === undefined && key !== 'maintenance') continue;
      const value = num(asset[key]);
      if (value === undefined || value < 0) out.error(`${at}.${key}`, `${key} 必须是不小于 0 的数字`);
    }
    const staff = rec(asset.staff);
    if (staff && (num(staff.current) ?? -1) > (num(staff.max) ?? -1)) out.error(`${at}.staff`, '在岗人数超过上限');
  });
}

function validateTalent(data: Rec, out: Issues) {
  const categories = Array.isArray(data.categories) ? data.categories : undefined;
  if (!categories?.length) { out.error('categories', '至少要有 1 个天赋大类'); return; }
  uniqueIds(out, 'categories', categories);
  const talents = categories.flatMap((category, index) => (Array.isArray(rec(category)?.talents) ? rec(category)!.talents as unknown[] : []).map((talent, position) => ({ talent: rec(talent) ?? {}, at: `categories[${index}].talents[${position}]` })));
  const skills = (Array.isArray(data.skills) ? data.skills : []).map((skill, index) => ({ talent: rec(skill) ?? {}, at: `skills[${index}]` }));
  if (!talents.length) out.error('categories', '天赋大类里没有任何天赋');
  const ids = new Set<string>();
  for (const { talent, at } of [...talents, ...skills]) {
    const id = talent.id;
    if (typeof id !== 'string' || !ID.test(id)) out.error(`${at}.id`, `id 必须是英文字母开头的标识，现在是 ${JSON.stringify(id)}`);
    else if (ids.has(id)) out.error(`${at}.id`, `id「${id}」重复（天赋与技能共用一套 id）`);
    else ids.add(id);
    if (!text(talent.name)) out.error(`${at}.name`, '缺少名称');
    const cost = talent.pointCost === undefined ? 1 : num(talent.pointCost);
    if (cost === undefined || cost < 0 || !Number.isInteger(cost)) out.error(`${at}.pointCost`, 'pointCost 必须是不小于 0 的整数');
    const rank = talent.maxRank === undefined ? 1 : num(talent.maxRank);
    if (rank === undefined || rank < 1 || !Number.isInteger(rank)) out.error(`${at}.maxRank`, 'maxRank 必须是不小于 1 的整数');
  }
  for (const { talent, at } of [...talents, ...skills]) {
    for (const prerequisite of Array.isArray(talent.prerequisites) ? talent.prerequisites : []) {
      if (prerequisite === talent.id) out.error(`${at}.prerequisites`, '不能把自己设为前置');
      else if (!ids.has(String(prerequisite))) out.error(`${at}.prerequisites`, `前置「${String(prerequisite)}」不存在`);
    }
  }
  for (const [key, value] of Object.entries(rec(data.pointRules) ?? {})) {
    if (num(value) === undefined || Number(value) < 0) out.error(`pointRules.${key}`, `${key} 必须是不小于 0 的数字`);
  }
}

const VALIDATORS: Record<string, (data: Rec, out: Issues) => void> = {
  stat: validateStat, progression: validateProgression, survival: validateSurvival, business: validateBusiness, talent: validateTalent,
};

/** 把数据放进临时世界开一局：玩法宿主读不懂或开局报错时给出原因。 */
function compileCheck(moduleId: string, data: Rec, out: Issues) {
  const world = { id: 'module_check', name: '模块校验', description: '', modules: [{ moduleId, enabled: true, moduleConfig: data }] } as unknown as WorldDef;
  try {
    const state = createDefaultGameState();
    createGameplayHost(world, state).prepare(state);
  } catch (error) {
    out.error('(整体)', `放进世界后无法开局：${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 校验一个模块的生成数据；没有对应校验器的模块只做开局检查。 */
export function validateGeneratedModule(moduleId: string, value: unknown): ModuleIssue[] {
  const out = new Issues();
  const data = rec(value);
  if (!data) {
    out.error('(整体)', '必须是一个 JSON 对象');
    return out.list;
  }
  VALIDATORS[moduleId]?.(data, out);
  if (!out.list.some(issue => issue.level === 'error')) compileCheck(moduleId, data, out);
  return out.list;
}

/** 修复请求：把问题逐条告诉 AI，要求返回完整 JSON。 */
export function buildModuleRepairPrompt(moduleId: string, issues: readonly ModuleIssue[]): string {
  const label = GENERATED_MODULE_LABELS[moduleId] ?? moduleId;
  const lines = issues.filter(issue => issue.level === 'error').slice(0, 30).map(issue => `- ${issue.path}：${issue.message}`);
  return `上面生成的「${label}」数据校验发现以下问题：\n${lines.join('\n')}\n请只修正这些问题，保持其余内容与风格不变，输出修正后的完整 JSON，不要任何解释文字。`;
}
