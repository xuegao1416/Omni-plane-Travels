import { getDB, DIRECTOR_DEFINITIONS_STORE, DIRECTOR_JOBS_STORE } from '../storage/db';
import type { DirectorDefinition } from './definitionTypes';
import { contentHash, type DirectorCompileJob } from './definitionCompiler';
import { validateDirectorDefinition, validateDirectorDraft, type DirectorDraft } from './definitionSchema';

export const directorDefinitionKey = (id: string, version: string) => JSON.stringify([id, version]);
export interface DirectorDefinitionRecord { id: string; definition: DirectorDefinition }

/** Immutable content version. Concurrent imports can only insert identical content. */
export async function saveDirectorDefinition(definition: DirectorDefinition): Promise<void> {
  validateDirectorDefinition(definition);
  const db = await getDB();
  const tx = db.transaction(DIRECTOR_DEFINITIONS_STORE, 'readwrite');
  const key = directorDefinitionKey(definition.id, definition.version);
  const existing: DirectorDefinitionRecord | undefined = await tx.store.get(key);
  if (existing) {
    const { createdAt: oldTime, ...oldContent } = existing.definition;
    const { createdAt: newTime, ...newContent } = definition;
    if (contentHash(oldContent) !== contentHash(newContent)) {
      await tx.done;
      throw new Error('该剧情版本已存在，禁止覆盖；请另存新版本');
    }
  } else await tx.store.add({ id: key, definition: structuredClone(definition) } satisfies DirectorDefinitionRecord);
  await tx.done;
}

export async function getDirectorDefinition(id: string, version: string): Promise<DirectorDefinition | undefined> {
  const db = await getDB();
  const record: DirectorDefinitionRecord | undefined = await db.get(DIRECTOR_DEFINITIONS_STORE, directorDefinitionKey(id, version));
  return record && validateDirectorDefinition(record.definition);
}

export async function listDirectorDefinitions(id?: string): Promise<DirectorDefinition[]> {
  const db = await getDB();
  const records: DirectorDefinitionRecord[] = await db.getAll(DIRECTOR_DEFINITIONS_STORE);
  return records.map(r => validateDirectorDefinition(r.definition)).filter(d => !id || d.id === id).sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveDirectorAuthorRevision(base: DirectorDefinition, changes: DirectorDraft): Promise<DirectorDefinition> {
  validateDirectorDraft(changes);
  const definition: DirectorDefinition = { ...structuredClone(base), ...changes, version: `edit-${crypto.randomUUID()}`, createdAt: Math.max(Date.now(), base.createdAt + 1), editedByAuthor: true };
  await saveDirectorDefinition(definition);
  return definition;
}

export async function saveDirectorCompileJob(job: DirectorCompileJob): Promise<void> {
  const db = await getDB();
  await db.put(DIRECTOR_JOBS_STORE, structuredClone(job));
}

export async function getDirectorCompileJob(id: string): Promise<DirectorCompileJob | undefined> {
  return (await getDB()).get(DIRECTOR_JOBS_STORE, id);
}

export async function listDirectorCompileJobs(definitionId?: string): Promise<DirectorCompileJob[]> {
  const jobs: DirectorCompileJob[] = await (await getDB()).getAll(DIRECTOR_JOBS_STORE);
  return jobs.filter(job => !definitionId || job.definitionId === definitionId).sort((a, b) => b.updatedAt - a.updatedAt);
}
