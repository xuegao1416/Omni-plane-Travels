import 'fake-indexeddb/auto';
import { afterEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { findWorldDef } from '../../data/worldLoader';
import { createDefaultGameState } from '../../schema/variables';
import { decodeSaveFile } from '../../storage/saveFileCodec';
import { eventBus, EVENTS } from '../eventBus';
import { createPipelineStatus } from '../pipelineTypes';
import type { PipelineResult } from '../pipelineExecutor';
import type { TurnSettlementInput } from '../turnSettlement';
import type { GameEngine } from '../types';
import { useGameEngine } from '../useGameEngine';
import { VariableManager } from '../variableManager';
import { beginTurn, readyToSettle, settleTurnOnce } from './lifecycle';

function managerFor(worldId: string): VariableManager {
  const manager = new VariableManager(createDefaultGameState());
  manager.bindWorld(findWorldDef(worldId));
  return manager;
}

function pipelineResult(options: { main?: 'success' | 'error'; variable?: 'success' | 'skipped' | 'error'; content?: string } = {}): PipelineResult {
  const status = createPipelineStatus(1);
  status.stages.main.status = options.main ?? 'success';
  status.stages.variable.status = options.variable ?? 'success';
  return { status, mainResult: { text: options.content ?? '<contenttext>你等了十分钟。</contenttext>', parsed: { content: options.content ?? '你等了十分钟。', thinking: '' } } };
}

function settlementInput(worldId: string): TurnSettlementInput {
  return { world: structuredClone(findWorldDef(worldId)), narrativeDecisionRequest: { saveId: 'test', decisionIds: [] }, internalContinuation: false, mechanicalTickSettled: true, done: false } as unknown as TurnSettlementInput;
}

const listeners: Array<() => void> = [];
function record(event: string): unknown[][] {
  const calls: unknown[][] = [];
  const handler = (...args: unknown[]) => { calls.push(args); };
  eventBus.on(event, handler);
  listeners.push(() => eventBus.off(event, handler));
  return calls;
}
afterEach(() => { while (listeners.length) listeners.pop()!(); });

describe('回合编排（engine/turn/lifecycle）', () => {
  test('回合开始只结算一次；计算期间回合失效时不写回', () => {
    const manager = managerFor('stranded_island');
    const updates = record(EVENTS.VARIABLE_UPDATE_ENDED);
    const tick = () => manager.getState().simulationRuntime?.tick ?? 0;
    expect(beginTurn(manager, { turnId: 't1', round: 1, userText: '等待' })).not.toBeNull();
    expect(tick()).toBe(1);
    expect(updates).toHaveLength(1);
    expect(beginTurn(manager, { turnId: 't1', round: 1, userText: '等待' })).toBeNull();
    expect(tick()).toBe(1);

    const before = JSON.stringify(manager.getState());
    expect(() => beginTurn(manager, { turnId: 't2', round: 2, userText: '等待' }, { assertCurrent: () => { throw new DOMException('回合已失效', 'AbortError'); } })).toThrow('回合已失效');
    expect(JSON.stringify(manager.getState())).toBe(before);
  });

  test('只有正文成功、变量阶段成功或跳过时才结算，并且每回合只结算一次', () => {
    expect(readyToSettle(pipelineResult({ main: 'error' }), true)).toBe(false);
    expect(readyToSettle(pipelineResult({ content: '   ' }), true)).toBe(false);
    expect(readyToSettle(pipelineResult({ variable: 'error' }), true)).toBe(false);
    expect(readyToSettle(pipelineResult({ variable: 'error' }), false)).toBe(true);
    expect(readyToSettle(pipelineResult({ variable: 'skipped' }), true)).toBe(true);

    const manager = managerFor('stranded_island');
    beginTurn(manager, { turnId: 't1', round: 1, userText: '等待' });
    const settled = record(EVENTS.TURN_SETTLED);
    const combats = record(EVENTS.COMBAT_ENCOUNTER_REQUESTED);
    const settlement = settlementInput('stranded_island');
    expect(settleTurnOnce(manager, settlement, pipelineResult({ variable: 'error' }), { turnId: 't1', round: 1, userText: '等待' }, { variableEnabled: true })).toBe(false);
    expect(settlement.done).toBe(false);
    expect(settleTurnOnce(manager, settlement, pipelineResult(), { turnId: 't1', round: 1, userText: '等待' }, { variableEnabled: true, encounter: { id: 'ambush' } })).toBe(true);
    expect(settlement.done).toBe(true);
    expect(settled).toHaveLength(1);
    expect(combats).toEqual([[{ id: 'ambush' }]]);
    expect(settleTurnOnce(manager, settlement, pipelineResult(), { turnId: 't1', round: 1, userText: '等待' }, { variableEnabled: true })).toBe(false);
    expect(settled).toHaveLength(1);
  });
});

describe('引擎新增的 dispatch', () => {
  async function mountWuxia(): Promise<GameEngine> {
    const raw = await decodeSaveFile(new Blob([await Bun.file(new URL('../../__tests__/fixtures/saves/handoff/03-wuxia_world.save.zip', import.meta.url)).arrayBuffer()])) as { save: Record<string, any> };
    let engine!: GameEngine;
    renderToString(createElement(() => {
      engine = useGameEngine({ apiKey: 'test', baseUrl: 'https://example.test', model: 'test', provider: 'custom', stream: false }, undefined, raw.save.worldId);
      return null;
    }));
    engine.reset();
    engine.loadSave({ ...raw.save, messages: raw.save.messages ?? [] } as never);
    return engine;
  }

  test('玩家命令经宿主结算后一次性提交；重复或失败的命令不改状态', async () => {
    const engine = await mountWuxia();
    const updates = record(EVENTS.VARIABLE_UPDATE_ENDED);
    const first = engine.dispatch('dice.roll', { requestId: 'check-1', attribute: '膂力', dc: 10 }, '膂力检定');
    expect(first.ok).toBe(true);
    expect(engine.variableManager.getState().dice?.history?.some(item => item.requestId === 'check-1')).toBe(true);
    expect(updates.length).toBeGreaterThan(0);

    const before = JSON.stringify(engine.variableManager.getState());
    const again = engine.dispatch('dice.roll', { requestId: 'check-1', attribute: '膂力', dc: 10 });
    expect(again).toMatchObject({ ok: false, feedback: '这次检定已经结算过了' });
    expect(engine.dispatch('economy.sell', { goodId: 'x', quantity: 1 }).ok).toBe(false);
    expect(JSON.stringify(engine.variableManager.getState())).toBe(before);
  });
});
