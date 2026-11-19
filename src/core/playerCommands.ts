/**
 * 界面发起的玩法命令统一入口：先做旅程状态检查，再在模块里结算，成功后一次性提交给引擎。
 */
import type { GameState } from '../schema/variables';
import type { WorldDef } from '../data/worlds-schema';
import { createGameplayHost } from './registry';
import type { HostOutcome } from './host';
import type { JsonRecord } from './ops';

export interface PlayerCommandEngine {
  variableManager: { getState(): GameState };
  isGenerating: boolean;
  isReadOnly: boolean;
  commitPlayerState(state: GameState): boolean;
}

export interface PlayerCommandResult {
  ok: boolean;
  feedback: string;
  outcome?: HostOutcome;
}

export function playerCommandBlocked(engine: PlayerCommandEngine): string | undefined {
  if (engine.isReadOnly) return '当前旅程为只读，无法操作。';
  if (engine.isGenerating) return '当前回合正在处理，请完成或停止后再操作。';
  const state = engine.variableManager.getState();
  if (state.v3?.pendingEncounterRequest || (state.v3?.combatSession && state.v3.combatSession.lifecycle !== 'terminal')) return '当前正在处理战斗，请完成后再操作。';
  return undefined;
}

export function runPlayerCommand(engine: PlayerCommandEngine, world: WorldDef | undefined, command: string, args: JsonRecord = {}, label?: string): PlayerCommandResult {
  const blocked = playerCommandBlocked(engine);
  if (blocked) return { ok: false, feedback: blocked };
  const current = engine.variableManager.getState();
  const host = createGameplayHost(world, current);
  const outcome = host.dispatch(host.prepare(current), command, args, { source: 'player', label: label ?? command });
  if (outcome.status !== 'applied') return { ok: false, feedback: outcome.reason ?? '当前条件不满足，操作未执行。', outcome };
  if (!engine.commitPlayerState(outcome.state)) return { ok: false, feedback: '当前旅程已变化，操作未执行，请重试。', outcome };
  return { ok: true, feedback: outcome.messages.join('；') || label || '已完成', outcome };
}
