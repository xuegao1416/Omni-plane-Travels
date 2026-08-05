// ============================================================
//  卡片工作流世界绑定 — 将卡片工作流与世界关联
//  世界加载时自动注册卡片工作流进 IndexedDB
// ============================================================
import type { CardWorkflowDefinition, EventIndexEntry, Manifest } from './schema';
import type { WorldDef } from '../data/worlds-schema';
import { getWebEvent, putWebEvent, type WebEventRecord } from './eventDb';
import { buildCanonicalCardPackFiles } from './webEventStore';

/**
 * 为世界安装卡片工作流
 * 世界定义中的 cardWorkflows 字段包含要安装的工作流列表
 */
export async function installWorldCardWorkflows(worldDef: WorldDef): Promise<void> {
  const workflows = (worldDef as unknown as Record<string, unknown>).cardWorkflows as
    Array<{ id: string; name: string; workflow: CardWorkflowDefinition }> | undefined;

  if (!workflows || workflows.length === 0) return;

  for (const entry of workflows) {
    const packId = `world-card-${worldDef.id}-${entry.id}`;

    // 幂等检查：已安装则跳过
    const existing = await getWebEvent(packId).catch(() => undefined);
    if (existing) continue;

    const manifest: Manifest = {
      id: packId,
      name: `${worldDef.name} - ${entry.name}`,
      description: `世界 ${worldDef.name} 的卡片工作流`,
      author: 'system',
      engine: 'opt-event',
      schemaVersion: 1,
      minAppVersion: '2.7.0',
      type: 'card',
      coverColor: '#3b82f6',
      icon: 'FileText',
      worldId: worldDef.id,
      version: '1.0.0',
    };
    const event: EventIndexEntry = { id: entry.id, name: entry.name };
    const files = {
      'manifest.json': JSON.stringify(manifest, null, 2),
      ...buildCanonicalCardPackFiles(manifest.name, [{
        entry: event,
        workflow: { ...entry.workflow, id: event.id, name: event.name },
      }]),
    };

    const rec: WebEventRecord = {
      id: packId,
      manifest,
      enabled: true,
      status: 'installed',
      installedAt: new Date().toISOString(),
      builtin: true,
      worldId: worldDef.id,
      files,
    };

    await putWebEvent(rec);
  }
}

/**
 * 检查世界是否已安装卡片工作流
 */
export async function hasWorldCardWorkflows(worldId: string): Promise<boolean> {
  const { allWebEvents } = await import('./eventDb');
  const all = await allWebEvents();
  return all.some(rec => rec.manifest?.worldId === worldId && rec.id.startsWith('world-card-'));
}
