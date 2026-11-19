/**
 * 事件界面数据：待处理卡片的展示模型、右侧「事件」卡片的数据。只读，不改存档。
 */
import type { GameState } from '../schema/variables';
import type { WorldDef } from '../data/worlds-schema';
import { createGameplayHost } from '../core/registry';
import { optionHint, presentCard, type CardPresentation } from './cards';
import { getEventCatalog, isDeckEvent } from './catalog';
import { EVENTS_MODULE_ID, indexCatalog, isCombatBusy, type EventsConfig } from './module';
import { PACING_LABELS, PACING_LEVELS, PACING_RULES, readDirector } from './state';
import type { CardOptionSpec, PacingLevel, QueuedCard } from './types';

export interface EventCardView {
  entry: QueuedCard;
  /** 卡片内容；事件包被停用或删除时为空，界面只提供移除。 */
  card?: CardPresentation;
  unavailable?: string;
  /** 队列里排在后面的卡片数。 */
  waiting: number;
}

function configFor(world: WorldDef | undefined, state: GameState): { config: EventsConfig; host: ReturnType<typeof createGameplayHost> } {
  const host = createGameplayHost(world, state);
  return { host, config: host.configOf<EventsConfig>(EVENTS_MODULE_ID) ?? indexCatalog(getEventCatalog(world)) };
}

/** 队首的待处理事件卡；没有时返回 null。 */
export function buildEventCardView(state: GameState | undefined, world: WorldDef | undefined): EventCardView | null {
  if (!state) return null;
  const director = readDirector(state);
  const entry = director.queue[0];
  if (!entry) return null;
  const { host, config } = configFor(world, state);
  const def = config.byKey.get(entry.key);
  const waiting = director.queue.length - 1;
  if (!def?.card) {
    return { entry, waiting, unavailable: '这张事件卡所属的事件包已停用或删除，内容无法显示。' };
  }
  try {
    const card = presentCard({
      state, world, facts: host.facts, modifiers: host.modifierQuery(state),
      key: def.key, packId: def.packId, eventId: def.eventId, name: def.name, workflow: def.card,
      turn: Math.trunc(Number(state.simulationRuntime?.tick) || 0),
    });
    return { entry, waiting, card };
  } catch (error) {
    return { entry, waiting, unavailable: `事件卡内容读取失败：${error instanceof Error ? error.message : String(error)}` };
  }
}

export interface EventsPanelView {
  pacing: PacingLevel;
  pacingOptions: Array<{ level: PacingLevel; label: string; hint: string }>;
  pending: Array<{ key: string; name: string; turn: number }>;
  recent: Array<{ key: string; name: string; turn: number; text: string; tone: 'gain' | 'loss' | 'mute' }>;
  /** 牌堆里现在能抽到的卡 / 牌堆总数。 */
  deck: { ready: number; total: number };
  triggered: number;
  rules: number;
  paused?: string;
  summary: string;
  warnings: string[];
}

function pacingHint(level: PacingLevel): string {
  if (level === 'off') return '只出现由剧情条件触发的事件';
  const rule = PACING_RULES[level];
  return `冷场时约 ${Math.round(rule.base * 100)}% 起，至少间隔 ${rule.gap} 回合`;
}

/** 右侧「事件」卡片：节奏、待处理、最近结果、目录概况。没有任何事件时返回 null。 */
export function buildEventsPanelView(state: GameState | undefined, world: WorldDef | undefined): EventsPanelView | null {
  if (!state) return null;
  const catalog = getEventCatalog(world);
  const director = readDirector(state);
  if (catalog.definitions.length === 0 && director.queue.length === 0 && director.history.length === 0) return null;
  const config = indexCatalog(catalog);
  const turn = Math.trunc(Number(state.simulationRuntime?.tick) || 0);
  const ready = config.deck.filter(def => {
    if (def.once && (director.fired[def.key]?.count ?? 0) > 0) return false;
    const until = director.cooldowns[def.key];
    return until === undefined || turn > until;
  }).length;
  return {
    pacing: director.pacing.level,
    pacingOptions: PACING_LEVELS.map(level => ({ level, label: PACING_LABELS[level], hint: pacingHint(level) })),
    pending: director.queue.map(item => ({ key: item.key, name: config.byKey.get(item.key)?.name ?? item.eventId, turn: item.turn })),
    recent: [...director.history].reverse().slice(0, 4).map(item => ({
      key: `${item.key}:${item.turn}`,
      name: item.name,
      turn: item.turn,
      text: item.dismissed ? '已跳过' : [item.choice, item.summary].filter(Boolean).join(' · ') || '已知晓',
      tone: item.dismissed ? 'mute' : item.success === false ? 'loss' : item.success === true ? 'gain' : 'mute',
    })),
    deck: { ready, total: config.deck.length },
    triggered: catalog.definitions.filter(def => def.kind === 'card' && !isDeckEvent(def)).length,
    rules: catalog.definitions.filter(def => def.kind !== 'card').length,
    ...(isCombatBusy(state) ? { paused: '战斗中暂停抽取随机事件' } : {}),
    summary: catalog.summary,
    warnings: catalog.warnings ?? [],
  };
}

/** 动态选项（AI 生成）的效果说明。 */
export function describeOptions(state: GameState, world: WorldDef | undefined, specs: readonly CardOptionSpec[]): string[] {
  const host = createGameplayHost(world, state);
  return specs.map(spec => optionHint(spec, host.facts, world));
}
