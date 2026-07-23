// ============================================================
//  工作流编辑器 — 类型化节点画布
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState, useReducer } from 'react';
import { useIsPhone } from '../../hooks/useIsMobile';
import {
  ReactFlow, Background, Controls, MiniMap, ReactFlowProvider,
  useNodesState, useEdgesState, addEdge,
  type Node, type Edge, type Connection, type NodeTypes, type EdgeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowLeft, Save, Undo2, Redo2, Play, ShieldCheck, Braces,
  X, AlertTriangle, Check, LayoutDashboard, Plus, BookOpen, Lock,
  PanelLeft, SlidersHorizontal,
} from 'lucide-react';
import { getWebEvent, putWebEvent } from '../../modules/eventDb';
import { findWorldDef, getAllWorlds } from '../../data/worldLoader';
import { installWorldEventPacks } from '../../modules/webEventStore';
import type { WorkflowDefinition, NodeInstance, WorkflowConnection, WorkflowExecutionContext } from '../../modules/workflowSchema';
import { SOCKET_COLORS } from '../../modules/workflowSchema';
import { getNodeDefinition, getAllNodeDefinitions, validateConnection } from '../../modules/nodeRegistry';
import { executeWorkflow } from '../../modules/workflowEngine';
import { workflowToRuleFile } from '../../modules/workflowConverters';
import { computeAutoLayout } from '../../modules/autoLayout';
import { saveWorkflowToPack, loadWorkflowFromPack } from '../../modules/webEventStore';
import TypedNodeComponent from './TypedNodeComponent';
import NodePalette from './NodePalette';
import { WorkflowProvider } from './WorkflowContext';
import EventIdSelect from '../event/EventIdSelect';
import WhenPathSelect from '../event/WhenPathSelect';
import ResourceKeySelect from '../event/ResourceKeySelect';
import type { GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';

// ─── 类型适配 ───

type WFNode = Node<Record<string, unknown>>;
type WFEdge = Edge;

// ─── 工具函数 ───

function workflowToReactFlow(wf: WorkflowDefinition): { nodes: WFNode[]; edges: WFEdge[] } {
  const nodes: WFNode[] = wf.nodes.map((n) => ({
    id: n.id,
    type: 'workflowNode',
    position: n.position,
    data: { ...n },
  }));

  const edges: WFEdge[] = wf.connections.map((c) => ({
    id: c.id,
    source: c.sourceNodeId,
    sourceHandle: c.sourceSocketKey,
    target: c.targetNodeId,
    targetHandle: c.targetSocketKey,
    type: 'default',
    style: { stroke: getEdgeColor(c.sourceSocketKey, wf), strokeWidth: 2 },
    animated: true,
  }));

  return { nodes, edges };
}

function getEdgeColor(socketKey: string, wf: WorkflowDefinition): string {
  // 尝试从源节点的输出 socket 获取颜色
  for (const node of wf.nodes) {
    const def = getNodeDefinition(node.typeId);
    if (!def) continue;
    const socket = def.outputs.find((s) => s.key === socketKey);
    if (socket) return SOCKET_COLORS[socket.type] ?? '#94a3b8';
  }
  return '#94a3b8';
}

function reactFlowToWorkflow(nodes: WFNode[], edges: WFEdge[], existing: WorkflowDefinition): WorkflowDefinition {
  const wfNodes: NodeInstance[] = nodes.map((n) => {
    const d = n.data as unknown as NodeInstance;
    return {
      id: n.id,
      typeId: d.typeId,
      label: d.label,
      position: n.position,
      widgetValues: d.widgetValues ?? {},
    };
  });

  const connections: WorkflowConnection[] = edges.map((e) => ({
    id: e.id,
    sourceNodeId: e.source,
    sourceSocketKey: e.sourceHandle ?? 'flow_out',
    targetNodeId: e.target,
    targetSocketKey: e.targetHandle ?? 'flow_in',
  }));

  return {
    ...existing,
    nodes: wfNodes,
    connections,
  };
}

// ─── 主组件 ───

export interface WorkflowEditorProps {
  eventPackId: string | null;
  onBack: () => void;
  gameState?: GameState;
  worldDef?: WorldDef;
  onSaved?: () => void;
  initialWorkflow?: WorkflowDefinition | null;
}

export default function WorkflowEditor({
  eventPackId, onBack, gameState, worldDef: worldDefProp, onSaved, initialWorkflow,
}: WorkflowEditorProps) {
  // 初始化
  const defaultWorkflow: WorkflowDefinition = useMemo(() => initialWorkflow ?? {
    version: 1,
    id: `wf-${Date.now().toString(36)}`,
    name: '新工作流',
    nodes: [],
    connections: [],
  }, [initialWorkflow]);

  const [workflow, setWorkflow] = useState<WorkflowDefinition>(defaultWorkflow);

  // ── 世界绑定 ──
  const [localWorldDef, setLocalWorldDef] = useState<WorldDef | undefined>(worldDefProp);
  const [worldBound, setWorldBound] = useState(false);
  const [showWorldPicker, setShowWorldPicker] = useState(false);
  const worldDef = worldDefProp ?? localWorldDef;

  // 初始化：如果事件包已绑定世界，自动加载
  useEffect(() => {
    if (!eventPackId || worldDefProp) return;
    (async () => {
      try {
        const rec = await getWebEvent(eventPackId);
        if (rec?.worldId) {
          const found = findWorldDef(rec.worldId);
          if (found) { setLocalWorldDef(found); setWorldBound(true); }
        }
      } catch { /* ignore */ }
    })();
  }, [eventPackId, worldDefProp]);

  const handleLoadWorld = useCallback(() => {
    if (!eventPackId) return;
    setShowWorldPicker(true);
  }, [eventPackId]);

  const handlePickWorld = useCallback(async (wid: string) => {
    const found = findWorldDef(wid);
    if (found && eventPackId) {
      try {
        // 绑定世界到事件包
        const rec = await getWebEvent(eventPackId);
        if (rec) { rec.worldId = found.id; await putWebEvent(rec); }
        // 安装世界的事件包到 IndexedDB（让 EventIdSelect 能找到事件）
        await installWorldEventPacks(found);
        setLocalWorldDef(found);
        setWorldBound(true);
      } catch { /* ignore */ }
    }
    setShowWorldPicker(false);
  }, [eventPackId]);
  const rfInit = useMemo(() => workflowToReactFlow(workflow), []); // 只初始化一次

  const [nodes, setNodes, onNodesChange] = useNodesState<WFNode>(rfInit.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<WFEdge>(rfInit.edges);

  // ── 初始化：从事件包加载工作流 + 自动布局 ──
  useEffect(() => {
    if (!eventPackId) return;
    let cancelled = false;
    (async () => {
      try {
        const rec = await getWebEvent(eventPackId);
        if (!rec || cancelled) return;
        const wfRaw = rec.files['schema/workflow.json'];
        if (typeof wfRaw === 'string') {
          const wf = JSON.parse(wfRaw) as WorkflowDefinition;
          if (wf.nodes && wf.nodes.length > 0) {
            setWorkflow(wf);
            // 自动布局：按节点类型排列整齐
            const { positions } = computeAutoLayout(
              wf.nodes.map((n) => ({ id: n.id, typeId: n.typeId })),
              wf.connections.map((c) => ({ source: c.sourceNodeId, target: c.targetNodeId })),
              (id) => wf.nodes.find((n) => n.id === id)?.typeId ?? '',
            );
            const { nodes: n, edges: e } = workflowToReactFlow(wf);
            // 应用自动布局位置
            const laidOut = n.map((node) => {
              const pos = positions.get(node.id);
              return pos ? { ...node, position: pos } : node;
            });
            if (!cancelled) {
              setNodes(laidOut);
              setEdges(e);
            }
          }
        }
      } catch { /* 损坏数据不阻塞 */ }
    })();
    return () => { cancelled = true; };
  }, [eventPackId, setNodes, setEdges]);

  // ── 更新节点 widget 值（提前定义，供 useEffect 注入） ──
  const handleWidgetChange = useCallback((nodeId: string, socketKey: string, value: unknown) => {
    setNodes((nds) => nds.map((n) => {
      if (n.id !== nodeId) return n;
      const d = n.data as unknown as NodeInstance;
      return {
        ...n,
        data: {
          ...d,
          widgetValues: { ...(d.widgetValues ?? {}), [socketKey]: value },
        },
      };
    }));
  }, [setNodes]);

  // 稳定的回调引用（避免节点重渲染）
  const handleWidgetChangeRef = useRef(handleWidgetChange);
  handleWidgetChangeRef.current = handleWidgetChange;
  const stableWidgetChange = useCallback((nodeId: string, socketKey: string, value: unknown) => {
    handleWidgetChangeRef.current(nodeId, socketKey, value);
  }, []);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [simResult, setSimResult] = useState<ReturnType<typeof executeWorkflow> | null>(null);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<'visual' | 'json'>('visual');
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  // ── 移动端 ──
  const isPhone = useIsPhone();
  const [mobileNodePanel, setMobileNodePanel] = useState(false);
  const [mobilePropsPanel, setMobilePropsPanel] = useState(false);

  // ── Undo/Redo ──
  const undoStack = useRef<Array<{ nodes: WFNode[]; edges: WFEdge[] }>>([]);
  const redoStack = useRef<Array<{ nodes: WFNode[]; edges: WFEdge[] }>>([]);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const pushHistory = useCallback(() => {
    undoStack.current.push({ nodes: [...nodesRef.current], edges: [...edgesRef.current] });
    redoStack.current = [];
    if (undoStack.current.length > 50) undoStack.current.shift();
    forceUpdate();
  }, []);

  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;

  const undo = useCallback(() => {
    if (!undoStack.current.length) return;
    const snap = undoStack.current.pop()!;
    redoStack.current.push({ nodes: [...nodesRef.current], edges: [...edgesRef.current] });
    setNodes(snap.nodes);
    setEdges(snap.edges);
    forceUpdate();
  }, [setNodes, setEdges]);

  const redo = useCallback(() => {
    if (!redoStack.current.length) return;
    const snap = redoStack.current.pop()!;
    undoStack.current.push({ nodes: [...nodesRef.current], edges: [...edgesRef.current] });
    setNodes(snap.nodes);
    setEdges(snap.edges);
    forceUpdate();
  }, [setNodes, setEdges]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  // ── 添加节点 ──
  const handleAddNode = useCallback((typeId: string) => {
    pushHistory();
    const def = getNodeDefinition(typeId);
    const id = `${typeId.replace(/\./g, '_')}-${Date.now().toString(36)}`;
    const node: WFNode = {
      id,
      type: 'workflowNode',
      position: { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 },
      data: {
        id,
        typeId,
        label: def?.name ?? typeId,
        position: { x: 0, y: 0 },
        widgetValues: {},
      },
    };
    setNodes((nds) => [...nds, node]);
    setSelectedId(id);
  }, [pushHistory, setNodes]);

  // ── 连接验证 ──
  const onConnect = useCallback((c: Connection) => {
    if (c.source === c.target) return;

    const srcNode = nodesRef.current.find((n) => n.id === c.source);
    const tgtNode = nodesRef.current.find((n) => n.id === c.target);
    if (!srcNode || !tgtNode) return;

    const srcDef = getNodeDefinition((srcNode.data as unknown as NodeInstance).typeId);
    const tgtDef = getNodeDefinition((tgtNode.data as unknown as NodeInstance).typeId);
    if (!srcDef || !tgtDef) return;

    const existing = edgesRef.current.map((e) => ({
      targetNodeId: e.target,
      targetSocketKey: e.targetHandle ?? '',
    }));

    const err = validateConnection(
      srcDef, c.sourceHandle ?? 'flow_out',
      tgtDef, c.targetHandle ?? 'flow_in',
      existing, c.target!,
    );
    if (err) return;

    pushHistory();
    const srcSocket = srcDef.outputs.find((s) => s.key === (c.sourceHandle ?? 'flow_out'));
    const color = SOCKET_COLORS[srcSocket?.type ?? 'any'] ?? '#94a3b8';

    setEdges((eds) => addEdge({
      ...c,
      id: `e-${c.source}-${c.target}-${Date.now().toString(36)}`,
      type: 'default',
      style: { stroke: color, strokeWidth: 2 },
      animated: true,
    } as WFEdge, eds));
  }, [pushHistory, setEdges]);

  // ── 更新节点 widget 值 ──
  // ── 删除节点 ──
  const handleDeleteNode = useCallback((id: string) => {
    pushHistory();
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    if (selectedId === id) setSelectedId(null);
  }, [pushHistory, setNodes, setEdges, selectedId]);

  // ── 自动布局 ──
  const handleAutoLayout = useCallback(() => {
    pushHistory();
    const wf = reactFlowToWorkflow(nodesRef.current, edgesRef.current, workflow);
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
  }, [workflow, pushHistory, setNodes]);

  // ── 模拟运行 ──
  const handleSimulate = useCallback(() => {
    const wf = reactFlowToWorkflow(nodesRef.current, edgesRef.current, workflow);
    const ctx: WorkflowExecutionContext = {
      tick: 1,
      events: [{ type: 'dice_roll', result: 5 }],
      permissions: ['read_world_state', 'modify_world_state', 'add_card', 'register_tick'],
      gameState: (gameState as unknown as Record<string, unknown>) ?? {},
    };
    const result = executeWorkflow(wf, ctx);
    setSimResult(result);
  }, [workflow, gameState]);

  // ── 保存 ──
  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!eventPackId) return false;
    // 没有节点时不保存（避免覆盖已有规则）
    if (nodesRef.current.length === 0) return false;
    setSaving(true);
    try {
      const wf = reactFlowToWorkflow(nodesRef.current, edgesRef.current, workflow);
      await saveWorkflowToPack(eventPackId, wf);
      setIssues([]);
      onSaved?.();
      return true;
    } catch (err) {
      setIssues(['保存失败: ' + (err instanceof Error ? err.message : String(err))]);
      return false;
    } finally {
      setSaving(false);
    }
  }, [eventPackId, workflow, onSaved]);

  const handleBack = useCallback(async () => {
    try { await handleSave(); } catch { /* 保存失败不阻塞返回 */ }
    onBack();
  }, [handleSave, onBack]);

  // ── JSON 模式 ──
  const enterJson = () => {
    const wf = reactFlowToWorkflow(nodesRef.current, edgesRef.current, workflow);
    setJsonText(JSON.stringify(wf, null, 2));
    setJsonError(null);
    setMode('json');
  };

  const applyJson = (): boolean => {
    try {
      const parsed = JSON.parse(jsonText) as WorkflowDefinition;
      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.connections)) throw new Error('格式错误');
      const { nodes: n, edges: e } = workflowToReactFlow(parsed);
      setNodes(n);
      setEdges(e);
      setWorkflow(parsed);
      setJsonError(null);
      return true;
    } catch (err) {
      setJsonError('JSON 解析失败: ' + (err instanceof Error ? err.message : String(err)));
      return false;
    }
  };

  // ── NodeTypes ──
  const nodeTypes: NodeTypes = useMemo(() => ({
    workflowNode: TypedNodeComponent,
  }), []);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      {/* 顶栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: isPhone ? 'var(--space-1)' : 'var(--space-3)', padding: isPhone ? '6px 8px' : '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', flexShrink: 0, overflow: 'hidden' }}>
        <button className="btn-ghost btn-sm" onClick={() => void handleBack()} style={{ minHeight: isPhone ? 36 : 'var(--touch-min)', minWidth: isPhone ? 36 : undefined, display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, padding: isPhone ? '4px' : undefined }}><ArrowLeft size={16} />{!isPhone && ' 返回'}</button>
        <h1 style={{ fontSize: isPhone ? 'var(--font-size-sm)' : 'var(--font-size-lg)', fontWeight: 600, fontFamily: 'var(--font-display)', whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1 }}>工作流编辑器</h1>
        <div className="event-toolbar-scroll" style={{ marginLeft: 'auto', display: 'flex', gap: isPhone ? '2px' : 'var(--space-2)', alignItems: 'center', minWidth: 0, flexShrink: 1, overflowX: 'auto', overflowY: 'hidden' }}>
          {/* 撤销/重做 */}
          <button className="btn-ghost btn-sm" onClick={undo} disabled={!canUndo} title="撤销" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: isPhone ? 32 : undefined, minHeight: isPhone ? 32 : undefined, padding: isPhone ? '4px' : '4px 6px', flexShrink: 0, opacity: canUndo ? 1 : 0.35 }}><Undo2 size={isPhone ? 14 : 15} /></button>
          <button className="btn-ghost btn-sm" onClick={redo} disabled={!canRedo} title="重做" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: isPhone ? 32 : undefined, minHeight: isPhone ? 32 : undefined, padding: isPhone ? '4px' : '4px 6px', flexShrink: 0, opacity: canRedo ? 1 : 0.35 }}><Redo2 size={isPhone ? 14 : 15} /></button>
          {/* 保存 */}
          <button className="btn-primary btn-sm" onClick={() => void handleSave()} disabled={saving || !eventPackId} style={{ display: 'inline-flex', alignItems: 'center', gap: isPhone ? 0 : 6, minHeight: isPhone ? 32 : undefined, padding: isPhone ? '4px 6px' : undefined, flexShrink: 0 }}><Save size={14} /> {!isPhone && (saving ? '保存中…' : '保存')}</button>
          {/* 桌面端：整理/模拟/JSON */}
          {!isPhone && <button className="btn-ghost btn-sm" onClick={handleAutoLayout} title="整理布局" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><LayoutDashboard size={15} /> 整理</button>}
          {!isPhone && <button className="btn-secondary btn-sm" onClick={handleSimulate} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Play size={15} /> 模拟</button>}
          <button className={mode === 'json' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => mode === 'json' ? (applyJson() && setMode('visual')) : enterJson()} style={{ display: 'inline-flex', alignItems: 'center', gap: isPhone ? 0 : 6, minHeight: isPhone ? 32 : undefined, padding: isPhone ? '4px 6px' : undefined, flexShrink: 0 }}><Braces size={14} /> {mode === 'json' ? '可视化' : !isPhone && 'JSON'}</button>
          {/* 世界绑定 */}
          {worldBound && worldDef ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: isPhone ? 2 : 4, fontSize: 'var(--font-size-xs)', color: 'var(--success)', padding: isPhone ? '2px 4px' : '4px 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--success)', whiteSpace: 'nowrap', flexShrink: 0 }}>
              <Lock size={12} /> {isPhone ? worldDef.name.slice(0, 3) : worldDef.name}
            </span>
          ) : showWorldPicker ? (
            <select autoFocus value="" onChange={(e) => e.target.value && handlePickWorld(e.target.value)} onBlur={() => setShowWorldPicker(false)} style={{ padding: isPhone ? '2px 4px' : '4px 8px', fontSize: 'var(--font-size-xs)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', flexShrink: 0, width: isPhone ? 70 : 160 }}>
              <option value="" disabled>世界…</option>
              {getAllWorlds().map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          ) : (
            <button className="btn-secondary btn-sm" onClick={handleLoadWorld} disabled={!eventPackId} style={{ display: 'inline-flex', alignItems: 'center', gap: isPhone ? 0 : 6, minHeight: isPhone ? 32 : undefined, padding: isPhone ? '4px 6px' : undefined, flexShrink: 0, whiteSpace: 'nowrap' }}>
              <BookOpen size={14} /> {!isPhone && '读取世界'}
            </button>
          )}
          {/* 手机端：整理/模拟（图标） */}
          {isPhone && (
            <>
              <button className="btn-ghost btn-sm" onClick={handleAutoLayout} title="整理" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 32, minHeight: 32, padding: '4px', flexShrink: 0 }}><LayoutDashboard size={14} /></button>
              <button className="btn-ghost btn-sm" onClick={handleSimulate} title="模拟" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 32, minHeight: 32, padding: '4px', flexShrink: 0 }}><Play size={14} /></button>
            </>
          )}
        </div>
      </div>

      {/* 问题条 */}
      {issues.length > 0 && (
        <div style={{ padding: 'var(--space-2) var(--space-4)', background: 'var(--danger-bg-soft)', borderBottom: '1px solid var(--border)', fontSize: 'var(--font-size-sm)', color: 'var(--danger)', maxHeight: 120, overflow: 'auto' }}>
          {issues.map((i, k) => <div key={k} style={{ display: 'flex', gap: 6 }}><AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{i}</span></div>)}
        </div>
      )}

      {/* 模拟结果 */}
      {simResult && (
        <div style={{ padding: 'var(--space-2) var(--space-4)', background: simResult.aborted ? 'var(--warning-bg-soft)' : 'var(--success-bg-soft)', borderBottom: '1px solid var(--border)', fontSize: 'var(--font-size-sm)', maxHeight: 200, overflow: 'auto' }}>
          <div style={{ fontWeight: 600, color: simResult.aborted ? 'var(--warning)' : 'var(--success)', display: 'flex', alignItems: 'center', gap: 6 }}>
            {simResult.aborted ? <AlertTriangle size={14} /> : <Check size={14} />} 模拟{simResult.aborted ? '中止' : '完成'} — {simResult.totalExecutedNodes} 节点, {simResult.totalWallMs.toFixed(1)}ms
          </div>
          {simResult.pendingActions.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>无动作产出</div>}
          {simResult.pendingActions.map((a, k) => <div key={k} style={{ fontFamily: 'var(--font-body)' }}>· [{a.kind}] {JSON.stringify(a.payload)}</div>)}
          {simResult.warnings.map((w, k) => <div key={'w' + k} style={{ color: 'var(--warning)' }}>⚠ {w}</div>)}
        </div>
      )}

      {mode === 'json' ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 'var(--space-4)', gap: 'var(--space-3)', overflow: 'hidden' }}>
          {jsonError && <div style={{ background: 'var(--danger-bg-soft)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', color: 'var(--danger)', fontSize: 'var(--font-size-sm)', whiteSpace: 'pre-wrap' }}>{jsonError}</div>}
          <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} spellCheck={false} style={{ flex: 1, width: '100%', resize: 'none', fontFamily: 'var(--font-body)', fontSize: 'var(--font-size-sm)', lineHeight: 1.6, color: 'var(--text-primary)', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }} />
          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
            <button className="btn-secondary btn-sm" onClick={() => { const wf = reactFlowToWorkflow(nodesRef.current, edgesRef.current, workflow); setJsonText(JSON.stringify(wf, null, 2)); }}>重置为画布</button>
            <button className="btn-primary btn-sm" onClick={() => { if (applyJson()) setMode('visual'); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Check size={15} /> 应用</button>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: isPhone ? '1fr' : '200px 1fr 220px', overflow: 'hidden', position: 'relative' }}>
          {/* 左侧：节点面板（桌面端内联 / 移动端隐藏） */}
          {!isPhone && (
            <div style={{ borderRight: '1px solid var(--border)', background: 'var(--bg-secondary)', overflow: 'hidden' }}>
              <NodePalette onAddNode={handleAddNode} />
            </div>
          )}

          {/* 中间：画布 */}
          <div style={{ position: 'relative', overflow: 'hidden' }}>
            <WorkflowProvider value={{ worldDef, eventPackId, gameState, onWidgetChange: stableWidgetChange }}>
            <ReactFlowProvider>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={(_, n) => { setSelectedId(n.id); if (isPhone) setMobilePropsPanel(true); }}
                nodeTypes={nodeTypes}
                fitView
                proOptions={{ hideAttribution: true }}
                style={{ background: 'var(--bg-primary)' }}
                defaultEdgeOptions={{ animated: true }}
              >
                <Background color="var(--canvas-grid)" gap={24} />
                <Controls showInteractive={false} />
                <MiniMap pannable zoomable style={{ background: 'var(--bg-secondary)' }} nodeColor={(n) => {
                  const def = getNodeDefinition((n.data as unknown as NodeInstance)?.typeId ?? '');
                  return def?.color ?? 'var(--accent)';
                }} maskColor="rgba(0,0,0,0.3)" />
              </ReactFlow>
            </ReactFlowProvider>
            </WorkflowProvider>

            {/* 移动端浮动操作按钮 */}
            {isPhone && (
              <div style={{ position: 'absolute', bottom: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', zIndex: 10 }}>
                <button
                  onClick={() => setMobileNodePanel(true)}
                  aria-label="节点面板"
                  style={{ width: 48, height: 48, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', cursor: 'pointer' }}
                >
                  <PanelLeft size={20} />
                </button>
                {selectedId && (
                  <button
                    onClick={() => setMobilePropsPanel(true)}
                    aria-label="属性面板"
                    style={{ width: 48, height: 48, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--accent)', color: 'var(--color-on-accent, #fff)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', cursor: 'pointer' }}
                  >
                    <SlidersHorizontal size={20} />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 右侧：属性面板（桌面端内联 / 移动端隐藏） */}
          {!isPhone && (
            <div style={{ borderLeft: '1px solid var(--border)', background: 'var(--bg-secondary)', overflow: 'auto', padding: 'var(--space-3)' }}>
              {selectedId ? (
                <SelectedNodePanel
                  node={nodes.find((n) => n.id === selectedId) as WFNode | undefined}
                  onWidgetChange={(key, val) => handleWidgetChange(selectedId, key, val)}
                  onDelete={() => handleDeleteNode(selectedId)}
                  gameState={gameState}
                  worldDef={worldDef}
                  eventPackId={eventPackId}
                />
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', padding: 'var(--space-6)', textAlign: 'center' }}>
                  选中节点以编辑属性
                </div>
              )}
            </div>
          )}

          {/* 移动端节点面板 — 底部抽屉 */}
          {isPhone && mobileNodePanel && (
            <>
              <div className="event-overlay" onClick={() => setMobileNodePanel(false)} />
              <div className="event-bottom-sheet" style={{ padding: 'var(--space-3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>节点面板</span>
                  <button onClick={() => setMobileNodePanel(false)} aria-label="关闭" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 44 }}><X size={18} /></button>
                </div>
                <NodePalette onAddNode={(typeId) => { handleAddNode(typeId); setMobileNodePanel(false); }} />
              </div>
            </>
          )}

          {/* 移动端属性面板 — 右侧滑出 */}
          {isPhone && mobilePropsPanel && selectedId && (
            <>
              <div className="event-overlay" onClick={() => setMobilePropsPanel(false)} />
              <div className="event-right-sheet" style={{ padding: 'var(--space-3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                  <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>节点属性</span>
                  <button onClick={() => setMobilePropsPanel(false)} aria-label="关闭" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 44 }}><X size={18} /></button>
                </div>
                <SelectedNodePanel
                  node={nodes.find((n) => n.id === selectedId) as WFNode | undefined}
                  onWidgetChange={(key, val) => handleWidgetChange(selectedId, key, val)}
                  onDelete={() => { handleDeleteNode(selectedId); setMobilePropsPanel(false); }}
                  gameState={gameState}
                  worldDef={worldDef}
                  eventPackId={eventPackId}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 选中节点属性面板 ───

function SelectedNodePanel({
  node, onWidgetChange, onDelete, gameState, worldDef, eventPackId,
}: {
  node?: WFNode;
  onWidgetChange: (key: string, value: unknown) => void;
  onDelete: () => void;
  gameState?: GameState;
  worldDef?: WorldDef;
  eventPackId?: string | null;
}) {
  if (!node) return <div style={{ color: 'var(--text-muted)', fontSize: 11, padding: 12 }}>节点不存在</div>;

  const d = node.data as unknown as NodeInstance;
  const def = getNodeDefinition(d.typeId);
  if (!def) return <div style={{ color: 'var(--text-muted)', fontSize: 11, padding: 12 }}>未知类型: {d.typeId}</div>;

  const widgetValues = d.widgetValues ?? {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>{def.name}</span>
        <button className="btn-ghost btn-sm" onClick={onDelete} style={{ marginLeft: 'auto', color: 'var(--danger)', padding: 4 }}><X size={14} /></button>
      </div>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{def.description}</div>

      {/* 标签 */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '11px', color: 'var(--text-secondary)' }}>
        显示名
        <input
          value={d.label ?? def.name}
          onChange={(e) => onWidgetChange('__label', e.target.value)}
          style={{ padding: '4px 6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '11px' }}
        />
      </label>

      {/* Widget 列表 */}
      {def.widgets?.map((widget) => (
        <label key={widget.socketKey} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '11px', color: 'var(--text-secondary)' }}>
          {widget.label}
          <WidgetRendererInline
            widget={widget}
            value={widgetValues[widget.socketKey]}
            onChange={(val) => onWidgetChange(widget.socketKey, val)}
            gameState={gameState}
            worldDef={worldDef}
            eventPackId={eventPackId}
          />
        </label>
      ))}

      {/* 输入/输出信息 */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-2)', fontSize: '10px', color: 'var(--text-muted)' }}>
        <div style={{ marginBottom: 4 }}>输入: {def.inputs.map((s) => s.label).join(', ') || '无'}</div>
        <div>输出: {def.outputs.map((s) => s.label).join(', ') || '无'}</div>
      </div>
    </div>
  );
}

// 内联 WidgetRenderer（避免循环依赖）
function WidgetRendererInline({
  widget, value, onChange, gameState, worldDef, eventPackId,
}: {
  widget: { type: string; label: string; options?: Array<{ label: string; value: string | number }>; min?: number; max?: number; step?: number; multiline?: boolean; placeholder?: string };
  value: unknown;
  onChange: (v: unknown) => void;
  gameState?: GameState;
  worldDef?: WorldDef;
  eventPackId?: string | null;
}) {
  const inputStyle: React.CSSProperties = {
    padding: '4px 6px', minHeight: 28, borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)', background: 'var(--bg-primary)',
    color: 'var(--text-primary)', fontSize: '11px', width: '100%', boxSizing: 'border-box',
  };

  switch (widget.type) {
    case 'number':
      return <input type="number" value={value != null ? Number(value) : ''} onChange={(e) => onChange(Number(e.target.value))} min={widget.min} max={widget.max} step={widget.step ?? 1} placeholder={widget.placeholder} style={inputStyle} />;
    case 'string':
      return widget.multiline
        ? <textarea value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={widget.placeholder} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
        : <input type="text" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={widget.placeholder} style={inputStyle} />;
    case 'boolean':
      return <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {widget.label}</label>;
    case 'select':
      return (
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
          <option value="">未选择</option>
          {(widget.options ?? []).map((opt) => <option key={String(opt.value)} value={String(opt.value)}>{opt.label}</option>)}
        </select>
      );
    case 'comparator':
      return (
        <select value={String(value ?? '>=')} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
          {['==', '!=', '>', '>=', '<', '<=', 'in', 'contains'].map((op) => <option key={op} value={op}>{op}</option>)}
        </select>
      );
    case 'math_op':
      return (
        <select value={String(value ?? 'add')} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
          {[{ l: '+ 加', v: 'add' }, { l: '- 减', v: 'sub' }, { l: '× 乘', v: 'mul' }, { l: '÷ 除', v: 'div' }, { l: '% 取余', v: 'mod' }, { l: 'min', v: 'min' }, { l: 'max', v: 'max' }].map((op) => <option key={op.v} value={op.v}>{op.l}</option>)}
        </select>
      );
    case 'event_type':
      return <input type="text" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={widget.placeholder ?? '事件类型'} style={inputStyle} />;
    case 'resource_key':
      return <ResourceKeySelect value={String(value ?? '')} gameState={gameState} worldDef={worldDef} onChange={(v) => onChange(v)} />;
    case 'stat_key':
      return (
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
          <option value="">未选择</option>
          {['attrA', 'attrB', 'dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'].map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      );
    case 'path_select':
      return <WhenPathSelect value={String(value ?? '')} onChange={(v) => onChange(v)} worldDef={worldDef} />;
    case 'event_id':
      return <EventIdSelect value={String(value ?? '')} eventPackId={eventPackId ?? undefined} worldDef={worldDef} onChange={(v) => onChange(v)} />;
    case 'npc_select':
      return <input type="text" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder="NPC 名称" style={inputStyle} />;
    default:
      return <input type="text" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} style={inputStyle} />;
  }
}
