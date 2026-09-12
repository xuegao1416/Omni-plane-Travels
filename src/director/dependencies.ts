import type { DirectorDefinition } from './definitionTypes';
import { getDirectorDefinition, saveDirectorDefinition } from './definitionStore';
import { validateDirectorDefinition } from './definitionSchema';
import type { SimulationState } from '../simulation/types';

interface DependencyOwner {
  simulationState?: SimulationState;
  customWorld?: Record<string, unknown>;
}

function references(owner: DependencyOwner): Array<{ definitionId: string; version: string }> {
  const sources: Array<{ definitionId?: string; version: string } | undefined> = [];
  const visit = (state?: SimulationState) => {
    if (!state) return;
    sources.push(state.director?.sourceBinding);
    for (const snapshot of state.snapshots ?? []) visit(snapshot.snapshot);
  };
  visit(owner.simulationState);
  const template = owner.customWorld?.directorSource as { definitionId?: unknown; version?: unknown } | undefined;
  const refs = [...sources, template].filter((value): value is { definitionId: string; version: string } => typeof value?.definitionId === 'string' && typeof value.version === 'string');
  return refs.filter((ref, index) => refs.findIndex(other => other.definitionId === ref.definitionId && other.version === ref.version) === index);
}

export async function collectDirectorDependencies(owner: DependencyOwner): Promise<DirectorDefinition[]> {
  return Promise.all(references(owner).map(async ref => {
    const definition = await getDirectorDefinition(ref.definitionId, ref.version);
    if (!definition) throw new Error(`存档依赖的剧情版本缺失：${ref.definitionId} / ${ref.version}`);
    return definition;
  }));
}

export async function restoreDirectorDependencies(owner: DependencyOwner, input: unknown): Promise<void> {
  if (input !== undefined && !Array.isArray(input)) throw new Error('剧情依赖格式无效');
  const definitions: DirectorDefinition[] = (input ?? []).map((value: DirectorDefinition) => validateDirectorDefinition(value));
  for (const ref of references(owner)) {
    if (!definitions.some(item => item.id === ref.definitionId && item.version === ref.version) && !await getDirectorDefinition(ref.definitionId, ref.version)) {
      throw new Error(`导入缺少剧情版本：${ref.definitionId} / ${ref.version}`);
    }
  }
  for (const definition of definitions) await saveDirectorDefinition(definition);
}
