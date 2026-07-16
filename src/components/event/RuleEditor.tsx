import { useCallback, useEffect, useMemo, useRef, useState, useReducer } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, ReactFlowProvider,
  useNodesState, useEdgesState, addEdge, Handle, Position,
  type Node, type Edge, type Connection, type NodeProps, type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowLeft, Zap, GitBranch, Gauge, Swords, Globe, ShieldAlert, Clock,
  Play, ShieldCheck, Braces, Plus, Minus, Trash2, X, AlertTriangle, Check, Dices, Save,
  Undo2, Redo2, PanelLeft, SlidersHorizontal, Menu, BookOpen, Lock,
} from 'lucide-react';
import { useIsPhone } from '../../hooks/useIsMobile';
import type {
  EventGraph, EventGraphNode, EventNodeKind, Action, ActionKind, Literal, ValidationIssue, RuleFile,
} from '../../modules/schema';
import { evaluate } from '../../modules/ruleEngine';
import { graphToRuleFile, ruleFileToGraph } from '../../modules/ruleGraph';
import { validateRuleGraph } from '../../modules/validateEvent';
import { getWebEvent, putWebEvent } from '../../modules/eventDb';
import { saveRulesToPack } from '../../modules/webEventStore';
import type { GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import { findWorldDef, getAllWorlds } from '../../data/worldLoader';
import ResourceKeySelect from './ResourceKeySelect';
import WhenConditionEditor from './WhenConditionEditor';
import WhenPathSelect from './WhenPathSelect';
import EventIdSelect from './EventIdSelect';

/* 环境说明：规则画布使用项目已安装的真实 @xyflow/react（React Flow v12）。
   节点图 ↔ SimulationRules / RuleFile 的转换复用核心模块 ruleGraph.ts，
   模拟运行复用 ruleEngine.evaluate（确定性解释器，含 8ms/8192 步死循环保护）。 */

const NODE_META: Record<EventNodeKind, { label: string; icon: typeof Zap; color: string; hint: string }> = {
  trigger: { label: '触发器', icon: Zap, color: 'var(--node-trigger)', hint: '世界事件 / 关键词 / 层级触发' },
  condition: { label: '条件门', icon: GitBranch, color: 'var(--accent)', hint: '与 / 或 / 非 逻辑组合' },
  effect: { label: '效果', icon: Gauge, color: 'var(--node-effect)', hint: '变量 / 卡片 / 事件 变更' },
  event: { label: '事件', icon: Swords, color: 'var(--node-event)', hint: '主动生成 SimEvent' },
  worldState: { label: '世界状态', icon: Globe, color: 'var(--dim-geography)', hint: '更新状态轴' },
  guardrail: { label: '护栏', icon: ShieldAlert, color: 'var(--node-error)', hint: '叙事层安全边界' },
  periodic: { label: '周期触发', icon: Clock, color: 'var(--node-periodic, #8b5cf6)', hint: '每 N 轮自动触发效果' },
};

const PALETTE: EventNodeKind[] = ['trigger', 'condition', 'effect', 'event', 'worldState', 'guardrail', 'periodic'];

const ALL_PERMISSIONS = [
  'read_world_state', 'modify_world_state', 'add_card', 'override_card', 'register_tick', 'emit_world_event', 'provide_assets',
] as const;

const MOCK_CTX: Record<string, unknown> = {
  attrA: { current: 10, max: 100 },
  attrB: { current: 5, max: 50 },
  resources: { gold: { amount: 20 }, food: { amount: 8 } },
  flags: {},
};

function buildSimCtx(gameState?: GameState): Record<string, unknown> {
  if (!gameState) return MOCK_CTX;
  try {
    const ctx: Record<string, unknown> = {};
    const stats = gameState.玩家?.生存状态;
    if (stats) {
      for (const [k, v] of Object.entries(stats)) {
        if (typeof v === 'number') ctx[k] = { current: v, max: 999 };
      }
    }
    const resources: Record<string, { amount: number }> = {};
    const res = gameState.玩家?.生存资源;
    if (res) {
      for (const [k, v] of Object.entries(res)) {
        resources[k] = { amount: v.数量 ?? 0 };
      }
    }
    ctx.resources = resources;
    ctx.flags = {};
    const biz = gameState.玩家?.经营资产;
    if (biz) {
      const business: Record<string, unknown> = { funds: biz.资金 ?? 0 };
      const assets: Record<string, { level: number }> = {};
      if (biz.资产列表) {
        for (const a of biz.资产列表) {
          assets[a.id] = { level: a.等级 ?? 1 };
        }
      }
      business.assets = assets;
      ctx.business = business;
    }
    return ctx;
  } catch {
    return MOCK_CTX;
  }
}

/** React Flow 的 Node.data 需带索引签名；用交叉类型满足其约束 */
type RFNodeData = EventGraphNode & Record<string, unknown>;
type RFNode = Node<RFNodeData>;

/** 动作的非判别视图（所有字段可选），便于统一读写表单 */
type ActionView = {
  set?: { path: string; value: Literal };
  addEvent?: { eventId: string };
  modifyResource?: { key: string; delta: number };
  scheduleTick?: { after: number; payload?: Record<string, unknown> };
};

function defaultDataFor(kind: EventNodeKind): EventGraphNode {
  const base: EventGraphNode = { id: '', kind, label: NODE_META[kind].label };
  switch (kind) {
    case 'trigger':
      return { ...base, when: { event: { type: 'dice_roll' } }, trigger: { eventType: 'dice_roll' }, priority: 10 };
    case 'condition':
      return { ...base, logicMode: 'and' as const, conditionInputCount: 2 } as EventGraphNode;
    case 'effect':
      return { ...base, actions: [{ addEvent: { eventId: 'new_event' } }] };
    case 'guardrail':
      return { ...base, guardrail: { setAllowedVars: [] } };
    case 'periodic':
      return { ...base, intervalTicks: 30, offsetTicks: 0, effects: {}, narrateToAI: true, description: '' };
    default:
      return base;
  }
}

function seedGraph(): { nodes: RFNode[]; edges: Edge[] } {
  const tId = 'trigger-seed';
  const eId = 'effect-seed';
  const nodes: RFNode[] = [
    {
      id: tId, type: 'trigger', position: { x: 80, y: 80 },
      data: { id: tId, kind: 'trigger', label: '骰子检定', when: { event: { type: 'dice_roll', where: { result: 5 } } }, trigger: { eventType: 'dice_roll' }, priority: 10 } as RFNodeData,
    },
    {
      id: eId, type: 'effect', position: { x: 420, y: 80 },
      data: { id: eId, kind: 'effect', label: '触发奇遇事件', actions: [{ addEvent: { eventId: 'adventure' } }] } as RFNodeData,
    },
  ];
  const edges: Edge[] = [
    { id: `${tId}->${eId}`, source: tId, target: eId, type: 'default', style: { stroke: 'var(--node-trigger)' }, data: { kind: 'flow' } },
  ];
  return { nodes, edges };
}

function toModGraph(nodes: RFNode[], edges: Edge[]): EventGraph {
  return {
    nodes: nodes.map((n) => ({ ...(n.data as unknown as EventGraphNode) })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      kind: (e.data as { kind?: 'flow' | 'constraint' })?.kind ?? 'flow',
    })),
  };
}

