import type { GameSave } from './db';
import { imageDb, type ImageBlobRecord as AssetRecord, type ImageGenerationMetadata as AssetGenerationMetadata } from './imageDb';

export interface PortableSaveAsset extends Omit<AssetRecord, 'blob'> { base64?: string; blob?: Blob }
const localKey = (value: unknown): value is string => typeof value === 'string' && !!value && !/^(?:data:|blob:|https?:|\/)/i.test(value);
const referenceFields = new Set(['portraitBlobKey', 'portraitKey', 'imageBlobKey', 'imageKey', 'assetKey']);
export function assetReferences(save: GameSave) {
  const required = new Set<string>(), optional = new Set<string>(), messageIds = new Set<string>(), npcNames = new Set<string>();
  const sessionIds = new Set([save.id, ...(save.assetSourceSessionIds ?? [])]);
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object' || value instanceof Blob) return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const object = value as Record<string, unknown>;
    if ((object.role === 'assistant' || object.role === 'user') && typeof object.id === 'string') messageIds.add(object.id);
    for (const [field, child] of Object.entries(object)) {
      if (field === 'assets') continue;
      if (referenceFields.has(field) && localKey(child)) required.add(child);
      if (field === '人物档案' && child && typeof child === 'object') for (const [id, npc] of Object.entries(child)) {
        optional.add(`portrait-${id}`); if (npc && typeof npc === 'object' && typeof npc.姓名 === 'string') npcNames.add(npc.姓名);
      }
      visit(child);
    }
  };
  visit(save);
  return { required, optional, messageIds, npcNames, sessionIds };
}

/** Follow current and historical references; do not copy every other journey's image library. */
export async function collectSaveAssets(save: GameSave) {
  const records = await imageDb.getAllBlobsStrict();
  const references = assetReferences(save), selected = new Set(references.required);
  const byKey = new Map(records.map(record => [record.key, record]));
  for (const key of references.required) if (!byKey.has(key)) {
    throw new Error(`无法生成完整备份，缺少图片 ${key}；原存档和已有图片已保留。`);
  }
  for (const key of references.optional) if (byKey.has(key)) selected.add(key);
  for (const name of references.npcNames) {
    const fallback = records.filter(record => record.key.startsWith('portrait-') && record.npcName === name)
      .sort((a, b) => b.createdAt - a.createdAt || a.key.localeCompare(b.key))[0];
    if (fallback) selected.add(fallback.key);
  }
  const inlinePrefixes = [...references.messageIds].map(id => id.replace(/[^a-zA-Z0-9_-]/g, '_'));
  for (const record of records) {
    const generation = record.generation;
    const matchesMessage = inlinePrefixes.some(id => record.key.startsWith(`inline-story-${id}_inline-image_`));
    if (matchesMessage || (generation?.sessionId && references.sessionIds.has(generation.sessionId))
      || (generation?.messageId && references.messageIds.has(generation.messageId)
        && (!generation.sessionId || references.sessionIds.has(generation.sessionId)))) selected.add(record.key);
  }
  for (const key of [...selected]) {
    const generation = byKey.get(key)?.generation;
    if (generation && byKey.has(generation.id)) selected.add(generation.id);
  }
  return { assets: await Promise.all(records.filter(record => selected.has(record.key)).map(encodePortableAsset)) };
}
export async function encodePortableAsset(record: AssetRecord): Promise<PortableSaveAsset> {
  const bytes = new Uint8Array(await record.blob.arrayBuffer()); let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  const { blob: _, ...metadata } = record; return { ...metadata, base64: btoa(binary) };
}
export function decodePortableAssets(input: unknown): AssetRecord[] {
  if (!Array.isArray(input)) throw new Error('图片备份清单格式无效');
  const keys = new Set<string>();
  return input.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('图片备份记录格式无效');
    const record = value as Record<string, unknown>;
    if (!localKey(record.key) || keys.has(record.key) || typeof record.mimeType !== 'string' || !record.mimeType.startsWith('image/')
      || !Number.isSafeInteger(record.size) || (record.size as number) < 0 || typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt)) throw new Error('图片备份标识或元数据无效');
    keys.add(record.key);
    let blob: Blob;
    if (record.blob instanceof Blob && record.base64 === undefined) blob = record.blob;
    else if (typeof record.base64 === 'string' && record.blob === undefined && record.base64.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(record.base64)) {
      const binary = atob(record.base64); blob = new Blob([Uint8Array.from(binary, character => character.charCodeAt(0))], { type: record.mimeType });
    } else throw new Error(`图片 ${record.key} 内容缺失或无法解码`);
    if (blob.size !== record.size || (blob.type && blob.type !== record.mimeType)) throw new Error(`图片 ${record.key} 内容与清单不一致`);
    if (record.npcName !== undefined && typeof record.npcName !== 'string') throw new Error('图片人物名称格式无效');
    if (record.generation !== undefined) {
      const generation = record.generation as AssetGenerationMetadata;
      if (!generation || typeof generation !== 'object' || typeof generation.id !== 'string' || typeof generation.prompt !== 'string' || typeof generation.negativePrompt !== 'string'
        || !['story', 'character', 'player'].includes(generation.category) || typeof generation.characterName !== 'string' || !generation.params || typeof generation.params !== 'object' || Array.isArray(generation.params)
        || !Number.isFinite(generation.createdAt)) throw new Error('图片生成来源元数据无效');
      for (const field of ['sessionId', 'worldId', 'messageId', 'npcId', 'deliveryKey', 'sourcePrompt'] as const) if (generation[field] !== undefined && typeof generation[field] !== 'string') throw new Error('图片生成来源范围无效');
    }
    return { key: record.key, blob, mimeType: record.mimeType, size: record.size as number, createdAt: record.createdAt,
      ...(record.npcName === undefined ? {} : { npcName: record.npcName as string }), ...(record.generation === undefined ? {} : { generation: record.generation as AssetGenerationMetadata }) };
  });
}
