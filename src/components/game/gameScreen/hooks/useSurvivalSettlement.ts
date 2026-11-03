import { useEffect, useRef } from 'react';
import { eventBus, EVENTS } from '../../../../engine/eventBus';
import type { GameEngine } from '../../../../engine/types';
import type { WorldDef } from '../../../../data/worlds-schema';
import type { ResourceChangeLog } from '../../../../gameplay/settleTurnCycles';
export type { ResourceChangeLog } from '../../../../gameplay/settleTurnCycles';

/** Display projection only. Successful engine turns own all resource settlement. */
export function useSurvivalSettlement(engine: GameEngine, worldDef: WorldDef | undefined, bumpVersion: () => void) {
  const logRef = useRef<ResourceChangeLog[]>([]);
  useEffect(() => {
    logRef.current = [];
    return eventBus.on(EVENTS.TURN_SETTLED, (owner: GameEngine['variableManager'], changeLog?: ResourceChangeLog) => {
      if (owner !== engine.variableManager || !changeLog) return;
      logRef.current = [...logRef.current, structuredClone(changeLog)].slice(-50);
      bumpVersion();
    });
  }, [engine, worldDef?.id, bumpVersion]);
  return { getChangeLog: () => logRef.current, clearChangeLog: () => { logRef.current = []; } };
}