function fromModGraph(graph: EventGraph): { nodes: RFNode[]; edges: Edge[] } {
  const nodes: RFNode[] = graph.nodes.map((n, i) => ({
    id: n.id,
    type: n.kind,
    position: { x: 80 + (i % 3) * 300, y: 60 + Math.floor(i / 3) * 150 },
    data: { ...n } as RFNodeData,
  }));
  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'default',
    data: { kind: e.kind ?? 'flow' },
    style: e.kind === 'constraint' ? { stroke: 'var(--node-error)', strokeDasharray: '6 4' } : { stroke: 'var(--node-trigger)' },
  }));
  return { nodes, edges };
}

const edgeStyleFor = (kind?: string) =>
  kind === 'constraint' ? { stroke: 'var(--node-error)', strokeDasharray: '6 4' } : { stroke: 'var(--node-trigger)' };

/* ─── 连接合法性规则 ─── */
const VALID_TARGETS: Record<EventNodeKind, EventNodeKind[]> = {
  trigger:   ['condition', 'effect'],
  periodic:  ['condition', 'effect'],
  condition: ['condition', 'effect'],
  effect:    ['effect', 'event', 'worldState', 'guardrail'],
  event:     ['effect', 'event', 'worldState'],
  worldState:['effect', 'event', 'worldState'],
  guardrail: [],                       // 终点，无输出
};

function isValidConnection(sourceKind: EventNodeKind, targetKind: EventNodeKind): boolean {
  return VALID_TARGETS[sourceKind]?.includes(targetKind) ?? false;
}

/** condition 节点输入端口数，默认 2 */
function getConditionInputCount(data: EventGraphNode & Record<string, unknown>): number {
  return (data.conditionInputCount as number) ?? 2;
}

export interface RuleEditorProps {
  eventPackId: string | null;
  onBack: () => void;
  gameState?: GameState;
  worldDef?: WorldDef;
}

type Mode = 'visual' | 'json';

