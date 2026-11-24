/**
 * 地图可以挂接的其他模块条目：经营的市场与产业、生存物资、职业、检定属性、成长阶段、事件卡、势力。
 * 编辑器的下拉选项与 AI 生成提示词都从这里取，只列世界里真正启用的模块。
 */
import type { WorldDef } from '../../data/worlds-schema';
import type { BusinessModuleSchema, ProgressionModuleSchema, StatModuleSchema, SurvivalModuleSchema } from '../../modules/schema';
import { resolveProfessionBinding } from '../../data/professions';
import { normalizeEconomyConfig } from '../economy/config';
import { normalizeResourcesConfig } from '../resources/config';

export interface MapLinkOptions {
  markets: Array<{ id: string; name: string }>;
  holdings: Array<{ id: string; name: string }>;
  resources: Array<{ id: string; name: string }>;
  professions: Array<{ id: string; name: string }>;
  stats: Array<{ id: string; name: string }>;
  tiers: string[];
  events: Array<{ eventId: string; packId?: string; name: string }>;
  factions: string[];
  combat: boolean;
  /** 经营资产已启用（即使还没有市场与产业，价格与收入修正也能生效）。 */
  business: boolean;
}

type WorldLike = Pick<WorldDef, 'modules'> & Partial<Pick<WorldDef, 'eventPacks' | 'worldBookEntries'>>;

function configOf<T>(world: WorldLike, id: string): T | undefined {
  return world.modules?.find(module => module.moduleId === id && module.enabled)?.moduleConfig as T | undefined;
}

export function mapLinkOptions(world: WorldLike, extraFactions: string[] = []): MapLinkOptions {
  const business = configOf<BusinessModuleSchema>(world, 'business');
  const economy = business ? normalizeEconomyConfig(business) : undefined;
  const survival = configOf<SurvivalModuleSchema>(world, 'survival');
  const resources = survival ? normalizeResourcesConfig(survival).resources : [];
  const stat = configOf<StatModuleSchema>(world, 'stat');
  const progression = configOf<ProgressionModuleSchema>(world, 'progression');
  let professions: MapLinkOptions['professions'] = [];
  const professionModule = configOf<unknown>(world, 'profession');
  if (professionModule) {
    try { professions = resolveProfessionBinding(professionModule).professions.map(item => ({ id: item.id, name: item.name })); } catch { professions = []; }
  }
  const factions = [...new Set([
    ...(world.worldBookEntries ?? []).filter(entry => entry.entryType === 'factions').map(entry => entry.comment),
    ...extraFactions,
  ].filter(Boolean))];
  return {
    markets: (economy?.markets ?? []).map(market => ({ id: market.id, name: market.name })),
    holdings: (economy?.holdings ?? []).map(holding => ({ id: holding.id, name: holding.name })),
    resources: resources.map(resource => ({ id: resource.id, name: resource.name })),
    professions,
    stats: stat ? (['dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'] as const).flatMap(dim => stat[dim]?.name ? [{ id: dim, name: stat[dim]!.name }] : []) : [],
    tiers: progression?.mode === 'level'
      ? Array.from({ length: Math.min(30, (progression.levelData?.maxLevel ?? 10) + 1) }, (_, index) => `Lv.${index}`)
      : (progression?.tiers ?? []).map(tier => tier.name),
    events: (world.eventPacks ?? []).flatMap(pack => (pack.events ?? []).map(event => ({ eventId: event.id, packId: pack.id, name: event.name || event.id }))),
    factions,
    combat: Boolean(world.modules?.some(module => module.moduleId === 'combat' && module.enabled)),
    business: Boolean(business),
  };
}

export interface EffectTarget { value: string; label: string; group: string }

/** 修正效果可选的目标（按已启用的模块列出）。 */
export function effectTargets(options: MapLinkOptions): EffectTarget[] {
  const out: EffectTarget[] = [
    { value: 'map.travel.time', label: '赶路时间', group: '地图' },
    { value: 'map.travel.stamina', label: '赶路体力', group: '地图' },
  ];
  for (const resource of options.resources) {
    out.push({ value: `resources.upkeep.${resource.id}`, label: `${resource.name}消耗`, group: '生存资源' });
    out.push({ value: `resources.gather.${resource.id}`, label: `${resource.name}采集量`, group: '生存资源' });
  }
  if (options.business || options.markets.length || options.holdings.length) {
    out.push({ value: 'economy.price.buy', label: '买入价', group: '经营' }, { value: 'economy.price.sell', label: '卖出价', group: '经营' }, { value: 'economy.income', label: '产业收入', group: '经营' });
  }
  if (options.stats.length) {
    out.push({ value: 'dice.check', label: '所有检定', group: '骰子检定' });
    for (const stat of options.stats) {
      out.push({ value: `dice.check.${stat.id}`, label: `${stat.name}检定`, group: '骰子检定' });
      out.push({ value: `stat.${stat.id}`, label: stat.name, group: '数值属性' });
    }
  }
  return out;
}
