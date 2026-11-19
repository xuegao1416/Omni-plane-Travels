import { useLayoutEffect,useRef,useState,type RefObject } from 'react';
import type { CombatActionRecordV2,CombatSessionV2 } from '../../../gameplay/protocols';

/**
 * Turns newly resolved action records into short-lived visual events:
 * a trail from actor to each target, an impact burst, and a floating number.
 * Positions are measured from unit anchors inside the stage element, so the
 * effects land on the real medallions at any viewport size.
 */
export interface CombatFxEvent {
  id: string;
  kind: CombatActionRecordV2['kind'];
  actorId: string;
  from: { x: number; y: number };
  hits: { targetId: string; x: number; y: number; text: string; tone: 'damage' | 'critical' | 'heal' | 'miss' | 'guard' }[];
  critical: boolean;
  fromEnemy: boolean;
}

const FX_LIFETIME = 1500;

function displayAmount(session: CombatSessionV2, targetId: string, raw: number): number {
  const unit = session.participants.find(item => item.id === targetId);
  if (!unit) return raw;
  const max = Math.max(1, unit.maxHp);
  const shown = Math.max(1, Math.round(unit.stateBinding?.originalMaxHp ?? max));
  return Math.max(1, Math.round((raw / max) * shown));
}

export function useCombatFx(session: CombatSessionV2, stageRef: RefObject<HTMLElement | null>) {
  const [events, setEvents] = useState<CombatFxEvent[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const sessionId = useRef(session.id);

  useLayoutEffect(() => {
    const resolved = session.actionSequence.filter(action => action.resolved && !action.rejected);
    // First render / new session: everything already in the log is history, not news.
    if (!seen.current || sessionId.current !== session.id) {
      seen.current = new Set(resolved.map(action => action.id));
      sessionId.current = session.id;
      setEvents([]);
      return;
    }
    const fresh = resolved.filter(action => !seen.current!.has(action.id));
    if (!fresh.length) return;
    fresh.forEach(action => seen.current!.add(action.id));
    const stage = stageRef.current;
    if (!stage) return;
    const box = stage.getBoundingClientRect();
    const anchor = (id: string) => {
      const node = stage.querySelector<HTMLElement>(`[data-combat-unit="${CSS.escape(id)}"]`);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2 - box.left, y: rect.top + rect.height * 0.36 - box.top };
    };
    const next: CombatFxEvent[] = [];
    for (const action of fresh.slice(-3)) {
      const from = anchor(action.unitId);
      if (!from) continue;
      const actor = session.participants.find(unit => unit.id === action.unitId);
      const targets = action.targetIds.length ? action.targetIds : [action.unitId];
      const perTargetDamage = action.damage > 0 ? action.damage / Math.max(1, targets.filter(id => id !== action.unitId || action.kind === 'attack').length) : 0;
      const perTargetHealing = action.healing > 0 ? action.healing / Math.max(1, targets.length) : 0;
      const hits: CombatFxEvent['hits'] = [];
      for (const targetId of targets) {
        const at = anchor(targetId);
        if (!at) continue;
        let tone: CombatFxEvent['hits'][number]['tone'];
        let text: string;
        if (action.kind === 'defend') { tone = 'guard'; text = '架势'; }
        else if (action.kind === 'flee') { tone = 'guard'; text = '脱离'; }
        else if (action.hit === false) { tone = 'miss'; text = '闪避'; }
        else if (perTargetHealing > 0) { tone = 'heal'; text = `+${displayAmount(session, targetId, perTargetHealing)}`; }
        else if (perTargetDamage > 0) { tone = action.critical ? 'critical' : 'damage'; text = `-${displayAmount(session, targetId, perTargetDamage)}`; }
        else { tone = 'guard'; text = action.kind === 'item' ? '生效' : '—'; }
        hits.push({ targetId, ...at, text, tone });
      }
      next.push({ id: action.id, kind: action.kind, actorId: action.unitId, from, hits, critical: Boolean(action.critical), fromEnemy: actor?.side === 'enemy' });
    }
    if (!next.length) return;
    setEvents(previous => [...previous, ...next].slice(-6));
    const ids = new Set(next.map(event => event.id));
    window.setTimeout(() => setEvents(previous => previous.filter(event => !ids.has(event.id))), FX_LIFETIME);
  }, [session, stageRef]);

  return events;
}
