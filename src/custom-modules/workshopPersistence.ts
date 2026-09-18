import { getDB } from '../storage/db';
import type { CustomModuleAgentWorldContext } from './agentSession';
import { migrateWorkshopSession, recoverWorkshopSession, type WorkshopSession } from './workshopSession';

const indexKey = (worldId: string) => `moduleWorkshop.v3.world.${worldId}`;
const sessionKey = (sessionId: string) => `moduleWorkshop.v3.session.${sessionId}`;
interface WorkshopIndex { sessionIds: string[]; migrated: true }

export async function insertWorkshopSession(session: WorkshopSession): Promise<WorkshopSession> {
  const db = await getDB();
  const transaction = db.transaction('global', 'readwrite');
  const store = transaction.objectStore('global');
  const current = await store.get(sessionKey(session.id));
  if (current) { await transaction.done; throw new Error('会话已经存在'); }
  const previous = (await store.get(indexKey(session.world.id)))?.value as WorkshopIndex | undefined;
  const saved = { ...session, version: 1, updatedAt: Date.now() };
  await store.put({ key: sessionKey(saved.id), value: saved });
  await store.put({ key: indexKey(saved.world.id), value: { sessionIds: [...(previous?.sessionIds ?? []), saved.id], migrated: true } satisfies WorkshopIndex });
  await transaction.done;
  return saved;
}

export async function persistWorkshopSession(session: WorkshopSession, expectedVersion: number, isCurrent: () => boolean = () => true): Promise<WorkshopSession> {
  const db = await getDB();
  const transaction = db.transaction('global', 'readwrite');
  const store = transaction.objectStore('global');
  const previous = (await store.get(sessionKey(session.id)))?.value as WorkshopSession | undefined;
  if (!isCurrent()) { await transaction.done; throw new DOMException('执行已停止', 'AbortError'); }
  if (!previous || previous.version !== expectedVersion || previous.world.id !== session.world.id) {
    await transaction.done;
    throw new Error('会话已在其他窗口发生变化，请重新打开会话后继续。');
  }
  const saved = { ...session, version: expectedVersion + 1, updatedAt: Date.now() };
  await store.put({ key: sessionKey(saved.id), value: saved });
  await transaction.done;
  return saved;
}

export async function removeWorkshopSession(sessionId: string, worldId: string, expectedVersion: number): Promise<void> {
  const db = await getDB();
  const transaction = db.transaction('global', 'readwrite');
  const store = transaction.objectStore('global');
  const current = (await store.get(sessionKey(sessionId)))?.value as WorkshopSession | undefined;
  if (!current || current.version !== expectedVersion || current.world.id !== worldId) {
    await transaction.done;
    throw new Error('会话已发生变化，请重新打开后删除。');
  }
  const index = (await store.get(indexKey(worldId)))?.value as WorkshopIndex;
  await store.delete(sessionKey(sessionId));
  await store.put({ key: indexKey(worldId), value: { ...index, sessionIds: index.sessionIds.filter(id => id !== sessionId) } });
  await transaction.done;
}

export async function loadWorkshopSessions(world: CustomModuleAgentWorldContext): Promise<WorkshopSession[]> {
  const db = await getDB();
  const transaction = db.transaction('global', 'readwrite');
  const store = transaction.objectStore('global');
  let index = (await store.get(indexKey(world.id)))?.value as WorkshopIndex | undefined;
  if (!index) {
    const legacy = (await store.get('customModuleAgentSessions.v3'))?.value?.[world.id];
    // The original record is retained even after conversion, for recoverable imports.
    let migrated: WorkshopSession | undefined;
    try { migrated = migrateWorkshopSession(legacy, world); }
    catch (error) { await transaction.done; throw new Error(`旧共创草稿转换失败，原始数据已保留：${error instanceof Error ? error.message : String(error)}`); }
    index = { sessionIds: migrated ? [migrated.id] : [], migrated: true };
    if (migrated) await store.put({ key: sessionKey(migrated.id), value: { ...migrated, version: 1 } });
    await store.put({ key: indexKey(world.id), value: index });
  }
  const sessions: WorkshopSession[] = [];
  for (const id of index.sessionIds) {
    const saved = (await store.get(sessionKey(id)))?.value as WorkshopSession | undefined;
    if (!saved || saved.sessionVersion !== 3 || saved.world.id !== world.id) {
      await transaction.done;
      throw new Error('工坊会话数据不完整，原始数据已保留。');
    }
    const interrupted = saved.runs.some(run => run.status === 'running') || saved.messages.some(message => message.status === 'running');
    const session = interrupted ? { ...recoverWorkshopSession(saved), version: saved.version + 1 } : saved;
    if (interrupted) await store.put({ key: sessionKey(id), value: session });
    sessions.push({ ...session, world });
  }
  await transaction.done;
  return sessions.sort((left, right) => right.updatedAt - left.updatedAt);
}
