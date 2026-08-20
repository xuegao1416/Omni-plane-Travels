import type { CardWorkflowDefinition } from './schema';
import type { NodeInstance, WorkflowConnection, WorkflowDefinition } from './workflowSchema';

export interface WorldWorkflowEvent { id: string; name: string }
export type WorldWorkflowFactory = (
  cardPackId: string,
  events: WorldWorkflowEvent[],
) => WorkflowDefinition;

const WORLD_NAMES: Record<string, string> = {
  japanese_school: '烟雨杀局',
  desire_metropolis: '烟火人间',
  wuxia_world: '武林风云',
  wasteland_apocalypse: '余烬废土',
  stranded_island: '孤岛求生',
  border_trade: '绥芬边贸',
};

/** Stable round-robin scheduling prevents event floods and keeps saves reproducible. */
function createWorldWorkflow(worldId: string): WorldWorkflowFactory {
  return (cardPackId, events) => {
    const nodes: NodeInstance[] = [];
    const connections: WorkflowConnection[] = [];
    const interval = Math.max(8, events.length * 8);

    events.forEach((event, index) => {
      const triggerId = `trigger-${event.id}`;
      const actionId = `event-${event.id}`;
      nodes.push({
        id: triggerId,
        typeId: 'triggers.periodic',
        label: `${event.name} · 周期触发`,
        position: { x: 40, y: index * 110 },
        widgetValues: { interval, offset: 4 + index * 8 },
      }, {
        id: actionId,
        typeId: 'actions.add_event',
        label: event.name,
        position: { x: 360, y: index * 110 },
        widgetValues: { event_id: event.id, event_pack_id: cardPackId },
      });
      connections.push({
        id: `flow-${event.id}`,
        sourceNodeId: triggerId,
        sourceSocketKey: 'flow_out',
        targetNodeId: actionId,
        targetSocketKey: 'flow_in',
      });
    });

    return {
      version: 1,
      id: `wf-${worldId}`,
      name: `${WORLD_NAMES[worldId] ?? worldId} · 事件触发`,
      description: '按世界时间稳定触发内置事件卡，并把玩家选择承接到后续叙事。',
      nodes,
      connections,
      metadata: { author: '内置', tags: ['内置世界', '事件触发'] },
    };
  };
}

const STAT_ALIASES: Record<string, string> = {
  '生命': 'attrA', '生命值': 'attrA', '血量': 'attrA',
  '能量': 'attrB', '体力': 'attrB', '体力值': 'attrB',
};

function repairChoiceOptions(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    JSON.parse(value);
    return value;
  } catch {
    let repaired = value.replace(/([{,]\s*)(label|aiNote|effect)\s*:/g, '$1"$2":');
    // A legacy generator also omitted the final option object's closing brace.
    if (/"\]$/.test(repaired)) repaired = repaired.replace(/"\]$/, '"}]');
    try { return JSON.stringify(JSON.parse(repaired)); } catch { return value; }
  }
}

/** Repairs legacy built-in card data at installation without touching user packs. */
export function normalizeBuiltinCardWorkflow(workflow: CardWorkflowDefinition): CardWorkflowDefinition {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => {
      const widgetValues = { ...(node.widgetValues ?? {}) };
      if (node.typeId === 'choice.static') widgetValues.options = repairChoiceOptions(widgetValues.options);
      if (node.typeId === 'effect.stat') {
        const key = String(widgetValues.statKey ?? '');
        if (STAT_ALIASES[key]) widgetValues.statKey = STAT_ALIASES[key];
      }
      return { ...node, widgetValues };
    }),
    connections: workflow.connections.map((connection) => ({ ...connection })),
  };
}

export const WORLD_WORKFLOWS: Record<string, WorldWorkflowFactory> = Object.fromEntries(
  Object.keys(WORLD_NAMES).map((worldId) => [worldId, createWorldWorkflow(worldId)]),
);