export default function RuleEditor({ eventPackId, onBack, gameState, worldDef: worldDefProp }: RuleEditorProps) {
  const seed = useMemo(seedGraph, []);
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(seed.nodes);
  const [edges, setEdges, rawOnEdgesChange] = useEdgesState<Edge>(seed.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('visual');
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [sim, setSim] = useState<{ applied: string[]; warnings: string[]; aborted: boolean; reason?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [eventType, setEventType] = useState('dice_roll');
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // ── 世界定义（"读取世界"按钮加载） ──
  const [localWorldDef, setLocalWorldDef] = useState<WorldDef | undefined>(worldDefProp);
  const [showWorldPicker, setShowWorldPicker] = useState(false);
  const [confirmWorld, setConfirmWorld] = useState<WorldDef | null>(null);
  const [worldBound, setWorldBound] = useState(false);
  const worldDef = worldDefProp ?? localWorldDef;

  // ── 初始化：如果事件包已绑定世界，自动加载并锁定 ──
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

  const handlePickWorld = useCallback((wid: string) => {
    const found = findWorldDef(wid);
    if (found) { setConfirmWorld(found); setShowWorldPicker(false); }
  }, []);

  const handleConfirmWorld = useCallback(async () => {
    if (!confirmWorld || !eventPackId) return;
    try {
      const rec = await getWebEvent(eventPackId);
      if (rec) { rec.worldId = confirmWorld.id; await putWebEvent(rec); }
      setLocalWorldDef(confirmWorld);
      setWorldBound(true);
      setConfirmWorld(null);
      setIssues([]);
    } catch (err) {
      setIssues([{ code: 'BIND_FAILED', field: 'worldId', message: '绑定世界失败：' + (err instanceof Error ? err.message : String(err)) }]);
    }
  }, [confirmWorld, eventPackId]);

  const handleCancelWorld = useCallback(() => { setConfirmWorld(null); }, []);

  // ── 移动端面板状态 ──
  const isPhone = useIsPhone();
  const [mobileNodePanel, setMobileNodePanel] = useState(false);
  const [mobilePropsPanel, setMobilePropsPanel] = useState(false);

  // ── Undo/Redo 系统 ──
  const undoStack = useRef<Array<{ nodes: RFNode[]; edges: Edge[] }>>([]);
  const redoStack = useRef<Array<{ nodes: RFNode[]; edges: Edge[] }>>([]);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const pushHistory = useCallback(() => {
    undoStack.current.push({ nodes: [...nodesRef.current], edges: [...edges] });
    redoStack.current = [];
    if (undoStack.current.length > 50) undoStack.current.shift();
    forceUpdate();
  }, [edges]);

  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    const snapshot = undoStack.current.pop()!;
    redoStack.current.push({ nodes: [...nodesRef.current], edges: [...edges] });
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    forceUpdate();
  }, [edges, setNodes, setEdges]);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    const snapshot = redoStack.current.pop()!;
    undoStack.current.push({ nodes: [...nodesRef.current], edges: [...edges] });
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    forceUpdate();
  }, [edges, setNodes, setEdges]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  /** 包装 onEdgesChange：删除边时自动保存历史 */
  const onEdgesChange = useCallback<typeof rawOnEdgesChange>((changes) => {
    if (changes.some((c) => c.type === 'remove')) pushHistory();
    rawOnEdgesChange(changes);
  }, [rawOnEdgesChange, pushHistory]);

  /** 选中节点时高亮所有相关边 */
  const displayEdges = useMemo(() => {
    if (!selectedId) return edges;
    return edges.map((e) => {
      const isConnected = e.source === selectedId || e.target === selectedId;
      if (!isConnected) return e;
      return {
        ...e,
        style: { ...(e.style as object), strokeWidth: 2.5, filter: 'drop-shadow(0 0 6px var(--accent))' },
        className: 'edge-highlighted',
      };
    });
  }, [edges, selectedId]);

  // 打开「已安装」事件包：从落盘 schema/rules.json 还原节点图（残留#1）
  useEffect(() => {
    if (!eventPackId) return;
    let cancelled = false;
    (async () => {
      try {
        const rec = await getWebEvent(eventPackId);
        if (!rec || cancelled) return;
        const raw = rec.files['schema/rules.json'];
        if (typeof raw !== 'string') return;
        const rf = JSON.parse(raw) as RuleFile;
        const g = ruleFileToGraph(rf);
        const { nodes: n, edges: e } = fromModGraph(g);
        if (n.length > 0) { setNodes(n); setEdges(e); }
      } catch (err) {
        // 损坏数据可见化（P0-3）：暴露给用户而非静默保留种子图
        setIssues([{ code: 'LOAD_FAILED', field: 'rules.json', message: '读取已安装规则失败，已载入空白画布：' + (err instanceof Error ? err.message : String(err)) }]);
      }
    })();
    return () => { cancelled = true; };
  }, [eventPackId, setNodes, setEdges]);

  const onConnect = useCallback(
    (c: Connection) => {
      /* ── 连接合法性检查 ── */
      // 自连
      if (c.source === c.target) return;

      const srcNode = nodesRef.current.find((n) => n.id === c.source);
      const tgtNode = nodesRef.current.find((n) => n.id === c.target);
      if (!srcNode || !tgtNode) return;

      const srcKind = (srcNode.data as unknown as EventGraphNode).kind;
      const tgtKind = (tgtNode.data as unknown as EventGraphNode).kind;

      // 规则合法性
      if (!isValidConnection(srcKind, tgtKind)) return;

      // 重复连接（同 source→target 对 + 同 targetHandle）
      const isDuplicate = edges.some(
        (e) => e.source === c.source && e.target === c.target && e.targetHandle === c.targetHandle,
      );
      if (isDuplicate) return;

      // condition 输入端口容量
      if (tgtKind === 'condition') {
        const maxInputs = getConditionInputCount(tgtNode.data as unknown as EventGraphNode & Record<string, unknown>);
        const currentInputs = edges.filter((e) => e.target === c.target).length;
        if (currentInputs >= maxInputs) return;
      }

      // guardrail 约束边 vs 普通流边
      const kind = tgtKind === 'guardrail' ? 'constraint' : 'flow';
      pushHistory();
      setEdges((eds) =>
        addEdge(
          {
            ...c,
            id: `e-${c.source}-${c.target}-${Date.now().toString(36)}`,
            type: 'default',
            data: { kind },
            style: edgeStyleFor(kind),
          } as Edge,
          eds,
        ),
      );
    },
    [setEdges, edges],
  );

  const addNode = (kind: EventNodeKind) => {
    pushHistory();
    const id = `${kind}-${Date.now().toString(36)}`;
    const data = { ...defaultDataFor(kind), id } as RFNodeData;
    const node: RFNode = { id, type: kind, position: { x: 120 + Math.random() * 220, y: 80 + Math.random() * 200 }, data };
    setNodes((nds) => [...nds, node]);
    setSelectedId(id);
  };

  const updateNodeData = (id: string, patch: Partial<EventGraphNode>) => {
    pushHistory();
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...(n.data as object), ...patch } as RFNodeData } : n)));
  };

  const removeNode = (id: string) => {
    pushHistory();
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const enterJson = () => {
    setJsonText(JSON.stringify(toModGraph(nodes, edges), null, 2));
    setJsonError(null);
    setMode('json');
  };

  const applyJson = (): boolean => {
    try {
      const parsed = JSON.parse(jsonText) as EventGraph;
      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) throw new Error('nodes / edges 必须为数组');
      const { nodes: n, edges: e } = fromModGraph(parsed);
      setNodes(n);
      setEdges(e);
      setSelectedId(null);
      setJsonError(null);
      return true;
    } catch (err) {
      setJsonError('JSON 解析失败：' + (err instanceof Error ? err.message : String(err)));
      return false;
    }
  };

  const backToVisual = () => {
    if (mode === 'json') {
      if (!applyJson()) return;
    }
    setMode('visual');
  };

  const runValidate = () => {
    const g = toModGraph(nodes, edges);
    const graphIssues = validateRuleGraph(g);
    const simIssues: ValidationIssue[] = [];
    setIssues([...graphIssues, ...simIssues]);
    setMode('visual');
  };

  const runSim = () => {
    const g = toModGraph(nodes, edges);
    const rules = graphToRuleFile(g).rules;
    const events = eventType.trim() ? [{ type: eventType.trim() }] : [];
    const res = evaluate(buildSimCtx(gameState), rules, { tick: 1, permissions: [...ALL_PERMISSIONS], events });
    setSim({
      applied: res.applied.map((a) => `· [${a.kind}] ${(JSON.stringify(a.detail))}`),
      warnings: res.warnings,
      aborted: res.aborted,
      reason: res.reason,
    });
  };

  // 写回规则图到 schema/rules.json（同时保存 rules + periodicRules）
  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!eventPackId) return false;
    setSaving(true);
    try {
      const rf = graphToRuleFile(toModGraph(nodes, edges));
      await saveRulesToPack(eventPackId, rf.rules, rf.periodicRules);
      setIssues([]);
      return true;
    } catch (err) {
      setIssues([{ code: 'SAVE_FAILED', field: 'rules.json', message: '保存失败：' + (err instanceof Error ? err.message : String(err)) }]);
      return false;
    } finally {
      setSaving(false);
    }
  }, [eventPackId, nodes, edges]);

  // 返回前自动保存，避免误退出丢失编辑（同 CardEditor 的保存即落盘语义）
  const handleBack = useCallback(async () => {
    await handleSave();
    onBack();
  }, [handleSave, onBack]);

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;
  const focusIssueNode = (id?: string) => {
    if (!id) return;
    setSelectedId(id);
    setMode('visual');
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      {/* 顶栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: isPhone ? 'var(--space-1)' : 'var(--space-3)', padding: isPhone ? '6px 8px' : '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', flexShrink: 0, overflow: 'hidden' }}>
        <button className="btn-ghost btn-sm" onClick={() => void handleBack()} style={{ minHeight: isPhone ? 36 : 'var(--touch-min)', minWidth: isPhone ? 36 : undefined, display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, padding: isPhone ? '4px' : undefined }}><ArrowLeft size={16} />{!isPhone && ' 返回'}</button>
        <h1 style={{ fontSize: isPhone ? 'var(--font-size-sm)' : 'var(--font-size-lg)', fontWeight: 600, fontFamily: 'var(--font-display)', whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1 }}>规则编辑器</h1>
        <div className="event-toolbar-scroll" style={{ marginLeft: 'auto', display: 'flex', gap: isPhone ? '2px' : 'var(--space-2)', alignItems: 'center', minWidth: 0, flexShrink: 1, overflowX: 'auto', overflowY: 'hidden' }}>
          <button className="btn-ghost btn-sm" onClick={undo} disabled={!canUndo} title="撤销" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: isPhone ? 32 : undefined, minHeight: isPhone ? 32 : undefined, padding: isPhone ? '4px' : '4px 6px', flexShrink: 0, opacity: canUndo ? 1 : 0.35 }}><Undo2 size={isPhone ? 14 : 15} /></button>
          <button className="btn-ghost btn-sm" onClick={redo} disabled={!canRedo} title="重做" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: isPhone ? 32 : undefined, minHeight: isPhone ? 32 : undefined, padding: isPhone ? '4px' : '4px 6px', flexShrink: 0, opacity: canRedo ? 1 : 0.35 }}><Redo2 size={isPhone ? 14 : 15} /></button>
          <button className="btn-primary btn-sm" onClick={() => void handleSave()} disabled={saving || !eventPackId} style={{ display: 'inline-flex', alignItems: 'center', gap: isPhone ? 0 : 6, minHeight: isPhone ? 32 : undefined, padding: isPhone ? '4px 6px' : undefined, flexShrink: 0 }}><Save size={14} /> {!isPhone && (saving ? '保存中…' : '保存')}</button>
          {!isPhone && <button className="btn-secondary btn-sm" onClick={runValidate} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ShieldCheck size={15} /> 校验</button>}
          {!isPhone && <button className="btn-primary btn-sm" onClick={runSim} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Play size={15} /> 模拟运行</button>}
          <button className={mode === 'json' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => (mode === 'json' ? backToVisual() : enterJson())} style={{ display: 'inline-flex', alignItems: 'center', gap: isPhone ? 0 : 6, minHeight: isPhone ? 32 : undefined, padding: isPhone ? '4px 6px' : undefined, flexShrink: 0 }}><Braces size={14} /> {mode === 'json' ? '可视化' : !isPhone && '</> JSON'}</button>

          {/* 世界绑定按钮 */}
          {worldBound && worldDef ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: isPhone ? 2 : 4, fontSize: 'var(--font-size-xs)', color: 'var(--success)', padding: isPhone ? '2px 4px' : '4px 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--success)', whiteSpace: 'nowrap', flexShrink: 0 }}>
              <Lock size={12} /> {isPhone ? worldDef.name.slice(0, 4) : worldDef.name}
            </span>
          ) : confirmWorld ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: isPhone ? 2 : 4, fontSize: 'var(--font-size-xs)', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {!isPhone && <span style={{ color: 'var(--text-secondary)' }}>绑定「{confirmWorld.name}」?</span>}
              <button className="btn-primary btn-xs" onClick={handleConfirmWorld} style={{ padding: isPhone ? '2px 4px' : '2px 8px', minHeight: isPhone ? 24 : 28, fontSize: 'var(--font-size-xs)' }}>确认</button>
              <button className="btn-ghost btn-xs" onClick={handleCancelWorld} style={{ padding: isPhone ? '2px 4px' : '2px 8px', minHeight: isPhone ? 24 : 28 }}><X size={12} /></button>
            </span>
          ) : showWorldPicker ? (
            <select
              autoFocus
              value=""
              onChange={(e) => e.target.value && handlePickWorld(e.target.value)}
              onBlur={() => setShowWorldPicker(false)}
              style={{ ...inputStyle, width: isPhone ? 80 : 160, padding: isPhone ? '2px 4px' : '4px 8px', minHeight: isPhone ? 28 : 32, fontSize: isPhone ? 'var(--font-size-xs)' : undefined, flexShrink: 0 }}
            >
              <option value="" disabled>世界…</option>
              {getAllWorlds().map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          ) : (
            <button className="btn-secondary btn-sm" onClick={handleLoadWorld} disabled={!eventPackId} style={{ display: 'inline-flex', alignItems: 'center', gap: isPhone ? 0 : 6, minHeight: isPhone ? 32 : undefined, padding: isPhone ? '4px 6px' : undefined, flexShrink: 0, whiteSpace: 'nowrap' }}>
              <BookOpen size={14} /> {!isPhone && '读取世界'}
            </button>
          )}
          {isPhone && (
            <button className="btn-ghost btn-sm" onClick={runValidate} title="校验" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 32, minHeight: 32, padding: '4px', flexShrink: 0 }}><ShieldCheck size={14} /></button>
          )}
        </div>
      </div>

      {/* 校验 / 模拟结果条 */}
      {issues.length > 0 && (
        <div style={{ padding: 'var(--space-2) var(--space-4)', background: 'var(--danger-bg-soft)', borderBottom: '1px solid var(--border)', fontSize: 'var(--font-size-sm)', color: 'var(--danger)', maxHeight: 160, overflow: 'auto' }}>
          {issues.map((i, k) => (
            <div key={k} style={{ display: 'flex', gap: 6, cursor: i.nodeId ? 'pointer' : 'default' }} onClick={() => focusIssueNode(i.nodeId)}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{i.field ? `[${i.field}] ` : ''}{i.message}</span>
            </div>
          ))}
        </div>
      )}
      {sim && (
        <div style={{ padding: 'var(--space-2) var(--space-4)', background: sim.aborted ? 'var(--warning-bg-soft)' : 'var(--success-bg-soft)', borderBottom: '1px solid var(--border)', fontSize: 'var(--font-size-sm)', maxHeight: 180, overflow: 'auto' }}>
          <div style={{ fontWeight: 600, color: sim.aborted ? 'var(--warning)' : 'var(--success)', display: 'flex', alignItems: 'center', gap: 6 }}>
            {sim.aborted ? <AlertTriangle size={14} /> : <Check size={14} />} 模拟运行{sim.aborted ? '：触发安全上限，已中止' : '完成'}
          </div>
          {sim.applied.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>无规则命中（尝试在右侧注入事件）</div>}
          {sim.applied.map((a, k) => <div key={k} style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-body)' }}>{a}</div>)}
          {sim.warnings.map((w, k) => <div key={'w' + k} style={{ color: 'var(--warning)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={14} /> {w}</div>)}
          {sim.aborted && sim.reason && <div style={{ color: 'var(--warning)' }}>{sim.reason}</div>}
        </div>
      )}

      {mode === 'json' ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 'var(--space-4)', gap: 'var(--space-3)', overflow: 'hidden' }}>
          {jsonError && (
            <div style={{ background: 'var(--danger-bg-soft)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', color: 'var(--danger)', fontSize: 'var(--font-size-sm)', whiteSpace: 'pre-wrap' }}>{jsonError}</div>
          )}
          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            spellCheck={false}
            style={{ flex: 1, width: '100%', resize: 'none', fontFamily: 'var(--font-body)', fontSize: 'var(--font-size-sm)', lineHeight: 1.6, color: jsonError ? 'var(--danger)' : 'var(--text-primary)', background: jsonError ? 'var(--danger-bg-soft)' : 'var(--bg-secondary)', border: `1px solid ${jsonError ? 'var(--danger)' : 'var(--border)'}`, borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}
          />
          <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
            <button className="btn-secondary btn-sm" onClick={() => setJsonText(JSON.stringify(toModGraph(nodes, edges), null, 2))}>重置为画布</button>
            <button className="btn-primary btn-sm" onClick={backToVisual} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Check size={15} /> 应用并返回可视化</button>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: isPhone ? '1fr' : '220px 1fr var(--right-panel-width)', overflow: 'hidden', position: 'relative' }}>
          {/* 节点面板 — 桌面端内联 / 移动端隐藏 */}
          {!isPhone && (
            <div style={{ borderRight: '1px solid var(--border)', background: 'var(--bg-secondary)', overflow: 'auto', padding: 'var(--space-3)' }}>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 'var(--space-2)' }}>节点面板</div>
              {PALETTE.map((k) => {
                const Icon = NODE_META[k].icon;
                return (
                  <button key={k} onClick={() => addNode(k)} style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%', textAlign: 'left', padding: 'var(--space-2)', marginBottom: 'var(--space-2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', borderLeft: `3px solid ${NODE_META[k].color}`, background: 'var(--bg-primary)', cursor: 'pointer', color: 'var(--text-primary)' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-md)', fontWeight: 600 }}><Icon size={15} style={{ color: NODE_META[k].color }} /> {NODE_META[k].label}</span>
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{NODE_META[k].hint}</span>
                  </button>
                );
              })}
              <div style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px dashed var(--border)', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                周期节点：每 N 轮自动结算效果，可连接条件门做前置判断。独立于触发器，不需要外部事件驱动。
              </div>
            </div>
          )}

          {/* 画布 */}
          <div style={{ position: 'relative', overflow: 'hidden' }}>
            <ReactFlowProvider>
              <ReactFlow
                nodes={nodes}
                edges={displayEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={(_, n) => { setSelectedId(n.id); if (isPhone) setMobilePropsPanel(true); }}
                nodeTypes={nodeTypes}
                fitView
                proOptions={{ hideAttribution: true }}
                style={{ background: 'var(--bg-primary)' }}
              >
                <Background color="var(--canvas-grid)" gap={24} />
                <Controls showInteractive={false} />
                <MiniMap pannable zoomable style={{ background: 'var(--bg-secondary)' }} nodeColor={() => 'var(--accent)'} maskColor="rgba(0,0,0,0.3)" />
              </ReactFlow>
            </ReactFlowProvider>

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
                {selectedNode && (
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

          {/* 属性面板 — 桌面端内联 / 移动端隐藏 */}
          {!isPhone && (
            <div style={{ borderLeft: '1px solid var(--border)', background: 'var(--bg-secondary)', overflow: 'auto', padding: 'var(--space-3)' }}>
              {!selectedNode ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', padding: 'var(--space-6)', textAlign: 'center' }}>选中一个节点以编辑属性</div>
              ) : (
                <NodeProperties node={selectedNode} onChange={(p) => updateNodeData(selectedNode.id, p)} onRemove={() => removeNode(selectedNode.id)} eventType={eventType} setEventType={setEventType} onSimulate={runSim} gameState={gameState} eventPackId={eventPackId} worldDef={worldDef} />
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-2)' }}>
                  {PALETTE.map((k) => {
                    const Icon = NODE_META[k].icon;
                    return (
                      <button key={k} onClick={() => { addNode(k); setMobileNodePanel(false); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', borderLeft: `3px solid ${NODE_META[k].color}`, background: 'var(--bg-primary)', cursor: 'pointer', color: 'var(--text-primary)', minHeight: 44 }}>
                        <Icon size={16} style={{ color: NODE_META[k].color, flexShrink: 0 }} />
                        <div>
                          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>{NODE_META[k].label}</div>
                          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', lineHeight: 1.3 }}>{NODE_META[k].hint}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* 移动端属性面板 — 右侧滑出 */}
          {isPhone && mobilePropsPanel && selectedNode && (
            <>
              <div className="event-overlay" onClick={() => setMobilePropsPanel(false)} />
              <div className="event-right-sheet" style={{ padding: 'var(--space-3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                  <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>节点属性</span>
                  <button onClick={() => setMobilePropsPanel(false)} aria-label="关闭" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 44 }}><X size={18} /></button>
                </div>
                <NodeProperties node={selectedNode} onChange={(p) => updateNodeData(selectedNode.id, p)} onRemove={() => { removeNode(selectedNode.id); setMobilePropsPanel(false); }} eventType={eventType} setEventType={setEventType} onSimulate={runSim} gameState={gameState} eventPackId={eventPackId} worldDef={worldDef} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  trigger: RuleNode, condition: RuleNode, effect: RuleNode, event: RuleNode, worldState: RuleNode, guardrail: RuleNode, periodic: RuleNode,
};

function RuleNode({ data, selected }: NodeProps) {
  const d = data as unknown as (EventGraphNode & Record<string, unknown>);
  const meta = NODE_META[d.kind];
  const Icon = meta.icon;

  const isStart = d.kind === 'trigger' || d.kind === 'periodic';
  const isEnd = d.kind === 'guardrail';
  const isCondition = d.kind === 'condition';
  const inputCount = isCondition ? getConditionInputCount(d) : 1;

  /* condition 节点根据输入端口数自适应高度 */
  const nodeStyle: React.CSSProperties = {
    minWidth: 160,
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--node-border)',
    borderLeft: isStart ? `4px solid ${meta.color}` : `3px solid ${meta.color}`,
    borderRight: isEnd ? `4px solid ${meta.color}` : undefined,
    boxShadow: selected ? 'var(--shadow-glow)' : 'var(--shadow-sm)',
    color: 'var(--text-primary)',
    position: 'relative',
    minHeight: isCondition ? Math.max(56, 28 + inputCount * 22) : undefined,
  };

  return (
    <div style={nodeStyle}>
      {/* ── 输入端口（左侧） ── */}
      {!isStart && isCondition && (
        <>
          {Array.from({ length: inputCount }, (_, i) => (
            <Handle
              key={`cond-in-${i}`}
              type="target"
              id={`condition-${i}`}
              position={Position.Left}
              style={{
                background: 'var(--accent)',
                width: 8,
                height: 8,
                border: '2px solid var(--bg-secondary)',
                top: `${((i + 1) / (inputCount + 1)) * 100}%`,
              }}
            />
          ))}
          {/* 端口标签 */}
          {Array.from({ length: inputCount }, (_, i) => (
            <span
              key={`cond-label-${i}`}
              style={{
                position: 'absolute',
                left: 12,
                top: `${((i + 1) / (inputCount + 1)) * 100}%`,
                transform: 'translateY(-50%)',
                fontSize: '9px',
                color: 'var(--text-muted)',
                pointerEvents: 'none',
                lineHeight: 1,
              }}
            >
              {String.fromCharCode(65 + i)}
            </span>
          ))}
        </>
      )}
      {!isStart && !isCondition && (
        <Handle
          type="target"
          id="target"
          position={Position.Left}
          style={{ background: 'var(--text-muted)' }}
        />
      )}

      {/* ── 节点内容 ── */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-sm)', fontWeight: 600, marginLeft: isCondition ? 8 : 0 }}>
        <Icon size={14} style={{ color: meta.color }} /> {d.label || meta.label}
      </div>
      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginLeft: isCondition ? 8 : 0 }}>
        {meta.label}
        {isCondition && ` · ${(d.logicMode ?? 'and').toUpperCase()} · ${inputCount}入/1出`}
      </div>

      {/* ── 输出端口（右侧） ── */}
      {!isEnd && (
        <Handle
          type="source"
          id="source"
          position={Position.Right}
          style={{ background: isStart ? meta.color : 'var(--text-muted)' }}
        />
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  minHeight: 40,
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  fontSize: 'var(--font-size-sm)',
  fontFamily: 'var(--font-body)',
  width: '100%',
  boxSizing: 'border-box',
};
const fieldLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' };

const ACTION_KINDS: ActionKind[] = ['set', 'addEvent', 'modifyResource', 'scheduleTick'];

const ACTION_KIND_LABELS: Record<ActionKind, string> = {
  set: '修改变量',
  addEvent: '触发事件',
  modifyResource: '资源变化',
  scheduleTick: '延迟触发',
};

function NodeProperties({
  node, onChange, onRemove, eventType, setEventType, onSimulate, gameState, eventPackId, worldDef,
}: {
  node: RFNode;
  onChange: (p: Partial<EventGraphNode>) => void;
  onRemove: () => void;
  eventType: string;
  setEventType: (v: string) => void;
  onSimulate: () => void;
  gameState?: GameState;
  eventPackId?: string | null;
  worldDef?: WorldDef;
}) {
  const d = node.data as unknown as EventGraphNode;
  const meta = NODE_META[d.kind];

  const setActions = (actions: Action[]) => onChange({ actions });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <meta.icon size={16} style={{ color: meta.color }} />
        <span style={{ fontWeight: 600 }}>{meta.label}属性</span>
        <button className="btn-ghost btn-sm" onClick={onRemove} aria-label="删除节点" style={{ marginLeft: 'auto', color: 'var(--danger)', padding: 4 }}><Trash2 size={14} /></button>
      </div>

      <label style={fieldLabel}>显示名<input value={d.label} onChange={(e) => onChange({ label: e.target.value })} style={inputStyle} /></label>

      {d.kind === 'condition' && (
        <>
          <WhenConditionEditor when={d.when} onChange={(when) => onChange({ when } as Partial<EventGraphNode>)} worldDef={worldDef} />
          <label style={fieldLabel}>
            逻辑模式
            <select
              value={d.logicMode ?? 'and'}
              onChange={(e) => {
                const mode = e.target.value as 'and' | 'or' | 'not';
                const patch: Partial<EventGraphNode> = { logicMode: mode } as Partial<EventGraphNode>;
                // NOT 门强制 1 个输入端口
                if (mode === 'not') (patch as Record<string, unknown>).conditionInputCount = 1;
                onChange(patch);
              }}
              style={inputStyle}
            >
              <option value="and">AND — 所有条件都满足</option>
              <option value="or">OR — 任一条件满足</option>
              <option value="not">NOT — 取反（锁定 1 条入边）</option>
            </select>
          </label>
          <div style={fieldLabel}>
          输入端口数
          {d.logicMode === 'not' ? (
            <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-muted)', padding: '4px 0' }}>
              1（NOT 门固定）
            </div>
          ) : (
            <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                className="btn-ghost btn-xs"
                onClick={() => {
                  const cur = getConditionInputCount(d as EventGraphNode & Record<string, unknown>);
                  if (cur > 1) onChange({ conditionInputCount: cur - 1 } as Partial<EventGraphNode>);
                }}
                style={{ padding: 2 }}
              >
                <Minus size={14} />
              </button>
              <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, minWidth: 20, textAlign: 'center' }}>
                {getConditionInputCount(d as EventGraphNode & Record<string, unknown>)}
              </span>
              <button
                className="btn-ghost btn-xs"
                onClick={() => {
                  const cur = getConditionInputCount(d as EventGraphNode & Record<string, unknown>);
                  if (cur < 6) onChange({ conditionInputCount: cur + 1 } as Partial<EventGraphNode>);
                }}
                style={{ padding: 2 }}
              >
                <Plus size={14} />
              </button>
            </div>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>每个输入可连入一条前置条件</span>
            </>
          )}
        </div>
        </>
      )}

      {d.kind === 'trigger' && (
        <>
          <label style={fieldLabel}>事件类型<input value={d.trigger?.eventType ?? ''} onChange={(e) => onChange({ trigger: { ...(d.trigger ?? {}), eventType: e.target.value } })} style={inputStyle} /></label>
          <label style={fieldLabel}>优先级<input type="number" value={d.priority ?? 0} onChange={(e) => onChange({ priority: Number(e.target.value) })} style={inputStyle} /></label>
          <label style={{ ...fieldLabel, flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={!!d.once} onChange={(e) => onChange({ once: e.target.checked })} /> 仅触发一次</label>
          <label style={fieldLabel}>冷却（tick）<input type="number" value={d.cooldownTicks ?? 0} onChange={(e) => onChange({ cooldownTicks: Number(e.target.value) })} style={inputStyle} /></label>
        </>
      )}

      {d.kind === 'effect' && (
        <div style={fieldLabel}>动作序列
          {(d.actions ?? []).map((a, i) => (
            <ActionRow key={i} action={a} onChange={(na) => setActions((d.actions ?? []).map((x, j) => (j === i ? na : x)))} onRemove={() => setActions((d.actions ?? []).filter((_, j) => j !== i))} eventPackId={eventPackId} worldDef={worldDef} gameState={gameState} />
          ))}
          <button className="btn-secondary btn-sm" onClick={() => setActions([...(d.actions ?? []), { addEvent: { eventId: 'new_event' } }])} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus size={14} /> 添加动作</button>
        </div>
      )}

      {d.kind === 'guardrail' && (
        <>
          <label style={fieldLabel}>授权 set 变量（逗号分隔）<input value={(d.guardrail?.setAllowedVars ?? []).join(', ')} onChange={(e) => onChange({ guardrail: { ...(d.guardrail ?? {}), setAllowedVars: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })} style={inputStyle} /></label>
          <label style={{ ...fieldLabel, flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={!!d.guardrail?.allowCreateResources} onChange={(e) => onChange({ guardrail: { ...(d.guardrail ?? {}), allowCreateResources: e.target.checked } })} /> 允许动态创建资源</label>
        </>
      )}

      {d.kind === 'periodic' && (
        <PeriodicNodeProps node={d} onChange={onChange} eventPackId={eventPackId} worldDef={worldDef} gameState={gameState} />
      )}

      {d.kind === 'worldState' && (
        <label style={fieldLabel}>状态更新（axis.field=value 一行一条）<textarea value={Object.entries(d.updates ?? {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n')} onChange={(e) => {
          const obj: Record<string, Record<string, string>> = {};
          e.target.value.split('\n').forEach((line) => {
            const idx = line.indexOf('=');
            if (idx <= 0) return;
            const key = line.slice(0, idx).trim();
            const val = line.slice(idx + 1).trim();
            const dot = key.indexOf('.');
            const axis = dot < 0 ? key : key.slice(0, dot);
            const field = dot < 0 ? '' : key.slice(dot + 1);
            obj[axis] = { ...(obj[axis] ?? {}), [field]: val };
          });
          onChange({ updates: obj });
        }} rows={3} style={inputStyle} /></label>
      )}

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>模拟注入事件</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={eventType} onChange={(e) => setEventType(e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder="事件类型" />
          <button className="btn-ghost btn-sm" onClick={() => setEventType('dice_roll')} title="骰子检定"><Dices size={15} /></button>
        </div>
        <button className="btn-primary btn-sm" onClick={onSimulate} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}><Play size={15} /> 运行模拟</button>
      </div>
    </div>
  );
}

/** 周期节点专属属性面板：interval / offset / description / effects */
function PeriodicNodeProps({ node, onChange, eventPackId, worldDef, gameState }: { node: EventGraphNode; onChange: (p: Partial<EventGraphNode>) => void; eventPackId?: string | null; worldDef?: WorldDef; gameState?: GameState }) {
  const actions = node.actions ?? [];

  const setActions = (next: Action[]) => onChange({ actions: next });

  return (
    <>
      <label style={fieldLabel}>触发间隔（tick）<input type="number" min={1} value={node.intervalTicks ?? 30} onChange={(e) => onChange({ intervalTicks: Math.max(1, Number(e.target.value)) })} style={inputStyle} /></label>
      <label style={fieldLabel}>首次偏移（tick）<input type="number" min={0} value={node.offsetTicks ?? 0} onChange={(e) => onChange({ offsetTicks: Math.max(0, Number(e.target.value)) })} style={inputStyle} /></label>
      <label style={fieldLabel}>描述<textarea value={node.description ?? ''} onChange={(e) => onChange({ description: e.target.value })} rows={2} style={{ ...inputStyle, resize: 'vertical' }} placeholder="描述这个周期事件..." /></label>
      <label style={{ ...fieldLabel, flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={node.narrateToAI !== false} onChange={(e) => onChange({ narrateToAI: e.target.checked })} /> 结算后喂给 AI 叙事</label>

      {/* 动作序列 */}
      <div style={fieldLabel}>
        动作序列
        {actions.map((a, i) => (
          <ActionRow key={i} action={a} onChange={(na) => setActions(actions.map((x, j) => (j === i ? na : x)))} onRemove={() => setActions(actions.filter((_, j) => j !== i))} eventPackId={eventPackId} worldDef={worldDef} gameState={gameState} />
        ))}
        <button className="btn-secondary btn-sm" onClick={() => setActions([...actions, { addEvent: { eventId: 'new_event' } }])} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus size={14} /> 添加动作</button>
      </div>
    </>
  );
}

function ActionRow({ action, onChange, onRemove, eventPackId, worldDef, gameState }: { action: Action; onChange: (a: Action) => void; onRemove: () => void; eventPackId?: string | null; worldDef?: WorldDef; gameState?: GameState }) {
  const kind: ActionKind = 'set' in action ? 'set' : 'addEvent' in action ? 'addEvent' : 'modifyResource' in action ? 'modifyResource' : 'scheduleTick';
  const a = action as ActionView;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--bg-primary)' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select value={kind} onChange={(e) => {
          const k = e.target.value as ActionKind;
          const def: Action = k === 'set' ? { set: { path: 'flags.x', value: true } }
            : k === 'addEvent' ? { addEvent: { eventId: 'new_event' } }
            : k === 'modifyResource' ? { modifyResource: { key: 'gold', delta: 1 } }
            : { scheduleTick: { after: 1 } };
          onChange(def);
        }} style={inputStyle}>
          {ACTION_KINDS.map((k) => <option key={k} value={k}>{ACTION_KIND_LABELS[k] ?? k}</option>)}
        </select>
        <button className="btn-ghost btn-sm" onClick={onRemove} aria-label="删除动作" style={{ color: 'var(--danger)', padding: 4 }}><X size={14} /></button>
      </div>
      {kind === 'set' && (
        <>
          <WhenPathSelect value={a.set?.path ?? ''} onChange={(p) => onChange({ set: { path: p, value: a.set?.value ?? '' } })} worldDef={worldDef} excludeResources />
          <input placeholder="value" value={String(a.set?.value ?? '')} onChange={(e) => onChange({ set: { path: a.set?.path ?? '', value: e.target.value } })} style={inputStyle} />
        </>
      )}
      {kind === 'addEvent' && (
        <EventIdSelect value={a.addEvent?.eventId} eventPackId={eventPackId ?? undefined} worldDef={worldDef} onChange={(eid) => onChange({ addEvent: { eventId: eid } })} />
      )}
      {kind === 'modifyResource' && (
        <>
          <ResourceKeySelect value={a.modifyResource?.key} gameState={gameState} worldDef={worldDef} onChange={(k) => onChange({ modifyResource: { key: k, delta: a.modifyResource?.delta ?? 0 } })} />
          <input type="number" placeholder="delta" value={a.modifyResource?.delta ?? 0} onChange={(e) => onChange({ modifyResource: { key: a.modifyResource?.key ?? '', delta: Number(e.target.value) } })} style={inputStyle} />
        </>
      )}
      {kind === 'scheduleTick' && <input type="number" placeholder="after (tick)" value={a.scheduleTick?.after ?? 1} onChange={(e) => onChange({ scheduleTick: { after: Number(e.target.value) } })} style={inputStyle} />}
    </div>
  );
}
