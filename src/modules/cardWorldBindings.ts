// ============================================================
//  卡片工作流世界绑定 — 将卡片工作流与世界关联
//  世界加载时自动注册卡片工作流进 IndexedDB
// ============================================================
import type { CardWorkflowDefinition } from './schema';
import type { WorldDef } from '../data/worlds-schema';
import { getWebEvent, putWebEvent } from './eventDb';
import { installWorldEventPacks } from './webEventStore';

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

    // 创建事件包记录
    const rec = {
      id: packId,
      manifest: {
        id: packId,
        name: `${worldDef.name} - ${entry.name}`,
        description: `世界 ${worldDef.name} 的卡片工作流`,
        author: 'system',
        engine: 'opt-event' as const,
        schemaVersion: 1,
        minAppVersion: '2.7.0',
        type: 'card' as const,
        coverColor: '#3b82f6',
        icon: 'FileText',
        worldId: worldDef.id,
        builtin: true,
        version: '1.0.0',
      },
      enabled: true,
      status: 'installed' as const,
      installedAt: Date.now(),
      files: {
        'schema/events.json': JSON.stringify({
          version: 1,
          name: entry.name,
          events: [{ id: entry.id, name: entry.name, cards: [] }],
        }, null, 2),
        [`schema/event-${entry.id}.json`]: JSON.stringify(entry.workflow, null, 2),
      },
    };

    await putWebEvent(rec as unknown as import('./eventDb').WebEventRecord);
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
