import type { DirectorState } from './types';
import { remapAuthoredEffect } from './sourceAdapter';

/** Resolve an authored character only after the variable owner has introduced it. */
export function reconcileDirectorActors(director: DirectorState, roster: Record<string, { 姓名: string }>): void {
  const source = director.sourceBinding;
  if (!source?.actorNames) return;
  const bound = source.roleBinding ??= {};
  const normalize = (name: string) => name.normalize('NFKC').trim();
  for (const [actorId, name] of Object.entries(source.actorNames)) {
    if (actorId === 'player' || Object.hasOwn(bound, actorId) || Object.values(bound).includes(actorId)) continue;
    const names = new Set([name, ...(source.actorAliases?.[actorId] ?? [])].map(normalize));
    const matches = Object.entries(roster).filter(([id, npc]) => {
      if (Object.values(bound).includes(id)) return false;
      if (id === actorId) return true;
      const candidateName = normalize(npc.姓名);
      if (!names.has(candidateName)) return false;
      // A name match must be unique in both directions, not just in the roster.
      return !Object.entries(source.actorNames!).some(([otherId, otherName]) =>
        otherId !== actorId && otherId !== 'player' && !Object.values(bound).includes(otherId)
        && [otherName, ...(source.actorAliases?.[otherId] ?? [])].some(value => normalize(value) === candidateName));
    });
    if (matches.length !== 1) continue;
    const canonicalId = matches[0]![0];
    bound[actorId] = canonicalId;
    source.actorNames[canonicalId] = name;
    if (source.actorAliases?.[actorId]) source.actorAliases[canonicalId] = [...source.actorAliases[actorId]!];
    for (const plan of Object.values(director.plans)) {
      if (['occurred', 'invalid', 'superseded'].includes(plan.status)) continue;
      plan.participants = plan.participants.map(id => id === actorId ? canonicalId : id);
      plan.authorEffects = plan.authorEffects?.map(effect => remapAuthoredEffect(effect, { [actorId]: canonicalId }));
      for (const dependency of plan.dependencies) {
        if (dependency.kind === 'entity' && dependency.ref === actorId) dependency.ref = canonicalId;
      }
    }
  }
}
