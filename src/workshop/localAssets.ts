/**
 * localAssets.ts — 可以发布到创意工坊的本地资产，以及把它们转换成发布用的 JSON。
 * “本地资产”页和工坊的发布表单共用这里的分类与转换规则。
 */
import { STORAGE_KEYS } from '../config/storageKeys';
import type { WorldDef } from '../data/worlds-schema';
import { listCustomGameplayModules } from '../custom-modules/storage';
import { allWebEvents, type WebEventRecord } from '../modules/eventDb';
import { getNpcTemplates } from '../storage/templateStore';
import type { PublicWorkshopType } from '../workshopCatalog';
import { adventureEventPackId } from './adventure';
import { listWorkshopRuntimeAssets } from './runtimeAssets';

export interface PublishableAsset {
  id: string;
  name: string;
  desc: string;
  raw: unknown;
}

/** 规则包与带 workflow.json 的包归为工作流包，其余为事件包（与“本地资产”页一致）。 */
export function isWorkflowRecord(record: WebEventRecord): boolean {
  return record.manifest.type === 'rule' || typeof record.files['schema/workflow.json'] === 'string';
}

/** 冒险包编译出的事件卡包：由冒险包原件管理，不单独列出或发布。 */
export async function adventureCompiledPackIds(): Promise<Set<string>> {
  try {
    return new Set((await listWorkshopRuntimeAssets()).filter(asset => asset.type === 'adventure_pack').map(asset => adventureEventPackId(asset.data)));
  } catch {
    return new Set();
  }
}

export async function listPublishableAssets(type: PublicWorkshopType): Promise<PublishableAsset[]> {
  switch (type) {
    case 'world_package': {
      try {
        const worlds = JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_WORLDS) || '[]') as WorldDef[];
        return Array.isArray(worlds) ? worlds.filter(world => world?.id).map(world => ({ id: world.id, name: world.name || '未命名世界', desc: world.description || '', raw: world })) : [];
      } catch {
        return [];
      }
    }
    case 'npc_template':
      return getNpcTemplates().map(template => ({ id: template.id, name: template.name || template.npc?.name || '未命名 NPC', desc: template.npc?.background || template.npc?.occupation || '', raw: template }));
    case 'gameplay_module':
      return (await listCustomGameplayModules()).map(record => ({ id: record.module.id, name: record.module.name || '未命名玩法模块', desc: record.module.description || '', raw: record }));
    case 'event_pack':
    case 'workflow_pack': {
      const compiled = await adventureCompiledPackIds();
      return (await allWebEvents())
        .filter(record => !record.builtin && !compiled.has(record.id) && (isWorkflowRecord(record) ? 'workflow_pack' : 'event_pack') === type)
        .map(record => ({ id: record.id, name: record.manifest.name || record.id, desc: record.manifest.description || '', raw: record }));
    }
    case 'adventure_pack':
    case 'visual_theme':
      return (await listWorkshopRuntimeAssets()).filter(asset => asset.type === type).map(asset => ({ id: asset.id, name: asset.title || asset.id, desc: '', raw: asset }));
    default:
      return [];
  }
}

async function eventRecordData(record: WebEventRecord): Promise<Record<string, unknown>> {
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(record.files)) {
    if (typeof content === 'string') files[path] = content;
    // 图片不随包发布（工坊只存 JSON）；文本资源转成字符串。
    else if (!content.type.startsWith('image/')) files[path] = await content.text();
  }
  if (!files['manifest.json']) files['manifest.json'] = JSON.stringify(record.manifest, null, 2);
  return { manifest: record.manifest, files };
}

/** 本地资产 → 发布用的 JSON。 */
export async function portableAssetData(type: PublicWorkshopType, raw: unknown): Promise<unknown> {
  const source = raw as Record<string, any>;
  if (type === 'event_pack') return eventRecordData(raw as WebEventRecord);
  if (type === 'workflow_pack') {
    const workflow = (raw as WebEventRecord).files['schema/workflow.json'];
    if (typeof workflow !== 'string') throw new Error('工作流包缺少 workflow.json');
    return JSON.parse(workflow);
  }
  if (type === 'gameplay_module') return source.module;
  if (type === 'adventure_pack' || type === 'visual_theme') return source.data;
  return raw;
}
