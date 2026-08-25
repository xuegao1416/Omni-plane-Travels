import { memo, useMemo } from 'react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ProfessionAbilityDef, ProfessionDef } from '../../modules/schema';
import '../../styles/profession-library.css';

type AbilityState = 'locked' | 'available' | 'owned';
type AbilityNodeData = Record<string, unknown> & {
  ability: ProfessionAbilityDef;
  state: AbilityState;
  variant: 'editor' | 'game';
};
type AbilityNode = Node<AbilityNodeData, 'professionAbility'>;

const TYPE_LABEL: Record<ProfessionAbilityDef['type'], string> = {
  active: '主动',
  passive: '被动',
  specialization: '专精',
  ultimate: '终极',
};

const AbilityNodeView = memo(function AbilityNodeView({ data, selected }: NodeProps<AbilityNode>) {
  const ability = data.ability;
  return (
    <article className={`profession-tree-node is-${data.variant} is-${ability.type} is-${data.state}${selected ? ' is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} isConnectable />
      <div className="profession-tree-node__meta">
        <span>第 {ability.tier ?? 1} 阶</span>
        <span>{TYPE_LABEL[ability.type]}</span>
      </div>
      <strong>{ability.name}</strong>
      <p>{ability.description || '尚未填写能力描述'}</p>
      <small>{data.state === 'owned' ? '已掌握' : data.state === 'available' ? `可解锁 · ${ability.pointCost ?? 1} 点` : `需要职业 Lv.${ability.requiredProfessionLevel ?? ability.tier ?? 1}`}</small>
      <Handle type="source" position={Position.Right} isConnectable />
    </article>
  );
});

const nodeTypes = { professionAbility: AbilityNodeView };

function buildGraph(
  profession: ProfessionDef,
  stateFor: (ability: ProfessionAbilityDef) => AbilityState,
  variant: 'editor' | 'game',
): { nodes: AbilityNode[]; edges: Edge[] } {
  const tiers = new Map<number, ProfessionAbilityDef[]>();
  for (const ability of profession.abilities) {
    const tier = Math.max(1, ability.tier ?? ability.requiredProfessionLevel ?? 1);
    tiers.set(tier, [...(tiers.get(tier) ?? []), ability]);
  }
  const maxRows = Math.max(1, ...[...tiers.values()].map(items => items.length));
  const nodes: AbilityNode[] = [];
  for (const [tier, abilities] of [...tiers.entries()].sort(([left], [right]) => left - right)) {
    const columnHeight = abilities.length * 150;
    const offset = Math.max(0, (maxRows * 150 - columnHeight) / 2);
    abilities.forEach((ability, index) => nodes.push({
      id: ability.id,
      type: 'professionAbility',
      position: { x: (tier - 1) * 260 + 24, y: offset + index * 150 + 24 },
      data: { ability, state: stateFor(ability), variant },
    }));
  }
  const ids = new Set(nodes.map(node => node.id));
  const edges: Edge[] = profession.abilities.flatMap(ability => (ability.prerequisites ?? []).flatMap(parentId => (
    ids.has(parentId) && ids.has(ability.id)
      ? [{
        id: `${parentId}->${ability.id}`,
        source: parentId,
        target: ability.id,
        type: 'smoothstep',
        // 可解锁状态曾使用 React Flow 的 animated edge，渲染为断续虚线，
        // 看起来像职业树断线。状态用颜色表达，连线始终保持稳定实线。
        animated: false,
        className: `profession-tree-edge profession-tree-edge--${stateFor(ability)}`,
      }]
      : []
  )));
  return { nodes, edges };
}

export default function ProfessionTreeCanvas({
  profession,
  selectedAbilityId,
  onSelectAbility,
  onConnect,
  stateFor = () => 'locked',
  editable = false,
  variant = 'editor',
  className = '',
}: {
  profession: ProfessionDef;
  selectedAbilityId?: string;
  onSelectAbility?: (abilityId: string) => void;
  onConnect?: (sourceId: string, targetId: string) => void;
  stateFor?: (ability: ProfessionAbilityDef) => AbilityState;
  editable?: boolean;
  variant?: 'editor' | 'game';
  className?: string;
}) {
  const graph = useMemo(() => buildGraph(profession, stateFor, variant), [profession, stateFor, variant]);
  const nodes = useMemo(() => graph.nodes.map(node => ({ ...node, selected: node.id === selectedAbilityId })), [graph.nodes, selectedAbilityId]);
  const handleConnect = (connection: Connection) => {
    if (!editable || !connection.source || !connection.target || connection.source === connection.target) return;
    onConnect?.(connection.source, connection.target);
  };
  return (
    <div className={`profession-tree-canvas profession-tree-canvas--${variant} ${className}`} aria-label={`${profession.name}职业树`}>
      {profession.abilities.length === 0 ? (
        <div className="profession-tree-canvas__empty">这棵职业树还没有能力节点。可在右侧检查器中新建第一阶能力。</div>
      ) : (
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={graph.edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.16, minZoom: 0.45, maxZoom: 1.15 }}
            minZoom={0.25}
            maxZoom={1.6}
            nodesDraggable={false}
            nodesConnectable={editable}
            elementsSelectable
            onNodeClick={(_, node) => onSelectAbility?.(node.id)}
            onConnect={handleConnect}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={variant === 'game' ? 32 : 24} size={1} color="color-mix(in srgb, var(--accent) 22%, transparent)" />
            {variant === 'editor' && <Controls showInteractive={false} />}
            {variant === 'editor' && <MiniMap pannable zoomable nodeStrokeWidth={2} />}
          </ReactFlow>
        </ReactFlowProvider>
      )}
    </div>
  );
}
