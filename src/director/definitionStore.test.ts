import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import { compileDirectorDefinition, createDirectorCompileJob } from './definitionCompiler';
import { deleteDirectorWorkspace, getDirectorCompileJob, getDirectorDefinition, saveDirectorAuthorRevision, saveDirectorCompileJob, saveDirectorDefinition } from './definitionStore';
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

test('deleting a workspace removes only its own jobs and versions', async () => {
  const make = async (definitionId: string, title: string) => {
    const draft: DirectorDraft = { title, coreConflict: title, anchors: [], characters: [], stages: [{ id: 's', title, description: title, nodeIds: ['n'] }], nodes: [{ id: 'n', title, stageId: 's', intent: title, actorIds: [], execution: 'foreground', conditions: [], dependsOn: [], constraints: [], sourceRefs: ['author:0:2'] }], coverage: { complete: false, gaps: [], boundary: title } };
    const job = await compileDirectorDefinition(createDirectorCompileJob({ kind: 'author', text: title }, { definitionId }), { request: async () => JSON.stringify(draft), onCheckpoint: saveDirectorCompileJob });
    await saveDirectorDefinition(job.definition!);
    return job;
  };
  const workspace = crypto.randomUUID(), other = crypto.randomUUID();
  const target = await make(workspace, '调查'), keep = await make(other, '发现');
  await deleteDirectorWorkspace(workspace);
  expect(await getDirectorCompileJob(target.id)).toBeUndefined();
  expect(await getDirectorDefinition(target.definition!.id, target.definition!.version)).toBeUndefined();
  expect((await getDirectorCompileJob(keep.id))?.status).toBe('completed');
  expect((await getDirectorDefinition(keep.definition!.id, keep.definition!.version))?.title).toBe('发现');
});
