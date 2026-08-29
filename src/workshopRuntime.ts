import { getGlobal, putGlobal } from './storage/db';
import {
  deleteHistoryPreset,
  deleteNpcTemplate,
  getHistoryPresets,
  getNpcTemplates,
  saveHistoryPreset,
  saveNpcTemplate,
} from './storage/templateStore';
import {
  deleteCustomGameplayModule,
  bindCustomGameplayModule,
  restoreCustomGameplayModule,
  getCustomGameplayModule,
  saveCustomGameplayModule,
  type StoredCustomGameplayModule,
} from './custom-modules/storage';
import {
  deleteWebEvent,
  getWebEvent,
  putWebEvent,
  type WebEventRecord,
} from './modules/eventDb';
import type { EventPackType, Manifest } from './modules/schema';
import { workflowToRuleFile } from './modules/workflowConverters';
import type { WorkflowDefinition } from './modules/workflowSchema';

export type WorkshopRuntimeType =
  | 'event_pack'
  | 'workflow_pack'
  | 'adventure_pack'
  | 'visual_theme';

export interface WorkshopInstallOperation {
  label: string;
  rollback: () => Promise<void>;
}

export interface WorkshopInstallOptions {
  /** Explicit world binding for gameplay modules; never defaults to all worlds. */
  worldId?: string;
}

export interface StoredWorkshopRuntimeAsset {
  id: string;
  type: 'adventure_pack' | 'visual_theme';
  version: string;
  title: string;
  data: unknown;
  installedAt: number;
}

const RUNTIME_ASSET_KEY = 'workshopRuntimeAssets.v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function jsonCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function readRuntimeAssets(): Promise<StoredWorkshopRuntimeAsset[]> {
  const value = await getGlobal<StoredWorkshopRuntimeAsset[]>(RUNTIME_ASSET_KEY);
  return Array.isArray(value) ? value : [];
}

async function writeRuntimeAssets(value: StoredWorkshopRuntimeAsset[]): Promise<void> {
  await putGlobal(RUNTIME_ASSET_KEY, value);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('workshop-runtime-assets-changed'));
}

export async function listWorkshopRuntimeAssets(): Promise<StoredWorkshopRuntimeAsset[]> {
  return jsonCopy(await readRuntimeAssets());
}

export async function deleteWorkshopRuntimeAsset(id: string): Promise<void> {
  const assets = await readRuntimeAssets();
  await writeRuntimeAssets(assets.filter((asset) => asset.id !== id));
}

export async function updateWorkshopRuntimeAsset(
  id: string,
  patch: Pick<StoredWorkshopRuntimeAsset, 'title' | 'data'>,
): Promise<void> {
  const assets = await readRuntimeAssets();
  const index = assets.findIndex((asset) => asset.id === id);
  if (index < 0) throw new Error('找不到要编辑的本地资产');
  assets[index] = { ...assets[index], title: patch.title, data: jsonCopy(patch.data) };
  await writeRuntimeAssets(assets);
}

async function installPassiveRuntimeAsset(
  type: 'adventure_pack' | 'visual_theme',
  item: { id: string; version: string; title: string },
  data: unknown,
): Promise<WorkshopInstallOperation> {
  const assets = await readRuntimeAssets();
  const previous = assets.find((asset) => asset.id === item.id);
  const next: StoredWorkshopRuntimeAsset = {
    id: item.id,
    type,
    version: item.version,
    title: item.title,
    data: jsonCopy(data),
    installedAt: Date.now(),
  };
  await writeRuntimeAssets([...assets.filter((asset) => asset.id !== item.id), next]);
  return {
    label: `${type === 'adventure_pack' ? '冒险包' : '视觉主题'}「${item.title}」`,
    rollback: async () => {
      const current = await readRuntimeAssets();
      const restored = current.filter((asset) => asset.id !== item.id);
      if (previous) restored.push(previous);
      await writeRuntimeAssets(restored);
    },
  };
}

function asManifest(
  raw: unknown,
  item: { id: string; version: string; title: string },
  type: EventPackType,
): Manifest {
  const source = isRecord(raw) ? raw : {};
  return {
    id: typeof source.id === 'string' ? source.id : item.id,
    name: typeof source.name === 'string' ? source.name : item.title,
    version: typeof source.version === 'string' ? source.version : item.version,
    author: typeof source.author === 'string' ? source.author : '创意工坊',
    description: typeof source.description === 'string' ? source.description : undefined,
    engine: 'opt-event',
    schemaVersion: typeof source.schemaVersion === 'number' ? source.schemaVersion : 1,
    minAppVersion: typeof source.minAppVersion === 'string' ? source.minAppVersion : '3.0.0',
    type,
    coverColor: typeof source.coverColor === 'string' ? source.coverColor : '#3b82f6',
    icon: typeof source.icon === 'string' ? source.icon : 'Package',
    enabledByDefault: false,
  };
}

function stringFiles(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(value)) {
    if (typeof content !== 'string') return null;
    files[path] = content;
  }
  return files;
}

