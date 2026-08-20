import type { GameState } from '../../schema/variables';
import type { BusinessModuleSchema } from '../../modules/schema';
import {
  executeGameplayTransaction,
  ensureGameplayRuntime,
  evaluateGameplayCondition,
  type GameplayEventInput,
  type GameplayEffect,
  type GameplayExecutionContext,
  type GameplayExecutionResult,
  type GameplayStateRoot,
} from '../kernel';

type RuntimeBusiness = NonNullable<GameState['玩家']['经营资产']>;
type RuntimeAsset = RuntimeBusiness['资产列表'][number];

export interface BusinessAssetSettlement {
  assetId: string;
  name: string;
  gross: number;
  maintenance: number;
  net: number;
  staffMultiplier: number;
  marketMultiplier: number;
}

export interface BusinessSettlementBreakdown {
  grossIncome: number;
  maintenance: number;
  net: number;
  assets: BusinessAssetSettlement[];
  idledAssetIds: string[];
}

export interface BusinessCycleResult {
  execution: GameplayExecutionResult<GameState & GameplayStateRoot>;
  breakdown: BusinessSettlementBreakdown;
}

function blockedBusiness(state: GameState, context: GameplayExecutionContext, id: string): GameplayExecutionResult<GameState & GameplayStateRoot> {
  return executeGameplayTransaction(state, {
    id, moduleId: 'business', source: 'player',
    conditions: [{ state: { path: '__gameplay.businessAllowed', op: '==', value: true } }],
  }, context);
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function marketMultiplier(asset: RuntimeAsset, config: BusinessModuleSchema): number {
  const tags = new Set([asset.名称, asset.类型, ...(asset.市场标签 ?? [])].filter(Boolean));
  const matches = (config.market?.items ?? []).filter(item => tags.has(item.name));
  if (matches.length === 0) return 1;
  const averageChange = matches.reduce((sum, item) => {
    const direction = item.trend === 'up' ? 1 : item.trend === 'down' ? -1 : 0;
    return sum + direction * Math.abs(Number(item.changePercent) || 0);
  }, 0) / matches.length;
  const weight = Math.min(1, Math.max(0, Number(config.economy?.marketWeight ?? 0.35)));
  return Math.max(0.1, 1 + (averageChange / 100) * weight);
}

function settleAsset(asset: RuntimeAsset, config: BusinessModuleSchema): BusinessAssetSettlement {
  const staffMultiplier = Math.max(0, Number(asset.员工效率) || 1);
  const market = marketMultiplier(asset, config);
  const base = (Number(asset.基础收益) || 0) + (Number(asset.每级收益) || 0) * Math.max(0, (Number(asset.等级) || 1) - 1);
  const gross = roundCurrency(Math.max(0, base) * staffMultiplier * market);
  const maintenance = roundCurrency(Math.max(0, Number(asset.维护费) || 0));
  return {
    assetId: asset.id,
    name: asset.名称,
    gross,
    maintenance,
    net: roundCurrency(gross - maintenance),
    staffMultiplier,
    marketMultiplier: market,
  };
}

function emptyBreakdown(): BusinessSettlementBreakdown {
  return { grossIncome: 0, maintenance: 0, net: 0, assets: [], idledAssetIds: [] };
}

/** 与实际结算共用同一公式，为 UI 提供本周期预估。 */
export function previewBusinessModule(config: BusinessModuleSchema): BusinessSettlementBreakdown {
  const assets = (config.assets ?? [])
    .filter(asset => asset.status === 'active')
    .map(asset => settleAsset({
      id: asset.id,
      名称: asset.name,
      类型: asset.type,
      等级: asset.level,
      最高等级: asset.maxLevel,
      描述: asset.description,
      状态: asset.status,
      基础收益: asset.income?.base ?? 0,
      每级收益: asset.income?.perLevel ?? 0,
      维护费: asset.maintenance ?? 0,
      员工效率: asset.staff?.efficiency,
      市场标签: asset.marketTags,
      风险等级: asset.risk?.level,
      升级费用: asset.upgradeCost,
    }, config));
  const grossIncome = roundCurrency(assets.reduce((sum, asset) => sum + asset.gross, 0));
  const maintenance = roundCurrency(assets.reduce((sum, asset) => sum + asset.maintenance, 0));
  return { grossIncome, maintenance, net: roundCurrency(grossIncome - maintenance), assets, idledAssetIds: [] };
}

export function purchaseBusinessAsset(
  state: GameState,
  config: BusinessModuleSchema,
  assetId: string,
  context: GameplayExecutionContext,
): GameplayExecutionResult<GameState & GameplayStateRoot> {
  const business = state.玩家.经营资产;
  const definition = config.assets?.find(asset => asset.id === assetId);
  if (!business || !definition || business.资产列表.some(asset => asset.id === assetId)) return blockedBusiness(state, context, `business:purchase:blocked:${assetId}:${context.tick}`);
  const runtime = ensureGameplayRuntime(state as GameState & GameplayStateRoot);
  const inventory = { ...(runtime.business?.inventory ?? {}), ...(business.库存 ?? {}) };
  for (const [item, amount] of Object.entries(inventory)) runtime.business!.inventory[item] = amount;
  const purchaseCost = Math.max(0, Number(definition.purchaseCost ?? definition.upgradeCost ?? 0));
  const materialCosts = Object.entries(definition.purchaseMaterials ?? {});
  const nextInventory = { ...inventory };
  for (const [item, amount] of materialCosts) nextInventory[item] = Math.max(0, (nextInventory[item] ?? 0) - Math.max(0, Number(amount) || 0));
  const asset = {
    id: definition.id, 名称: definition.name, 类型: definition.type,
    等级: Math.max(1, Math.trunc(definition.level)), 最高等级: Math.max(1, Math.trunc(definition.maxLevel)),
    描述: definition.description, 状态: definition.status,
    基础收益: Number(definition.income.base) || 0, 每级收益: Number(definition.income.perLevel) || 0,
    维护费: Math.max(0, Number(definition.maintenance) || 0),
    ...(definition.staff ? { 员工效率: Math.max(0, Number(definition.staff.efficiency) || 1) } : {}),
    ...(definition.marketTags?.length ? { 市场标签: [...definition.marketTags] } : {}),
    ...(definition.risk ? { 风险等级: definition.risk.level } : {}),
    ...(definition.upgradeCost !== undefined ? { 升级费用: Math.max(0, Number(definition.upgradeCost) || 0) } : {}),
  } as const;
  return executeGameplayTransaction(state, {
    id: `business:purchase:${assetId}:${context.tick}`, moduleId: 'business', source: 'player', label: `购置${definition.name}`,
    costs: [
      ...(purchaseCost > 0 ? [{ path: '玩家.经营资产.资金', amount: purchaseCost, label: '购置资金' }] : []),
      ...materialCosts.map(([item, amount]) => ({ path: `gameplay.business.inventory.${item}`, amount: Math.max(0, Number(amount) || 0), label: item })),
    ],
    effects: [
      { append: { path: '玩家.经营资产.资产列表', value: asset as unknown as Record<string, never> } },
      { set: { path: '玩家.经营资产.库存', value: nextInventory as unknown as Record<string, never> } },
      { append: { path: '玩家.经营资产.交易日志', value: { 类型: 'purchase', 描述: `购置${definition.name}`, 金额: purchaseCost }, create: true, limit: 100 } },
    ],
    events: [{ type: 'business.asset-purchased', payload: { assetId, name: definition.name } }],
  }, context);
}

export function upgradeBusinessAsset(
  state: GameState,
  config: BusinessModuleSchema,
  assetId: string,
  context: GameplayExecutionContext,
): GameplayExecutionResult<GameState & GameplayStateRoot> {
  const business = state.玩家.经营资产;
  const asset = business?.资产列表.find(item => item.id === assetId);
  const definition = config.assets?.find(item => item.id === assetId);
  if (!business || !asset || !definition || asset.等级 >= asset.最高等级) return blockedBusiness(state, context, `business:upgrade:blocked:${assetId}:${context.tick}`);
  const runtime = ensureGameplayRuntime(state as GameState & GameplayStateRoot);
  const inventory = { ...(runtime.business?.inventory ?? {}), ...(business.库存 ?? {}) };
  for (const [item, amount] of Object.entries(inventory)) runtime.business!.inventory[item] = amount;
  const cost = Math.max(0, Number(asset.升级费用 ?? definition.upgradeCost ?? 0));
  const materials = Object.entries(definition.upgradeMaterials ?? {});
  const nextInventory = { ...inventory };
  for (const [item, amount] of materials) nextInventory[item] = Math.max(0, (nextInventory[item] ?? 0) - Math.max(0, Number(amount) || 0));
  const nextAssets = business.资产列表.map(item => item.id === assetId ? { ...item, 等级: item.等级 + 1 } : item);
  return executeGameplayTransaction(state, {
    id: `business:upgrade:${assetId}:${context.tick}`, moduleId: 'business', source: 'player', label: `升级${asset.名称}`,
    costs: [
      ...(cost > 0 ? [{ path: '玩家.经营资产.资金', amount: cost, label: '升级资金' }] : []),
      ...materials.map(([item, amount]) => ({ path: `gameplay.business.inventory.${item}`, amount: Math.max(0, Number(amount) || 0), label: item })),
    ],
    effects: [
      { set: { path: '玩家.经营资产.资产列表', value: nextAssets as unknown as Array<Record<string, never>> } },
      { set: { path: '玩家.经营资产.库存', value: nextInventory as unknown as Record<string, never> } },
      { append: { path: '玩家.经营资产.交易日志', value: { 类型: 'upgrade', 描述: `升级${asset.名称}`, 金额: cost }, create: true, limit: 100 } },
    ],
    events: [{ type: 'business.asset-upgraded', payload: { assetId, level: asset.等级 + 1 } }],
  }, context);
}

export function assignBusinessStaff(
  state: GameState,
  assetId: string,
  staffCount: number,
  efficiency: number | undefined,
  context: GameplayExecutionContext,
): GameplayExecutionResult<GameState & GameplayStateRoot> {
  const business = state.玩家.经营资产;
  const asset = business?.资产列表.find(item => item.id === assetId);
  if (!business || !asset) return blockedBusiness(state, context, `business:staff:blocked:${assetId}:${context.tick}`);
  const count = Math.max(0, Math.min(asset.最高等级 * 10, Math.trunc(staffCount)));
  const nextAssets = business.资产列表.map(item => item.id === assetId ? {
    ...item,
    ['员工效率']: Math.max(0, Number(efficiency ?? item.员工效率 ?? 1)),
    ['员工人数']: count,
  } : item);
  return executeGameplayTransaction(state, {
    id: `business:staff:${assetId}:${context.tick}`, moduleId: 'business', source: 'player', label: `安排${asset.名称}员工`,
    effects: [{ set: { path: '玩家.经营资产.资产列表', value: nextAssets as unknown as Array<Record<string, never>> } }],
    events: [{ type: 'business.staff-assigned', payload: { assetId, count } }],
  }, context);
}

export function settleBusinessCycle(
  state: GameState,
  config: BusinessModuleSchema,
  periodKey: string,
  context: GameplayExecutionContext,
): BusinessCycleResult {
  const business = state.玩家.经营资产;
  if (!business || !periodKey) {
    const execution = executeGameplayTransaction(state, {
      id: `business:missing:${context.tick}`, moduleId: 'business', source: 'system',
      conditions: [{ state: { path: '__gameplay.businessAllowed', op: '==', value: true } }],
    }, context);
    return { execution, breakdown: emptyBreakdown() };
  }

  const workingAssets = business.资产列表.map(asset => ({ ...asset, 市场标签: asset.市场标签 ? [...asset.市场标签] : undefined }));
  const gameplayRuntime = ensureGameplayRuntime(state as GameState & GameplayStateRoot);
  const initialInventory = { ...(gameplayRuntime.business?.inventory ?? {}), ...(business.库存 ?? {}) };
  const nextInventory = { ...initialInventory };
  const productionEffects: GameplayEffect[] = [];
  const productionEvents: GameplayEventInput[] = [];
  for (const production of config.economy?.production ?? []) {
    if (!(production.unlockConditions ?? []).every(condition => evaluateGameplayCondition(condition, state as GameState & GameplayStateRoot, context.events ?? []))) continue;
    const configuredCycles = Math.max(1, Math.trunc(Number(production.cycles ?? 1)));
    const availableCycles = Object.entries(production.inputs).reduce((minimum, [item, amount]) => {
      const required = Math.max(0, Number(amount) || 0);
      return required <= 0 ? minimum : Math.min(minimum, Math.floor((Number(nextInventory[item]) || 0) / required));
    }, configuredCycles);
    const cycles = Math.max(0, Math.min(configuredCycles, availableCycles));
    if (cycles <= 0) continue;
    for (const [item, amount] of Object.entries(production.inputs)) {
      const delta = -Math.max(0, Number(amount) || 0) * cycles;
      nextInventory[item] = Math.max(0, (Number(nextInventory[item]) || 0) + delta);
      productionEffects.push({ add: { path: `gameplay.business.inventory.${item}`, delta, min: 0, create: true } });
    }
    for (const [item, amount] of Object.entries(production.outputs)) {
      const delta = Math.max(0, Number(amount) || 0) * cycles;
      nextInventory[item] = Math.max(0, (Number(nextInventory[item]) || 0) + delta);
      productionEffects.push({ add: { path: `gameplay.business.inventory.${item}`, delta, min: 0, create: true } });
    }
    productionEvents.push({ type: 'business.production-completed', payload: { productionId: production.id, cycles } });
  }
  let assetBreakdowns = workingAssets.filter(asset => asset.状态 === 'active').map(asset => settleAsset(asset, config));
  const idledAssetIds: string[] = [];

  const sum = () => ({
    gross: roundCurrency(assetBreakdowns.reduce((total, item) => total + item.gross, 0)),
    maintenance: roundCurrency(assetBreakdowns.reduce((total, item) => total + item.maintenance, 0)),
  });
  let totals = sum();
  let projected = roundCurrency((Number(business.资金) || 0) + totals.gross - totals.maintenance);

  if (projected < 0 && config.economy?.autoIdleOnDeficit !== false) {
    const candidates = [...assetBreakdowns].sort((left, right) => left.net - right.net || right.maintenance - left.maintenance);
    for (const candidate of candidates) {
      if (projected >= 0) break;
      const asset = workingAssets.find(item => item.id === candidate.assetId);
      if (!asset) continue;
      asset.状态 = 'idle';
      idledAssetIds.push(asset.id);
      assetBreakdowns = assetBreakdowns.filter(item => item.assetId !== asset.id);
      totals = sum();
      projected = roundCurrency(Math.max(0, (Number(business.资金) || 0) + totals.gross - totals.maintenance));
    }
  }

  const net = roundCurrency(totals.gross - totals.maintenance);
  const newFunds = roundCurrency(Math.max(0, (Number(business.资金) || 0) + net));
  const events: GameplayEventInput[] = [...productionEvents, {
    type: 'business.settled',
    payload: { periodKey, grossIncome: totals.gross, maintenance: totals.maintenance, net },
  }];
  for (const assetId of idledAssetIds) events.push({ type: 'business.asset-idled', payload: { assetId } });
  const logLimit = Math.max(10, Math.min(200, Math.trunc(config.economy?.logLimit ?? 50)));

  const execution = executeGameplayTransaction(state, {
    id: `business:settle:${periodKey}`,
    moduleId: 'business',
    source: 'system',
    label: `${config.cycleName || '周期'}经营结算`,
    conditions: [{ state: { path: '玩家.经营资产.上次结算周期', op: '!=', value: periodKey } }],
    effects: [
      { set: { path: '玩家.经营资产.资金', value: newFunds } },
      { set: { path: '玩家.经营资产.资产列表', value: workingAssets as unknown as Array<Record<string, never>> } },
      { set: { path: '玩家.经营资产.上次结算周期', value: periodKey } },
      { set: { path: 'gameplay.business.inventory', value: initialInventory as unknown as Record<string, never> } },
      ...productionEffects,
      { set: { path: '玩家.经营资产.库存', value: nextInventory as unknown as Record<string, never> } },
      { append: {
        path: '玩家.经营资产.交易日志',
        create: true,
        limit: logLimit,
        value: {
          类型: net >= 0 ? 'income' : 'expense',
          描述: `周期结算：收入 +${totals.gross}，维护 -${totals.maintenance}`,
          金额: net,
        },
      } },
    ],
    events,
  }, context);

  return {
    execution,
    breakdown: {
      grossIncome: totals.gross,
      maintenance: totals.maintenance,
      net,
      assets: assetBreakdowns,
      idledAssetIds,
    },
  };
}
