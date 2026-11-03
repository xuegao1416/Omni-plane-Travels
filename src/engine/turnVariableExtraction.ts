import { runVariableExtraction } from './variableExtraction';
import { VariableManager } from './variableManager';
import { getTimeSystemFromWorld } from '../time/worldClock';
import { findWorldDef } from '../data/worldLoader';
import { eventBus, EVENTS } from './eventBus';
import type { CombatEncounterRequest } from '../gameplay/protocols';

export async function runTurnVariableExtraction(params: Parameters<typeof runVariableExtraction>[0]): Promise<void> {
  const state = params.varMgr.getState();
  const version = JSON.stringify(state);
  const draft = new VariableManager(state, undefined, getTimeSystemFromWorld(findWorldDef(params.worldId)));
  const encounters: CombatEncounterRequest[] = [];
  const isCurrent = () => params.isCurrent?.() !== false && JSON.stringify(params.varMgr.getState()) === version;
  try {
    await runVariableExtraction({ ...params, varMgr: draft, isCurrent, onUpdate: () => {}, onEncounter: request => { encounters.push(request); } });
  } catch (error) {
    // A conservative local encounter can remain valid even when extraction fails.
    if (isCurrent() && !params.signal?.aborted) for (const encounter of encounters) eventBus.emit(EVENTS.COMBAT_ENCOUNTER_REQUESTED, encounter);
    throw error;
  }
  params.signal?.throwIfAborted();
  if (!isCurrent()) throw new DOMException('变量请求等待期间游戏状态已变化', 'AbortError');
  params.varMgr.setState(draft.getState());
  for (const encounter of encounters) eventBus.emit(EVENTS.COMBAT_ENCOUNTER_REQUESTED, encounter);
  eventBus.emit(EVENTS.VARIABLE_UPDATE_ENDED);
}
