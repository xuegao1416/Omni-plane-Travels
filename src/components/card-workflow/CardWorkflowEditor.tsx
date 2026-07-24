// ============================================================
//  卡片工作流编辑器 — @xyflow/react 节点画布
//  受控组件：workflow.id 变化 → 重置画布；用户编辑 → onChange 回调
//  用 isUserEditRef 标记区分「用户编辑」和「外部重置」，避免无限循环
// ============================================================
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, ReactFlowProvider,
  useNodesState, useEdgesState, addEdge,
  type Node, type Edge, type Connection, type NodeTypes,
  type OnNodesChange, type OnEdgesChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type {
  CardWorkflowDefinition, CardNodeInstance, CardWorkflowConnection,
} from '../../modules/schema';
import { getCardNodeDefinition, validateCardConnection } from '../../modules/cardNodeRegistry';
import { computeAutoLayout } from '../../modules/autoLayout';
import CardNodeComponent from './CardNodeComponent';

type CardFlowNode = Node<Record<string, unknown>>;
type CardFlowEdge = Edge;

function workflowToReactFlow(wf: CardWorkflowDefinition): { nodes: CardFlowNode[]; edges: CardFlowEdge[] } {
  const nodes: CardFlowNode[] = wf.nodes.map((n) => ({
    id: n.id, type: 'cardNode', position: n.position, data: { ...n },
  }));
  const edges: CardFlowEdge[] = wf.connections.map((c) => ({
    id: c.id,
    source: c.sourceNodeId, sourceHandle: c.sourceSocketKey,
    target: c.targetNodeId, targetHandle: c.targetSocketKey,
    type: 'default',
    style: { stroke: getEdgeColor(c.sourceSocketKey, wf), strokeWidth: 2 },
    animated: true,
  }));
  return { nodes, edges };
}

function getEdgeColor(socketKey: string, wf: CardWorkflowDefinition): string {
  for (const node of wf.nodes) {
    const def = getCardNodeDefinition(node.typeId);
    if (!def) continue;
    const socket = def.outputs.find((s) => s.key === socketKey);
    if (socket) {
      const colors: Record<string, string> = {
        flow: '#a78bfa', number: '#60a5fa', string: '#34d399', boolean: '#fbbf24',
        stat: '#38bdf8', resource: '#fb923c', flag: '#e879f9', any: '#94a3b8',
      };
      return colors[socket.type] ?? '#94a3b8';
    }
  }
  return '#94a3b8';
}

function reactFlowToWorkflow(nodes: CardFlowNode[], edges: CardFlowEdge[], existing: CardWorkflowDefinition): CardWorkflowDefinition {
  const wfNodes: CardNodeInstance[] = nodes.map((n) => {
    const d = n.data as unknown as CardNodeInstance;
    return { id: n.id, typeId: d.typeId, label: d.label, position: n.position, widgetValues: d.widgetValues ?? {} };
  });
  const connections: CardWorkflowConnection[] = edges.map((e) => ({
    id: e.id,
    sourceNodeId: e.source, sourceSocketKey: e.sourceHandle ?? 'flow_out',
    targetNodeId: e.target, targetSocketKey: e.targetHandle ?? 'flow_in',
  }));
  return { ...existing, nodes: wfNodes, connections };
}

const nodeTypes: NodeTypes = { cardNode: CardNodeComponent };

// ─── 内部组件 ───

interface InnerProps {
  workflow: CardWorkflowDefinition;
  onChange: (workflow: CardWorkflowDefinition) => void;
  gameState?: Record<string, unknown>;
}

