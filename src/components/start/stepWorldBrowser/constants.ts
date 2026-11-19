import type { WorldDef,WorldBookEntryDef } from '../../../data/worlds-schema';
import { parseWorldBookImport } from '../../../utils/worldBookImport';

/** 将外部格式 JSON 转为 WorldDef（兼容 worldBookEntries / entries 任意大小写、数组或对象、角色卡内嵌） */
export function normalizeExternal(data: any, fileName: string): WorldDef {
  const parsed = parseWorldBookImport(data);
  const baseUid = Date.now();
  // 新建世界：统一重新分配 uid，保证唯一
  const entries: WorldBookEntryDef[] = parsed.entries.map((entry, i) => ({ ...entry, uid: baseUid + i }));

  const baseName = fileName.replace(/\.json$/i, '');
  return {
    id: `external_${baseUid}`, name: data.name || baseName,
    description: data.description || `从 ${fileName} 导入（${entries.length} 条条目）`,
    worldBookEntries: entries, source: 'external',
  };
}
