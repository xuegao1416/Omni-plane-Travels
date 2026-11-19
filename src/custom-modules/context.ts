import type { GameState } from '../schema/variables';
import type { JsonValue, CustomModuleItemDefinition } from './schema';

export interface CustomModuleChoiceEvent {
  type: 'choice';
  eventPackId?: string;
  cardId?: string;
  blockId?: string;
  selectedIndex: number;
  label?: string;
}

export interface CustomModuleButtonEvent {
  type: 'button';
  moduleId: string;
  event: string;
}

export type CustomModuleEvent = CustomModuleChoiceEvent | CustomModuleButtonEvent;

export interface CustomModuleHostContext {
  game: { round: number; time: string; elapsedMinutes?: number; location?: string };
  player: {
    stats: Record<string, number>;
    currency: { primary: number };
    inventory?: Record<string, { amount: number }>;
    survival: Record<string, { amount: number; max?: number }>;
    business?: { funds: number; assetCount: number };
  };
  event: { choice?: CustomModuleChoiceEvent; button?: CustomModuleButtonEvent };
}

export interface CustomModuleContextOptions {
  round?: number;
  time?: string;
  now?: number;
  event?: CustomModuleEvent;
  items?: Record<string, CustomModuleItemDefinition>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function buildCustomModuleHostContext(
  gameState: GameState,
  options: CustomModuleContextOptions = {},
): CustomModuleHostContext {
  const stats = gameState.玩家?.生存状态 ?? { 血量: 0, 体力值: 0 };
  const canonicalStats: Record<string, number> = {
    attrA: Number(stats.血量 ?? 0),
    attrB: Number(stats.体力值 ?? 0),
  };
  for (let index = 1; index <= 6; index += 1) canonicalStats[`dim${index}`] = Number(stats[`dim${index}`] ?? 0);

  const survival: Record<string, { amount: number; max?: number }> = {};
  const ledger = gameState.resources;
  if (ledger) {
    // 资源模块（state.resources）：数量与运行时上限。
    for (const [id, amount] of Object.entries(ledger.stocks ?? {})) {
      if (ledger.retired?.includes(id)) continue;
      const max = ledger.capacity?.[id];
      survival[id] = { amount: Number(amount ?? 0), ...(max === undefined ? {} : { max: Number(max) }) };
    }
  } else {
    for (const [id, resource] of Object.entries(gameState.玩家?.生存资源 ?? {})) {
      survival[id] = { amount: Number(resource.数量 ?? 0), ...(resource.最大值 === undefined ? {} : { max: Number(resource.最大值) }) };
    }
  }
  // 经营资金已并入钱袋；产业数按经营模块里拥有的产业计算。
  const business = gameState.economy
    ? { 资金: Number(gameState.玩家?.货币资源?.主货币?.数量 ?? 0), 资产列表: Object.keys(gameState.economy.holdings ?? {}) }
    : gameState.玩家?.经营资产;
  const event = options.event;
  return clone({
    game: {
      round: Number.isFinite(options.round) ? Number(options.round) : 0,
      time: options.time ?? gameState.世界?.时间系统?.当前时间 ?? '',
      location: gameState.世界?.空间定位?.当前位置 ?? '',
      ...(Number.isFinite(gameState.世界?.时间系统?.时钟?.elapsedMinutes)
        ? { elapsedMinutes: gameState.世界.时间系统.时钟!.elapsedMinutes } : {}),
    },
    player: {
      stats: canonicalStats,
      currency: { primary: Number(gameState.玩家?.货币资源?.主货币?.数量 ?? 0) },
      inventory: Object.fromEntries(Object.entries(options.items ?? {}).map(([id, item]) => [id, { amount: Number(gameState.玩家?.物品栏?.[item.name]?.数量 ?? 0) }])),
      survival,
      ...(business ? { business: { funds: Number(business.资金 ?? 0), assetCount: business.资产列表?.length ?? 0 } } : {}),
    },
    event: event?.type === 'choice' ? { choice: { ...event } } : event?.type === 'button' ? { button: { ...event } } : {},
  });
}

function readPath(value: unknown, path: string): JsonValue | undefined {
  const parts = path.split('.').filter(Boolean);
  let current: unknown = value;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current === undefined ? undefined : clone(current as JsonValue);
}

export function readCustomModuleHostInput(context: CustomModuleHostContext, path: string): JsonValue | undefined {
  return readPath(context, path);
}

export function sanitizeCustomModuleEvent(event: CustomModuleEvent | undefined): CustomModuleEvent | undefined {
  if (!event) return undefined;
  if (event.type === 'choice') {
    return {
      type: 'choice', eventPackId: event.eventPackId?.slice(0, 120), cardId: event.cardId?.slice(0, 120),
      blockId: event.blockId?.slice(0, 120), selectedIndex: Math.max(0, Math.min(99, Math.trunc(event.selectedIndex))),
      label: event.label?.slice(0, 200),
    };
  }
  return { type: 'button', moduleId: event.moduleId.slice(0, 120), event: event.event.slice(0, 120) };
}