function CardWorkflowEditorInner({ workflow, onChange }: InnerProps) {
  const init = useMemo(() => workflowToReactFlow(workflow), []);
  const [nodes, setNodes, onNodesChange] = useNodesState(init.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(init.edges);

  // 标记：用户编辑 vs 外部重置
  const isUserEditRef = useRef(false);
  // 追踪当前 workflow.id
  const workflowIdRef = useRef(workflow.id);

  // workflow.id 变化时（切换事件），重置内部状态 + 自动布局
  useEffect(() => {
    if (workflow.id !== workflowIdRef.current) {
      workflowIdRef.current = workflow.id;
      isUserEditRef.current = false; // 重置标记，防止触发 onChange
      const { nodes: n, edges: e } = workflowToReactFlow(workflow);
      // 自动布局
      if (workflow.nodes.length > 0) {
        const { positions } = computeAutoLayout(
          workflow.nodes.map((nd) => ({ id: nd.id, typeId: nd.typeId })),
          workflow.connections.map((c) => ({ source: c.sourceNodeId, target: c.targetNodeId })),
          (id) => workflow.nodes.find((nd) => nd.id === id)?.typeId ?? '',
        );
        const laidOut = n.map((node) => {
          const pos = positions.get(node.id);
          return pos ? { ...node, position: pos } : node;
        });
        setNodes(laidOut);
      } else {
        setNodes(n);
      }
      setEdges(e);
    }
  }, [workflow.id]);

  // 用户编辑后通知父组件
  useEffect(() => {
    if (isUserEditRef.current) {
      isUserEditRef.current = false;
      const wf = reactFlowToWorkflow(nodes as unknown as CardFlowNode[], edges as unknown as CardFlowEdge[], workflow);
      onChange(wf);
    }
  }, [nodes, edges]);

  // 包装 onNodesChange：标记为用户编辑
  const handleNodesChange: OnNodesChange = useCallback((changes) => {
    isUserEditRef.current = true;
    onNodesChange(changes);
  }, [onNodesChange]);

  // 包装 onEdgesChange：标记为用户编辑
  const handleEdgesChange: OnEdgesChange = useCallback((changes) => {
    isUserEditRef.current = true;
    onEdgesChange(changes);
  }, [onEdgesChange]);

  // 连接
  const onConnect = useCallback((params: Connection) => {
    if (!params.source || !params.target || !params.sourceHandle || !params.targetHandle) return;
    const sourceNode = nodes.find((n) => n.id === params.source);
    const targetNode = nodes.find((n) => n.id === params.target);
    if (!sourceNode || !targetNode) return;
    const sourceDef = getCardNodeDefinition((sourceNode.data as unknown as CardNodeInstance).typeId);
    const targetDef = getCardNodeDefinition((targetNode.data as unknown as CardNodeInstance).typeId);
    if (!sourceDef || !targetDef) return;
    const existingConns = edges.map((e) => ({ targetNodeId: e.target, targetSocketKey: e.targetHandle ?? '' }));
    const error = validateCardConnection(sourceDef, params.sourceHandle, targetDef, params.targetHandle, existingConns, params.target);
    if (error) return;
    isUserEditRef.current = true;
    setEdges((eds) => addEdge({
      ...params, type: 'default',
      style: { stroke: getEdgeColor(params.sourceHandle ?? 'flow_out', workflow), strokeWidth: 2 },
      animated: true,
    }, eds));
  }, [nodes, edges, workflow, setEdges]);

  // 添加节点
  const addNode = useCallback((typeId: string) => {
    const def = getCardNodeDefinition(typeId as CardNodeInstance['typeId']);
    if (!def) return;
    const newId = `node-${Date.now().toString(36)}`;
    isUserEditRef.current = true;
    setNodes((nds) => [...nds, {
      id: newId, type: 'cardNode', position: { x: 250, y: 150 },
      data: { id: newId, typeId, position: { x: 250, y: 150 }, widgetValues: {} },
    }]);
  }, [setNodes]);

  // 拖拽
  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const typeId = event.dataTransfer.getData('application/cardNodeType');
    if (typeId) addNode(typeId);
  }, [addNode]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  // Widget 更新
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.nodeId) return;
      isUserEditRef.current = true;
      setNodes((nds) => nds.map((n) => {
        if (n.id !== detail.nodeId) return n;
        const d = n.data as unknown as CardNodeInstance;
        return { ...n, data: { ...d, widgetValues: { ...d.widgetValues, [detail.socketKey]: detail.value } } };
      }));
    };
    document.addEventListener('cardNodeWidgetChange', handler);
    return () => document.removeEventListener('cardNodeWidgetChange', handler);
  }, [setNodes]);

  // 删除选中
  const deleteSelected = useCallback(() => {
    isUserEditRef.current = true;
    setNodes((nds) => nds.filter((n) => !n.selected));
    setEdges((eds) => eds.filter((e) => !e.selected));
  }, [setNodes, setEdges]);

  // 自动布局
  const handleAutoLayout = useCallback(() => {
    isUserEditRef.current = true;
    const wf = reactFlowToWorkflow(nodes as unknown as CardFlowNode[], edges as unknown as CardFlowEdge[], workflow);
    const graphNodes = wf.nodes.map((n) => ({ id: n.id, typeId: n.typeId }));
    const graphEdges = wf.connections.map((c) => ({
      source: c.sourceNodeId, target: c.targetNodeId,
    }));
    const { positions } = computeAutoLayout(graphNodes, graphEdges, (id) => {
      const node = wf.nodes.find((n) => n.id === id);
      return node?.typeId ?? '';
    });
    setNodes((nds) => nds.map((n) => {
      const pos = positions.get(n.id);
      return pos ? { ...n, position: pos } : n;
    }));
  }, [workflow, setNodes, nodes, edges]);

  // 暴露给父组件
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__cardWorkflowEditor = { addNode, deleteSelected, handleAutoLayout };
    return () => { delete (window as unknown as Record<string, unknown>).__cardWorkflowEditor; };
  }, [addNode, deleteSelected, handleAutoLayout]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={handleNodesChange}
      onEdgesChange={handleEdgesChange}
      onConnect={onConnect}
      onDrop={onDrop}
      onDragOver={onDragOver}
      nodeTypes={nodeTypes}
      fitView
      snapToGrid
      snapGrid={[16, 16]}
      style={{ background: 'var(--bg-primary)' }}
    >
      <Background gap={16} size={1} color="var(--border)" />
      <Controls />
      <MiniMap
        nodeColor={(n) => {
          const def = getCardNodeDefinition((n.data as unknown as CardNodeInstance).typeId);
          return def?.color ?? '#94a3b8';
        }}
        style={{ background: 'var(--bg-secondary)' }}
      />
    </ReactFlow>
  );
}

// ─── 导出 ───

export interface CardWorkflowEditorProps {
  workflow: CardWorkflowDefinition;
  onChange: (workflow: CardWorkflowDefinition) => void;
  gameState?: Record<string, unknown>;
}

export default function CardWorkflowEditor(props: CardWorkflowEditorProps) {
  return (
    <ReactFlowProvider>
      <CardWorkflowEditorInner {...props} />
    </ReactFlowProvider>
  );
}
