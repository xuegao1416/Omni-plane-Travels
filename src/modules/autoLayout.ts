// ============================================================
//  自动布局（dagre）
//  使用 dagre 的通用图模式，从左到右排列节点图。
//  每个节点按实际 widget 数量估算高度，间距动态计算。
// ============================================================
import dagre from 'dagre';

/**
 * 节点实际渲染高度估算（像素）。
 * 每个 widget 包含：标签 14px + 输入框 22px + 间距 4px = 40px。
 * textarea 类型（如描述）额外 +40px。
 * 端口行：标签 12px + 间距 4px = 16px。
 * 头部：28px。padding：8px。
 */
const NODE_HEIGHTS: Record<string, number> = {
  'triggers.world_event':    130,
  'triggers.periodic':       170,
  'triggers.manual':         30,
  'triggers.choice_made':    40,
  'conditions.compare':      50,
  'conditions.check_resource': 90,
  'conditions.check_stat':   90,
  'conditions.check_flag':   60,
  'conditions.check_inventory': 90,
  'conditions.check_npc':    130,
  'conditions.event_match':  50,
  'conditions.and':          40,
  'conditions.or':           40,
  'conditions.not':          30,
  'actions.set_value':       60,
  'actions.modify_resource': 110,
  'actions.modify_stat':     80,
  'actions.modify_currency': 60,
  'actions.modify_inventory': 80,
  'actions.modify_npc':      80,
  'actions.add_event':       60,
  'actions.schedule_tick':   80,
  'actions.add_notebook':    110,
  'data.get_value':          40,
  'data.get_resource':       40,
  'data.get_stat':           40,
  'data.constant':           60,
  'data.math':               50,
  'data.get_random':         60,
  'flow.branch':             50,
  'flow.gate':               40,
  'flow.reroute':            30,
  'output.show_card':        40,
  'output.narrate_hint':     60,
  'output.end_workflow':     30,
  'trigger':   80,
  'condition': 60,
  'effect':    80,
  'event':     40,
  'worldState':40,
  'guardrail': 40,
  'periodic':  170,
};

const NODE_WIDTHS: Record<string, number> = {
  'triggers.world_event': 150, 'triggers.periodic': 150, 'triggers.manual': 135, 'triggers.choice_made': 150,
  'conditions.compare': 135, 'conditions.check_resource': 150, 'conditions.check_stat': 150,
  'conditions.check_flag': 150, 'conditions.check_inventory': 150, 'conditions.check_npc': 150,
  'conditions.event_match': 150, 'conditions.and': 120, 'conditions.or': 120, 'conditions.not': 120,
  'actions.set_value': 150, 'actions.modify_resource': 150, 'actions.modify_stat': 150,
  'actions.modify_currency': 150, 'actions.modify_inventory': 150, 'actions.modify_npc': 150,
  'actions.add_event': 150, 'actions.schedule_tick': 150, 'actions.add_notebook': 150,
  'data.get_value': 150, 'data.get_resource': 150, 'data.get_stat': 150,
  'data.constant': 135, 'data.math': 135, 'data.get_random': 135,
  'flow.branch': 135, 'flow.gate': 135, 'flow.reroute': 120,
  'output.show_card': 150, 'output.narrate_hint': 150, 'output.end_workflow': 120,
  'trigger': 150, 'condition': 135, 'effect': 150, 'event': 135, 'worldState': 135, 'guardrail': 135, 'periodic': 150,
};

function getNodeHeight(typeId: string): number { return NODE_HEIGHTS[typeId] ?? 120; }
function getNodeWidth(typeId: string): number { return NODE_WIDTHS[typeId] ?? 140; }

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
}

/**
 * 使用 dagre 计算自动布局。
 * 每个节点按实际高度动态计算同层间距。
 */
export function computeAutoLayout(
  nodes: Array<{ id: string; [key: string]: unknown }>,
  edges: Array<{ source: string; target: string }>,
  getTypeId?: (id: string) => string,
): LayoutResult {
  const typeIdMap = new Map<string, string>();
  for (const node of nodes) {
    const typeId = getTypeId ? getTypeId(node.id) : ((node as Record<string, unknown>).typeId as string ?? '');
    typeIdMap.set(node.id, typeId);
  }

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  // 计算实际最大节点高度，用于确定同层间距
  let maxNodeHeight = 50;
  for (const node of nodes) {
    const typeId = typeIdMap.get(node.id) ?? '';
    maxNodeHeight = Math.max(maxNodeHeight, getNodeHeight(typeId));
  }

  g.setGraph({
    rankdir: 'LR',
    ranksep: 300,                          // 层间距（水平方向）
    nodesep: maxNodeHeight * 0.5 + 50,     // 同层间距 = 最大节点高度的一半 + 余量
    marginx: 80,
    marginy: 80,
  });

  for (const node of nodes) {
    const typeId = typeIdMap.get(node.id) ?? '';
    const width = getNodeWidth(typeId);
    const height = getNodeHeight(typeId);
    g.setNode(node.id, { width, height });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const dagreNode = g.node(node.id);
    if (dagreNode) {
      const typeId = typeIdMap.get(node.id) ?? '';
      const width = getNodeWidth(typeId);
      const height = getNodeHeight(typeId);
      positions.set(node.id, {
        x: dagreNode.x - width / 2,
        y: dagreNode.y - height / 2,
      });
    }
  }

  return { positions };
}