function buildEventRecord(
  item: { id: string; version: string; title: string },
  workshopType: 'event_pack' | 'workflow_pack',
  data: unknown,
): WebEventRecord {
  const source = isRecord(data) ? data : {};
  const sourceManifest = isRecord(source.manifest) ? source.manifest : source;
  const eventType: EventPackType = workshopType === 'workflow_pack'
    ? 'rule'
    : sourceManifest.type === 'card' || sourceManifest.type === 'worldbook' || sourceManifest.type === 'bundle'
      ? sourceManifest.type
      : 'rule';
  const manifest = asManifest(sourceManifest, item, eventType);
  let files = stringFiles(source.files);

  if (!files) {
    const workflow = (source.workflow ?? (workshopType === 'workflow_pack' ? source : undefined)) as WorkflowDefinition | undefined;
    if (workflow && Array.isArray(workflow.nodes) && Array.isArray(workflow.connections)) {
      files = {
        'manifest.json': JSON.stringify(manifest, null, 2),
        'schema/workflow.json': JSON.stringify(workflow, null, 2),
        'schema/rules.json': JSON.stringify(workflowToRuleFile(workflow), null, 2),
      };
    } else if (Array.isArray(source.rules) || Array.isArray(source.periodicRules)) {
      files = {
        'manifest.json': JSON.stringify(manifest, null, 2),
        'schema/rules.json': JSON.stringify({ version: 1, rules: source.rules ?? [], periodicRules: source.periodicRules ?? [] }, null, 2),
      };
    }
  }

  if (!files) throw new Error('事件包数据缺少 manifest/files 或有效工作流/规则定义');
  files['manifest.json'] = JSON.stringify(manifest, null, 2);
  return {
    id: manifest.id,
    manifest,
    enabled: false,
    status: 'installed',
    installedAt: new Date().toISOString(),
    files,
  };
}

async function installEventRuntimePack(
  item: { id: string; version: string; title: string },
  workshopType: 'event_pack' | 'workflow_pack',
  data: unknown,
): Promise<WorkshopInstallOperation> {
  const record = buildEventRecord(item, workshopType, data);
  const previous = await getWebEvent(record.id);
  await putWebEvent(record);
  return {
    label: `${workshopType === 'event_pack' ? '事件包' : '工作流包'}「${item.title}」`,
    rollback: async () => {
      if (previous) await putWebEvent(previous);
      else await deleteWebEvent(record.id);
    },
  };
}

async function installNpcRuntimeTemplate(
  item: { title: string },
  data: unknown,
): Promise<WorkshopInstallOperation> {
  const source = isRecord(data) ? data : {};
  const npc = isRecord(source.npc) ? source.npc : source;
  const name = typeof source.name === 'string' ? source.name : item.title;
  const saved = saveNpcTemplate(name, npc as unknown as Parameters<typeof saveNpcTemplate>[1]);
  return {
    label: `NPC 模板「${name}」`,
    rollback: async () => { deleteNpcTemplate(saved.id); },
  };
}

async function installHistoryRuntimePreset(
  item: { title: string },
  data: unknown,
): Promise<WorkshopInstallOperation> {
  const source = isRecord(data) ? data : {};
  const name = typeof source.name === 'string' ? source.name : item.title;
  const segments = isRecord(source.segments) ? source.segments : {};
  const saved = saveHistoryPreset(name, segments as Record<string, string>, source.includeAgeStages !== false);
  return {
    label: `人生经历「${name}」`,
    rollback: async () => { deleteHistoryPreset(saved.id); },
  };
}

async function installGameplayRuntimeModule(
  item: { id: string; title: string },
  data: unknown,
  options: WorkshopInstallOptions = {},
): Promise<WorkshopInstallOperation> {
  const candidateId = isRecord(data) && typeof data.id === 'string' ? data.id : item.id;
  const previous: StoredCustomGameplayModule | undefined = await getCustomGameplayModule(candidateId);
  const saved = await saveCustomGameplayModule(data);
  try {
    if (options.worldId) await bindCustomGameplayModule(saved.module.id, options.worldId);
  } catch (error) {
    if (previous) await restoreCustomGameplayModule(previous);
    else await deleteCustomGameplayModule(saved.module.id);
    throw error;
  }
  return {
    label: `玩法模块「${saved.module.name || item.title}」`,
    rollback: async () => {
      if (!previous) {
        await deleteCustomGameplayModule(saved.module.id);
        return;
      }
      if (saved.module.id !== previous.module.id) await deleteCustomGameplayModule(saved.module.id);
      await restoreCustomGameplayModule(previous);
    },
  };
}

export async function installWorkshopItem(
  item: { id: string; type: string; version: string; title: string },
  data: unknown,
  options: WorkshopInstallOptions = {},
): Promise<WorkshopInstallOperation> {
  switch (item.type) {
    case 'event_pack':
      return installEventRuntimePack(item, 'event_pack', data);
    case 'workflow_pack':
      return installEventRuntimePack(item, 'workflow_pack', data);
    case 'adventure_pack':
      return installPassiveRuntimeAsset('adventure_pack', item, data);
    case 'visual_theme':
      return installPassiveRuntimeAsset('visual_theme', item, data);
    case 'npc_template':
      return installNpcRuntimeTemplate(item, data);
    case 'history_preset':
      return installHistoryRuntimePreset(item, data);
    case 'gameplay_module':
      return installGameplayRuntimeModule(item, data, options);
    default:
      throw new Error(`不支持安装类型：${item.type}`);
  }
}

export async function restoreCustomWorldStorage(
  key: string,
  previous: string | null,
): Promise<void> {
  if (previous === null) localStorage.removeItem(key);
  else localStorage.setItem(key, previous);
}
