import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, ReactFlowProvider,
  useNodesState, useEdgesState, addEdge, Handle, Position,
  type Node, type Edge, type Connection, type NodeProps, type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowLeft, Zap, GitBranch, Gauge, Swords, Globe, ShieldAlert,
  Play, ShieldCheck, Braces, Plus, Trash2, X, AlertTriangle, Check, Dices, Save,
} from 'lucide-react';
import type {
  EventGraph, EventGraphNode, EventNodeKind, Action, ActionKind, Literal, ValidationIssue, RuleFile,
} from '../../modules/schema';
import { evaluate } from '../../modules/ruleEngine';
import { graphToRuleFile, ruleFileToGraph } from '../../modules/ruleGraph';
import { validateRuleGraph } from '../../modules/validateEvent';
import { getWebEvent } from '../../modules/eventDb';
import { saveRulesToPack } from '../../modules/webEventStore';

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
};

const PALETTE: EventNodeKind[] = ['trigger', 'condition', 'effect', 'event', 'worldState', 'guardrail'];

const ALL_PERMISSIONS = [
  'read_world_state', 'modify_world_state', 'add_card', 'override_card', 'register_tick', 'emit_world_event', 'provide_assets',
] as const;

const MOCK_CTX: Record<string, unknown> = {
  attrA: { current: 10, max: 100 },
  attrB: { current: 5, max: 50 },
  resources: { gold: { amount: 20 }, food: { amount: 8 } },
  flags: {},
};

/** React Flow 的 Node.data 需带索引签名；用交叉类型满足其约束 */
type RFNodeData = EventGraphNode & Record<string, unknown>;
type RFNode = Node<RFNodeData>;

/** 动作的非判别视图（所有字段可选），便于统一读写表单 */
type ActionView = {
  set?: { path: string; value: Literal };
  emit?: { type: string; payload?: Record<string, Literal> };
  addCard?: { cardId: string };
  overrideCard?: { cardId: string; patch: Record<string, unknown> };
  modifyResource?: { key: string; delta: number };
  scheduleTick?: { after: number; payload?: Record<string, unknown> };
};

