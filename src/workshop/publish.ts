/**
 * publish.ts — 把本地资产发布到创意工坊，并记住“本地资产 ↔ 工坊条目”的对应关系
 * （IndexedDB global / workshopPublications.v1）。同一个本地资产再次发布时会作为新版本更新原条目，
 * 不会再生成重复条目；原条目已被删除或不再属于自己时才新建。
 */
import { getGlobal, putGlobal } from '../storage/db';
import type { PublicWorkshopType } from '../workshopCatalog';
import { WorkshopApiError, workshopApi, type WorkshopApi, type WorkshopPublishInput } from './api';
import { normalizeVersion, resolvePublishVersion } from './protocol';

export interface PublicationLink {
  localKey: string;
  itemId: string;
  type: PublicWorkshopType;
  title: string;
  version: string;
  publishedAt: number;
}

const PUBLICATIONS_KEY = 'workshopPublications.v1';

export function localAssetKey(type: PublicWorkshopType, localId: string): string {
  return `${type}:${localId}`;
}

export async function listPublications(): Promise<PublicationLink[]> {
  const value = await getGlobal<PublicationLink[]>(PUBLICATIONS_KEY);
  return Array.isArray(value) ? value : [];
}

export async function getPublication(localKey: string): Promise<PublicationLink | undefined> {
  return (await listPublications()).find(link => link.localKey === localKey);
}

async function savePublication(link: PublicationLink): Promise<void> {
  const links = (await listPublications()).filter(entry => entry.localKey !== link.localKey);
  await putGlobal(PUBLICATIONS_KEY, [...links, link]);
}

/** 在“我的发布”里用某个本地资产发布了新版本后，记住对应关系，下次从本地资产页发布会更新同一个作品。 */
export async function rememberPublication(localKey: string, item: { id: string; type: PublicWorkshopType; title: string }, version: string): Promise<void> {
  await savePublication({ localKey, itemId: item.id, type: item.type, title: item.title, version, publishedAt: Date.now() });
}

export interface PublishOutcome {
  itemId: string;
  version: string;
  created: boolean;
}

/**
 * 发布或更新。已有对应条目时用 resolvePublishVersion 选一个比线上更高的版本号；
 * 线上版本比本地记录更新（在别的设备上发布过）时按服务端建议的版本重试一次。
 */
export async function publishLocalAsset(localKey: string, input: WorkshopPublishInput, api: WorkshopApi = workshopApi): Promise<PublishOutcome> {
  const link = await getPublication(localKey);
  if (link) {
    const { type: _type, status: _status, ...rest } = input;
    const attempt = (version: string) => api.update(link.itemId, { ...rest, version });
    try {
      let result;
      try {
        result = await attempt(resolvePublishVersion(input.version, link.version));
      } catch (error) {
        const current = error instanceof WorkshopApiError && error.code === 'VERSION_NOT_INCREASED' ? error.details.currentVersion : undefined;
        if (typeof current !== 'string') throw error;
        result = await attempt(resolvePublishVersion(input.version, current));
      }
      await savePublication({ ...link, title: input.title, version: result.version, publishedAt: Date.now() });
      return { itemId: link.itemId, version: result.version, created: false };
    } catch (error) {
      // 原条目被删了或不属于当前账号：改为新建。
      if (!(error instanceof WorkshopApiError) || (error.status !== 404 && error.status !== 403)) throw error;
    }
  }
  const created = await api.create({ ...input, version: normalizeVersion(input.version) });
  await savePublication({ localKey, itemId: created.id, type: input.type, title: input.title, version: created.version, publishedAt: Date.now() });
  return { itemId: created.id, version: created.version, created: true };
}
