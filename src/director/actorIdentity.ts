import type { DirectorState } from './types';

/** Resolve an authored character only after the variable owner has introduced it. */
export function reconcileDirectorActors(director: DirectorState, roster: Record<string, { 姓名: string }>): void {
  const source = director.sourceBinding;
  if (!source?.actorNames) return;
  const bound = source.roleBinding ??= {};
  const normalize = (name: string) => name.normalize('NFKC').trim();
  for (const [actorId, name] of Object.entries(source.actorNames)) {
    if (actorId === 'player' || Object.hasOwn(bound, actorId) || Object.values(bound).includes(actorId)) continue;
    const names = new Set([name, ...(source.actorAliases?.[actorId] ?? [])].map(normalize));
    const matches = Object.entries(roster).filter(([id, npc]) => !Object.values(bound).includes(id) && (id === actorId || names.has(normalize(npc.姓名))));
    if (matches.length !== 1) continue;
    const canonicalId = matches[0]![0];
    bound[actorId] = canonicalId;
    source.actorNames[canonicalId] = name;
    if (source.actorAliases?.[actorId]) source.actorAliases[canonicalId] = [...source.actorAliases[actorId]!];
    for (const plan of Object.values(director.plans)) {
      if (['occurred', 'invalid', 'superseded'].includes(plan.status)) continue;
      plan.participants = plan.participants.map(id => id === actorId ? canonicalId : id);
      for (const dependency of plan.dependencies) {
        if (dependency.kind === 'entity' && dependency.ref === actorId) dependency.ref = canonicalId;
      }
    }
  }
}