function defaultDataFor(kind: EventNodeKind): EventGraphNode {
  const base: EventGraphNode = { id: '', kind, label: NODE_META[kind].label };
  switch (kind) {
    case 'trigger':
      return { ...base, when: { event: { type: 'dice_roll' } }, trigger: { eventType: 'dice_roll' }, priority: 10 };
    case 'effect':
      return { ...base, actions: [{ addCard: { cardId: 'adventure' } }] };
    case 'guardrail':
      return { ...base, guardrail: { setAllowedVars: [] } };
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
      data: { id: eId, kind: 'effect', label: '触发奇遇卡', actions: [{ addCard: { cardId: 'adventure' } }] } as RFNodeData,
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

export interface RuleEditorProps {
  eventPackId: string | null;
  onBack: () => void;
}

type Mode = 'visual' | 'json';

export default function RuleEditor({ eventPackId, onBack }: RuleEditorProps) {
  const seed = useMemo(seedGraph, []);
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(seed.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(seed.edges);
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
      const src = nodesRef.current.find((n) => n.id === c.source);
      const kind = (src?.data as unknown as EventGraphNode)?.kind === 'guardrail' ? 'constraint' : 'flow';
      setEdges((eds) =>
        addEdge(
          { ...c, id: `e-${c.source}-${c.target}-${Date.now().toString(36)}`, type: 'default', data: { kind }, style: edgeStyleFor(kind) } as Edge,
          eds,
        ),
      );
    },
    [setEdges],
  );

  const addNode = (kind: EventNodeKind) => {
    const id = `${kind}-${Date.now().toString(36)}`;
    const data = { ...defaultDataFor(kind), id } as RFNodeData;
    const node: RFNode = { id, type: kind, position: { x: 120 + Math.random() * 220, y: 80 + Math.random() * 200 }, data };
    setNodes((nds) => [...nds, node]);
    setSelectedId(id);
  };

  const updateNodeData = (id: string, patch: Partial<EventGraphNode>) => {
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...(n.data as object), ...patch } as RFNodeData } : n)));
  };

  const removeNode = (id: string) => {
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
    const res = evaluate(MOCK_CTX, rules, { tick: 1, permissions: [...ALL_PERMISSIONS], events });
    setSim({
      applied: res.applied.map((a) => `· [${a.kind}] ${(JSON.stringify(a.detail))}`),
      warnings: res.warnings,
      aborted: res.aborted,
      reason: res.reason,
    });
  };

  // 写回规则图到 schema/rules.json（P0-2 修复：此前编辑器零写入、返回即丢失）
  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!eventPackId) return false;
    setSaving(true);
    try {
      const rf = graphToRuleFile(toModGraph(nodes, edges));
      await saveRulesToPack(eventPackId, rf.rules);
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', flexShrink: 0 }}>
        <button className="btn-ghost btn-sm" onClick={() => void handleBack()} style={{ minHeight: 'var(--touch-min)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><ArrowLeft size={16} /> 返回</button>
        <h1 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, fontFamily: 'var(--font-display)' }}>规则编辑器</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn-primary btn-sm" onClick={() => void handleSave()} disabled={saving || !eventPackId} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Save size={15} /> {saving ? '保存中…' : '保存'}</button>
          <button className="btn-secondary btn-sm" onClick={runValidate} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ShieldCheck size={15} /> 校验</button>
          <button className="btn-primary btn-sm" onClick={runSim} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Play size={15} /> 模拟运行</button>
          <button className={mode === 'json' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => (mode === 'json' ? backToVisual() : enterJson())} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Braces size={15} /> {mode === 'json' ? '可视化' : '</> JSON'}</button>
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
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '220px 1fr var(--right-panel-width)', overflow: 'hidden' }}>
          {/* 节点面板 */}
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
              周期事件为事件包编辑器内的「周期事件」子标签（与叙事卡同属一个事件包），规则图不再产出周期节点。
            </div>
          </div>

          {/* 画布 */}
          <div style={{ position: 'relative', overflow: 'hidden' }}>
            <ReactFlowProvider>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={(_, n) => setSelectedId(n.id)}
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
          </div>

          {/* 属性面板 */}
          <div style={{ borderLeft: '1px solid var(--border)', background: 'var(--bg-secondary)', overflow: 'auto', padding: 'var(--space-3)' }}>
            {!selectedNode ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', padding: 'var(--space-6)', textAlign: 'center' }}>选中一个节点以编辑属性</div>
            ) : (
              <NodeProperties node={selectedNode} onChange={(p) => updateNodeData(selectedNode.id, p)} onRemove={() => removeNode(selectedNode.id)} eventType={eventType} setEventType={setEventType} onSimulate={runSim} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  trigger: RuleNode, condition: RuleNode, effect: RuleNode, event: RuleNode, worldState: RuleNode, guardrail: RuleNode,
};

