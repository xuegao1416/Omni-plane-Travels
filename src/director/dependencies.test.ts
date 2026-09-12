import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import { collectDirectorDependencies, restoreDirectorDependencies } from './dependencies';
import { saveDirectorDefinition, getDirectorDefinition } from './definitionStore';
import { compileDirectorDefinition, createDirectorCompileJob } from './definitionCompiler';
import { createEmptySimState } from '../simulation/types';
import { bindDirectorDefinition } from './sourceAdapter';
import { ensureDirectorState } from './runtime';

test('immutable bound definition survives dependency export/import and conflicts never overwrite', async () => {
  const draft = { title: '来信', coreConflict: '调查', anchors: [], characters: [], stages: [{ id: 's', title: '调查', description: '调查', nodeIds: ['n'] }], nodes: [{ id: 'n', stageId: 's', title: '来信', intent: '玩家收到来信', actorIds: [], execution: 'foreground', conditions: [], dependsOn: [], constraints: [], sourceRefs: ['author:0:2'] }], coverage: { complete: true, gaps: [], boundary: '来信之后无原稿' } };
  const compiled = await compileDirectorDefinition(createDirectorCompileJob({ kind: 'author', text: '来信' }), { request: async () => JSON.stringify(draft) });
  const definition = compiled.definition!;
  await saveDirectorDefinition(definition);
  const simulationState = createEmptySimState();
  bindDirectorDefinition(ensureDirectorState(simulationState), definition);
  const bundle = await collectDirectorDependencies({ simulationState });
  expect(bundle).toHaveLength(1);
  expect(await collectDirectorDependencies({ customWorld: { directorSource: { definitionId: definition.id, version: definition.version } } })).toEqual(bundle);
  const snapshotOnly = createEmptySimState();
  snapshotOnly.snapshots = [{ id: 'rollback', snapshot: simulationState } as any];
  expect(await collectDirectorDependencies({ simulationState: snapshotOnly })).toEqual(bundle);
  await restoreDirectorDependencies({ simulationState }, JSON.parse(JSON.stringify(bundle)));
  expect((await getDirectorDefinition(definition.id, definition.version))?.nodes[0].intent).toBe('玩家收到来信');
  await expect(restoreDirectorDependencies({ simulationState }, [{ ...definition, title: '被覆盖' }])).rejects.toThrow('禁止覆盖');
  expect((await getDirectorDefinition(definition.id, definition.version))?.title).toBe('来信');
  await expect(restoreDirectorDependencies({}, undefined)).resolves.toBeUndefined();
});
