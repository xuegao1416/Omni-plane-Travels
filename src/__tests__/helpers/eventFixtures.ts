/**
 * 事件系统测试共用的构造器：卡片工作流、事件包、测试世界与回合推进。
 */
import { createDefaultGameState, type GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import type { CardWorkflowDefinition, Manifest } from '../../modules/schema';
import { createGameplayHost } from '../../core/registry';
import type { GameplayHost } from '../../core/host';
import { readCanonicalEventPack } from '../../modules/eventPackFormat';
import type { RuntimePackLike } from '../../events/catalog';

export function cardWorkflow(id: string, name: string, options: unknown[] = []): CardWorkflowDefinition {
  return {
    version: 1,
    id,
    name,
    nodes: [
      { id: `${id}-t`, typeId: 'narrative.title', position: { x: 0, y: 0 }, widgetValues: { title: name } },
      { id: `${id}-c`, typeId: 'choice.static', position: { x: 0, y: 0 }, widgetValues: { options: JSON.stringify(options) } },
    ],
    connections: [{ id: `${id}-f`, sourceNodeId: `${id}-t`, sourceSocketKey: 'flow_out', targetNodeId: `${id}-c`, targetSocketKey: 'flow_in' }],
  } as CardWorkflowDefinition;
}

/** 规范 v2 卡片文件（schema/events.json + schema/event-<id>.json）。 */
export function canonicalCardFiles(name: string, cards: CardWorkflowDefinition[]): Record<string, string> {
  return {
    'schema/events.json': JSON.stringify({ version: 2, name, events: cards.map(card => ({ id: card.id, name: card.name })) }),
    ...Object.fromEntries(cards.map(card => [`schema/event-${card.id}.json`, JSON.stringify(card)])),
  };
}

export function packManifest(id: string, type: 'rule' | 'card', permissions: string[]): Manifest {
  return {
    id, name: id, version: '1.0.0', author: 'test', engine: 'opt-event', schemaVersion: 1, minAppVersion: '2.7.0',
    type, coverColor: '#3b82f6', icon: type === 'card' ? 'FileText' : 'Zap', permissions: permissions as Manifest['permissions'],
  };
}

export function runtimePack(id: string, permissions: string[], files: Record<string, string>): RuntimePackLike {
  return { id, manifest: { name: id, permissions }, files };
}

export function readPackCards(files: Record<string, string>): CardWorkflowDefinition[] {
  return [...readCanonicalEventPack(files).workflows];
}

export function eventTestWorld(id = 'evt_engine_world', eventPacks: unknown[] = []): WorldDef {
  return { id, name: '事件引擎测试', description: '', modules: [], eventPacks } as unknown as WorldDef;
}

export function eventTestState(mutate?: (state: GameState) => void): GameState {
  const state = createDefaultGameState();
  state.世界.时间系统.时钟 = { schemaVersion: 2, elapsedMinutes: 8 * 60 };
  state.玩家.货币资源.主货币 = { 名称: '铜钱', 数量: 100 };
  mutate?.(state);
  return state;
}

export function hostFor(world: WorldDef, state: GameState): { host: GameplayHost; state: GameState } {
  const host = createGameplayHost(world, state);
  return { host, state: host.prepare(state) };
}

export function playTurn(host: GameplayHost, state: GameState, turn: number, turnId = `t${turn}`) {
  const started = host.startTurn(state, { turnId, round: turn });
  const ended = host.endTurn(started.state, { turnId, round: turn, previousClock: structuredClone(started.state.世界.时间系统.时钟) });
  return { started, ended, state: ended.state };
}

export function flagsOf(state: GameState): Record<string, unknown> {
  return (state.flags ?? {}) as Record<string, unknown>;
}