function RuleNode({ data, selected }: NodeProps) {
  const d = data as unknown as EventGraphNode;
  const meta = NODE_META[d.kind];
  const Icon = meta.icon;
  return (
    <div
      style={{
        minWidth: 150,
        padding: 'var(--space-2) var(--space-3)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--node-border)',
        borderLeft: `3px solid ${meta.color}`,
        boxShadow: selected ? 'var(--shadow-glow)' : 'var(--shadow-sm)',
        color: 'var(--text-primary)',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: 'var(--text-muted)' }} />
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
        <Icon size={14} style={{ color: meta.color }} /> {d.label || meta.label}
      </div>
      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{meta.label}</div>
      <Handle type="source" position={Position.Right} style={{ background: 'var(--text-muted)' }} />
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  fontSize: 'var(--font-size-sm)',
  fontFamily: 'var(--font-body)',
  width: '100%',
};
const fieldLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' };

const ACTION_KINDS: ActionKind[] = ['set', 'emit', 'addCard', 'overrideCard', 'modifyResource', 'scheduleTick'];

function NodeProperties({
  node, onChange, onRemove, eventType, setEventType, onSimulate,
}: {
  node: RFNode;
  onChange: (p: Partial<EventGraphNode>) => void;
  onRemove: () => void;
  eventType: string;
  setEventType: (v: string) => void;
  onSimulate: () => void;
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
            <ActionRow key={i} action={a} onChange={(na) => setActions((d.actions ?? []).map((x, j) => (j === i ? na : x)))} onRemove={() => setActions((d.actions ?? []).filter((_, j) => j !== i))} />
          ))}
          <button className="btn-secondary btn-sm" onClick={() => setActions([...(d.actions ?? []), { addCard: { cardId: 'new' } }])} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus size={14} /> 添加动作</button>
        </div>
      )}

      {d.kind === 'guardrail' && (
        <>
          <label style={fieldLabel}>授权 set 变量（逗号分隔）<input value={(d.guardrail?.setAllowedVars ?? []).join(', ')} onChange={(e) => onChange({ guardrail: { ...(d.guardrail ?? {}), setAllowedVars: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })} style={inputStyle} /></label>
          <label style={{ ...fieldLabel, flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={!!d.guardrail?.allowCreateResources} onChange={(e) => onChange({ guardrail: { ...(d.guardrail ?? {}), allowCreateResources: e.target.checked } })} /> 允许动态创建资源</label>
        </>
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

function ActionRow({ action, onChange, onRemove }: { action: Action; onChange: (a: Action) => void; onRemove: () => void }) {
  const kind: ActionKind = 'set' in action ? 'set' : 'emit' in action ? 'emit' : 'addCard' in action ? 'addCard' : 'overrideCard' in action ? 'overrideCard' : 'modifyResource' in action ? 'modifyResource' : 'scheduleTick';
  const a = action as ActionView;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--bg-primary)' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select value={kind} onChange={(e) => {
          const k = e.target.value as ActionKind;
          const def: Action = k === 'set' ? { set: { path: 'flags.x', value: true } }
            : k === 'emit' ? { emit: { type: 'adventure' } }
            : k === 'addCard' ? { addCard: { cardId: 'adventure' } }
            : k === 'overrideCard' ? { overrideCard: { cardId: 'adventure', patch: {} } }
            : k === 'modifyResource' ? { modifyResource: { key: 'gold', delta: 1 } }
            : { scheduleTick: { after: 1 } };
          onChange(def);
        }} style={inputStyle}>
          {ACTION_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <button className="btn-ghost btn-sm" onClick={onRemove} aria-label="删除动作" style={{ color: 'var(--danger)', padding: 4 }}><X size={14} /></button>
      </div>
      {kind === 'set' && (<><input placeholder="path" value={a.set?.path ?? ''} onChange={(e) => onChange({ set: { path: e.target.value, value: a.set?.value ?? '' } })} style={inputStyle} /><input placeholder="value" value={String(a.set?.value ?? '')} onChange={(e) => onChange({ set: { path: a.set?.path ?? '', value: e.target.value } })} style={inputStyle} /></>)}
      {kind === 'emit' && <input placeholder="event type" value={a.emit?.type ?? ''} onChange={(e) => onChange({ emit: { type: e.target.value } })} style={inputStyle} />}
      {kind === 'addCard' && <input placeholder="cardId" value={a.addCard?.cardId ?? ''} onChange={(e) => onChange({ addCard: { cardId: e.target.value } })} style={inputStyle} />}
      {kind === 'overrideCard' && <input placeholder="cardId" value={a.overrideCard?.cardId ?? ''} onChange={(e) => onChange({ overrideCard: { cardId: e.target.value, patch: a.overrideCard?.patch ?? {} } })} style={inputStyle} />}
      {kind === 'modifyResource' && (<><input placeholder="key" value={a.modifyResource?.key ?? ''} onChange={(e) => onChange({ modifyResource: { key: e.target.value, delta: a.modifyResource?.delta ?? 0 } })} style={inputStyle} /><input type="number" placeholder="delta" value={a.modifyResource?.delta ?? 0} onChange={(e) => onChange({ modifyResource: { key: a.modifyResource?.key ?? '', delta: Number(e.target.value) } })} style={inputStyle} /></>)}
      {kind === 'scheduleTick' && <input type="number" placeholder="after (tick)" value={a.scheduleTick?.after ?? 1} onChange={(e) => onChange({ scheduleTick: { after: Number(e.target.value) } })} style={inputStyle} />}
    </div>
  );
}
