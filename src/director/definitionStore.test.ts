import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import { compileDirectorDefinition, createDirectorCompileJob } from './definitionCompiler';
import { getDirectorCompileJob, getDirectorDefinition, saveDirectorAuthorRevision, saveDirectorCompileJob, saveDirectorDefinition } from './definitionStore';
import type { DirectorDraft } from './definitionSchema';

test('immutable versions and resumable jobs survive database round trips', async () => {
  const draft: DirectorDraft = { title: '调查', coreConflict: '调查', anchors: [], characters: [], stages: [{ id: 's', title: '调查', description: '调查', nodeIds: ['n'] }], nodes: [{ id: 'n', title: '发现', stageId: 's', intent: '发现', actorIds: [], execution: 'foreground', conditions: [], dependsOn: [], constraints: [], sourceRefs: ['author:0:2'] }], coverage: { complete: false, gaps: [], boundary: '到发现' } };
  const job = await compileDirectorDefinition(createDirectorCompileJob({ kind: 'author', text: '发现' }, { definitionId: crypto.randomUUID() }), { request: async () => JSON.stringify(draft), onCheckpoint: saveDirectorCompileJob });
  const definition = job.definition!;
  await saveDirectorDefinition(definition);
  await expect(saveDirectorDefinition({ ...definition, title: '覆盖' })).rejects.toThrow('禁止覆盖');
  const { schemaVersion, id, version, source, createdAt, editedByAuthor, ...editable } = definition;
  const revision = await saveDirectorAuthorRevision(definition, { ...editable, title: '修改标题' });
  expect(revision.version).not.toBe(definition.version);
  expect((await getDirectorDefinition(definition.id, definition.version))?.title).toBe('调查');
  expect((await getDirectorDefinition(revision.id, revision.version))?.title).toBe('修改标题');
  expect((await getDirectorCompileJob(job.id))?.status).toBe('completed');
});
