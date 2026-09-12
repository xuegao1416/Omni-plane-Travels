import type { SimulationState } from '../simulation/types';

/** Rebase scope guards, not historical event identities, when importing a copy. */
export function rebindImportedSimulation(state: SimulationState | undefined, saveId: string): SimulationState | undefined {
  if (!state) return undefined;
  const result = structuredClone(state);
  const visit = (snapshot: SimulationState) => {
    if (snapshot.director) {
      if (snapshot.director.pendingReview) snapshot.director.pendingReview.saveId = saveId;
      for (const directive of Object.values(snapshot.director.directives ?? {})) directive.saveId = saveId;
      for (const proposal of Object.values(snapshot.director.offscreenProposals ?? {})) proposal.saveId = saveId;
    }
    for (const child of snapshot.snapshots ?? []) if (child?.snapshot) visit(child.snapshot);
  };
  visit(result);
  return result;
}
