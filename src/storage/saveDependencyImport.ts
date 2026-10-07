import { STORAGE_KEYS } from '../config/storageKeys';
import { getWorldById } from '../data/worldLoader';
import { normalizeModules } from '../modules/normalizeModule';
import { getEventDB, getWebEvent, type WebEventRecord } from '../modules/eventDb';
import { manifestSchema, ruleFileSchema } from '../modules/manifestSchema';
import { normalizeCardPackFiles } from '../modules/eventPackFormat';
import { directorDependencyReferences } from '../director/dependencies';
import { directorDefinitionKey, type DirectorDefinitionRecord } from '../director/definitionStore';
import { validateDirectorDefinition } from '../director/definitionSchema';
import type { DirectorDefinition } from '../director/definitionTypes';
import { getDB, type GameSave } from './db';

const OWNER = '_saveImportOwner';
type RecordValue = Record<string, unknown>;
type StoredEvent = WebEventRecord & { _saveImportOwner?: string; _writeRevision?: string };
export interface ImportedWorldChange { id: string; owner: string; after: RecordValue }
export interface ImportedEventChange { id: string; owner: string }
interface EventPlan { value: WebEventRecord; existing?: { revision?: string; stamp: string } }
export interface SaveDependencyPlan {
  worldId: string;
  customWorld?: RecordValue;
  world?: ImportedWorldChange;
  events: EventPlan[];
  definitions: DirectorDefinition[];
  references: ReturnType<typeof directorDependencyReferences>;
}
function plain(value: unknown): value is RecordValue { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function stableDependencyText(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableDependencyText).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableDependencyText(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function equalDirectorContent(a: DirectorDefinition, b: DirectorDefinition): boolean {
  const { createdAt: _a, ...first } = a, { createdAt: _b, ...second } = b;
  return stableDependencyText(first) === stableDependencyText(second);
}
function cleanWorld(value: RecordValue): RecordValue {
  const copy = structuredClone(value); delete copy[OWNER];
  if (copy.modules) copy.modules = normalizeModules(copy.modules as Parameters<typeof normalizeModules>[0]);
  return copy;
}
function readWorlds(): RecordValue[] {
  const raw = localStorage.getItem(STORAGE_KEYS.CUSTOM_WORLDS);
  let worlds: unknown;
  try { worlds = JSON.parse(raw ?? '[]'); } catch { throw new Error('本机世界资料损坏，未覆盖；请保留本机数据。'); }
  if (!Array.isArray(worlds) || worlds.some(world => !plain(world) || typeof world.id !== 'string')) throw new Error('本机世界资料格式无效，未覆盖。');
  return worlds;
}
function localWorld(id: string, worlds: RecordValue[]): RecordValue | undefined {
  return worlds.find(world => world.id === id) ?? getWorldById(id) as unknown as RecordValue | undefined;
}
async function prepareWorld(save: GameSave, owner: string): Promise<Pick<SaveDependencyPlan, 'worldId' | 'customWorld' | 'world'>> {
  const worldId = save.worldId || 'default';
  if (!save.customWorld) {
    if (worldId !== 'default' && !localWorld(worldId, readWorlds())) throw new Error(`缺少世界「${worldId}」的定义，请使用完整备份。`);
    return { worldId };
  }
  if (!plain(save.customWorld) || save.customWorld.id !== worldId || typeof save.customWorld.name !== 'string' || !save.customWorld.name.trim()) throw new Error('存档与嵌入世界的标识或名称无效，请重新导出完整备份。');
  const worlds = readWorlds(), incoming = cleanWorld(save.customWorld), existing = localWorld(worldId, worlds);
  if (existing && stableDependencyText(cleanWorld(existing)) === stableDependencyText(incoming)) return { worldId, customWorld: incoming };
  let finalId = worldId;
  if (existing) {
    const suffix = owner.replaceAll('-', '').slice(0, 12);
    finalId = `${worldId.slice(0, 43)}_import_${suffix}`;
    let count = 0;
    while (localWorld(finalId, worlds)) finalId = `${worldId.slice(0, 40)}_import_${suffix}_${++count}`;
    incoming.id = finalId;
  }
  return { worldId: finalId, customWorld: incoming, world: { id: finalId, owner, after: incoming } };
}
export function applyImportedWorld(plan: Pick<SaveDependencyPlan, 'worldId' | 'customWorld' | 'world'>): void {
  if (!plan.customWorld) return;
  const worlds = readWorlds(), current = localWorld(plan.worldId, worlds);
  if (!plan.world) {
    if (!current || stableDependencyText(cleanWorld(current)) !== stableDependencyText(plan.customWorld)) throw new Error('世界在导入期间已改变，请重试；本机资料已保留。');
    return;
  }
  if (current) {
    if (current[OWNER] === plan.world.owner && stableDependencyText(cleanWorld(current)) === stableDependencyText(plan.world.after)) return;
    throw new Error('世界在导入期间已改变，请重试；本机资料已保留。');
  }
  localStorage.setItem(STORAGE_KEYS.CUSTOM_WORLDS, JSON.stringify([...worlds, { ...plan.world.after, [OWNER]: plan.world.owner }]));
}
export function rollbackImportedWorld(change: ImportedWorldChange): void {
  const worlds = readWorlds(), current = worlds.find(world => world.id === change.id);
  if (!current || current[OWNER] !== change.owner || stableDependencyText(cleanWorld(current)) !== stableDependencyText(change.after)) return;
  localStorage.setItem(STORAGE_KEYS.CUSTOM_WORLDS, JSON.stringify(worlds.filter(world => world.id !== change.id)));
}

function safePath(path: string): void {
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('事件包含有无效资源路径');
}
async function decodeFiles(input: RecordValue, binaryFiles: unknown): Promise<Record<string, string | Blob>> {
  const files: Record<string, string | Blob> = {};
  for (const [path, value] of Object.entries(input)) {
    safePath(path);
    if (typeof value !== 'string' && !(value instanceof Blob)) throw new Error(`事件包资源 ${path} 不完整，请使用完整备份。`);
    files[path] = value;
  }
  if (binaryFiles !== undefined) {
    if (!plain(binaryFiles)) throw new Error('事件包二进制资源格式无效');
    for (const [path, value] of Object.entries(binaryFiles)) {
      safePath(path);
      if (path in files || !plain(value) || typeof value.base64 !== 'string' || typeof value.mimeType !== 'string' || value.base64.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64)) throw new Error(`事件包资源 ${path} 无法解码，请重新导出。`);
      files[path] = new Blob([Uint8Array.from(atob(value.base64), character => character.charCodeAt(0))], { type: value.mimeType });
    }
  }
  return files;
}
async function eventContent(record: WebEventRecord): Promise<string> {
  const files: RecordValue = {};
  for (const [path, value] of Object.entries(record.files)) {
    if (path === 'manifest.json') continue;
    if (typeof value === 'string') files[path] = value;
    else if (value instanceof Blob) {
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', await value.arrayBuffer()));
      files[path] = { mimeType: value.type, bytes: [...hash] };
    } else throw new Error(`事件包 ${record.id} 的资源 ${path} 无法读取。`);
  }
  const manifest = manifestSchema.parse(record.manifest);
  return stableDependencyText({ manifest, files, builtin: record.builtin ?? false });
}
// Normal edits assign a fresh revision; this synchronous stamp also checks legacy records.
function eventStamp(record: StoredEvent): string {
  const files = Object.fromEntries(Object.entries(record.files).map(([path, value]) => [path, value instanceof Blob ? { type: value.type, size: value.size } : value]));
  return stableDependencyText({ manifest: record.manifest, files, enabled: record.enabled, status: record.status, installedAt: record.installedAt, builtin: record.builtin });
}
export async function prepareSaveDependencies(save: GameSave, directorInput: unknown, eventInput: unknown, owner: string): Promise<SaveDependencyPlan> {
  const world = await prepareWorld(save, owner), references = directorDependencyReferences(save), definitions = new Map<string, DirectorDefinition>();
  if (directorInput !== undefined && !Array.isArray(directorInput)) throw new Error('剧情依赖格式无效');
  const db = await getDB();
  for (const input of directorInput as unknown[] ?? []) {
    const definition = validateDirectorDefinition(input as DirectorDefinition), key = directorDefinitionKey(definition.id, definition.version);
    const duplicate = definitions.get(key), existing = await db.get('director_definitions', key) as DirectorDefinitionRecord | undefined;
    if ((duplicate && !equalDirectorContent(duplicate, definition)) || (existing && !equalDirectorContent(existing.definition, definition))) throw new Error(`该剧情版本已存在，禁止覆盖：${definition.title}；请另存新版本。`);
    definitions.set(key, definition);
  }
  for (const reference of references) {
    const key = directorDefinitionKey(reference.definitionId, reference.version);
    if (!definitions.has(key) && !await db.get('director_definitions', key)) throw new Error(`导入缺少剧情版本：${reference.definitionId} / ${reference.version}；请使用完整备份。`);
  }
  if (eventInput !== undefined && !Array.isArray(eventInput)) throw new Error('事件包依赖格式无效');
  const events: EventPlan[] = [], ids = new Set<string>();
  for (const input of eventInput as unknown[] ?? []) {
    if (!plain(input) || typeof input.id !== 'string' || !plain(input.manifest) || !plain(input.files)) throw new Error('事件包备份格式无效');
    if (ids.has(input.id)) throw new Error('备份中存在重复事件包，请重新导出。'); ids.add(input.id);
    const rawManifest = { ...input.manifest };
    if (typeof input.worldId === 'string' && !rawManifest.worldId) rawManifest.worldId = input.worldId;
    if (rawManifest.worldId === save.worldId) rawManifest.worldId = world.worldId;
    const manifest = manifestSchema.parse(rawManifest);
    if (manifest.id !== input.id) throw new Error('事件包编号与清单不一致');
    let files = await decodeFiles(input.files, input.binaryFiles);
    for (const asset of manifest.assets ?? []) if (!(asset.path in files)) throw new Error(`事件包资源 ${asset.path} 缺失，请使用完整备份。`);
    for (const path of manifest.rules ?? []) {
      if (typeof files[path] !== 'string') throw new Error(`事件包规则 ${path} 缺失或格式无效。`);
      ruleFileSchema.parse(JSON.parse(files[path] as string));
    }
    if (manifest.type === 'card') { files = normalizeCardPackFiles(manifest, files).files as Record<string, string | Blob>; delete manifest.cards; }
    files['manifest.json'] = JSON.stringify(manifest, null, 2);
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('事件包启用状态格式无效');
    const enabled = input.enabled !== false;
    const value: WebEventRecord = { id: input.id, manifest, files, enabled, status: enabled ? 'enabled' : 'disabled', installedAt: new Date().toISOString(), builtin: typeof input.builtin === 'boolean' ? input.builtin : undefined };
    const stored = await (await getEventDB()).get('events', value.id) as (StoredEvent & { worldId?: string }) | undefined;
    const existing = stored && { ...stored, manifest: stored.worldId && !stored.manifest.worldId ? { ...stored.manifest, worldId: stored.worldId } : stored.manifest };
    if (existing && await eventContent(existing) !== await eventContent(value)) throw new Error(`事件包「${manifest.name}」与本机同 ID 内容冲突，请先为导入包另存新标识；本机版本已保留。`);
    events.push({ value, ...(stored ? { existing: { revision: stored._writeRevision, stamp: eventStamp(stored) } } : {}) });
  }
  for (const { value } of events) {
    for (const dependency of value.manifest.dependencies ?? []) if (!ids.has(dependency) && !await getWebEvent(dependency)) throw new Error(`事件包「${value.manifest.name}」缺少依赖 ${dependency}；请使用完整备份。`);
    if (value.enabled) for (const conflict of value.manifest.conflicts ?? []) {
      const included = events.find(event => event.value.id === conflict);
      if (included?.value.enabled || (await getWebEvent(conflict))?.enabled) throw new Error(`事件包「${value.manifest.name}」与 ${conflict} 冲突，未导入。`);
    }
  }
  return { ...world, events, definitions: [...definitions.values()], references };
}
export async function applyImportedEvents(plans: EventPlan[], owner: string): Promise<void> {
  if (!plans.length) return;
  const tx = (await getEventDB()).transaction('events', 'readwrite');
  try {
    for (const plan of plans) {
      const current = await tx.store.get(plan.value.id) as StoredEvent | undefined;
      if (plan.existing) {
        if (!current || current._writeRevision !== plan.existing.revision || eventStamp(current) !== plan.existing.stamp) throw new Error('事件包在导入期间已改变，请重试；本机版本已保留。');
      } else {
        if (current) throw new Error('事件包在导入期间已改变，请重试；本机版本已保留。');
        await tx.store.add({ ...plan.value, [OWNER]: owner });
      }
    }
    // Recheck closure under the same event DB write lock after preparation/Blob hashing.
    for (const plan of plans) {
      for (const dependency of plan.value.manifest.dependencies ?? []) if (!await tx.store.get(dependency)) throw new Error(`事件包依赖 ${dependency} 在导入期间被删除，未提交。`);
      if ((await tx.store.get(plan.value.id))?.enabled) for (const conflict of plan.value.manifest.conflicts ?? []) if ((await tx.store.get(conflict))?.enabled) throw new Error(`事件包 ${conflict} 在导入期间产生冲突，未提交。`);
    }
    await tx.done;
  } catch (error) { try { tx.abort(); } catch {} await tx.done.catch(() => {}); throw error; }
}
export async function rollbackImportedEvents(changes: ImportedEventChange[]): Promise<void> {
  if (!changes.length) return;
  const tx = (await getEventDB()).transaction('events', 'readwrite');
  for (const change of changes) {
    const current = await tx.store.get(change.id) as StoredEvent | undefined;
    if (current?.[OWNER] === change.owner) await tx.store.delete(change.id);
  }
  await tx.done;
}
export async function encodeEventDependency(record: WebEventRecord): Promise<RecordValue> {
  const files: Record<string, string> = {}, binaryFiles: Record<string, { mimeType: string; base64: string }> = {};
  for (const [path, value] of Object.entries(record.files)) {
    if (typeof value === 'string') files[path] = value;
    else if (value instanceof Blob) {
      const bytes = new Uint8Array(await value.arrayBuffer()); let binary = '';
      for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
      binaryFiles[path] = { mimeType: value.type, base64: btoa(binary) };
    } else throw new Error(`事件包 ${record.id} 的资源 ${path} 无法导出，请先修复资源。`);
  }
  return { id: record.id, manifest: record.manifest, files, enabled: record.enabled, builtin: record.builtin, ...(Object.keys(binaryFiles).length ? { binaryFiles } : {}) };
}
