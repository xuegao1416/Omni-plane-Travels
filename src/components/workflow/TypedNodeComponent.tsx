// ============================================================
//  类型化节点组件 — 通用节点渲染器
// ============================================================
import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Zap, Clock, TrendingUp, Play, MousePointerClick, Timer, Radio, GitCompare, Coins, Heart, Flag, Backpack, User, Ampersand, Pipette, ToggleLeft, Filter, Variable, Package, HeartPulse, Swords, AlarmClock, UserCog, ShoppingBag, NotebookPen, Globe, Eye, Database, BarChart, UserCheck, Hash, Dices, Calculator, Type, Search, ListChecks, GitBranch, GitMerge, ListOrdered, DoorOpen, ArrowRightLeft, CreditCard, FileText, Sparkles, CircleDot, ScanSearch, PackagePlus } from 'lucide-react';
import type { NodeInstance, NodeDefinition } from '../../modules/workflowSchema';
import { getNodeDefinition } from '../../modules/nodeRegistry';
import SocketHandle from './SocketHandle';
import WidgetRenderer from './WidgetRenderer';
import { useWorkflowCtx } from './WorkflowContext';

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; style?: React.CSSProperties }>> = {
  Zap, Clock, TrendingUp, Play, MousePointerClick, Timer, Radio,
  GitCompare, Coins, Heart, Flag, Backpack, User, Ampersand, Pipette, ToggleLeft, Filter,
  Variable, Package, HeartPulse, Swords, AlarmClock, UserCog, ShoppingBag, NotebookPen, Globe,
  Eye, Database, BarChart, UserCheck, Hash, Dices, Calculator, Type, Search: Search, ListChecks,
  GitBranch, GitMerge, ListOrdered, DoorOpen, ArrowRightLeft,
  CreditCard, FileText, Sparkles, CircleDot, ScanSearch, PackagePlus,
};

interface TypedNodeData extends NodeInstance {
  definition?: NodeDefinition;
  [key: string]: unknown;
}

function TypedNodeComponent({ data, selected }: NodeProps) {
  const d = data as unknown as TypedNodeData;
  const def = d.definition ?? getNodeDefinition(d.typeId);
  const { worldDef, eventPackId, gameState, onWidgetChange } = useWorkflowCtx();

  if (!def) {
    return (
      <div style={{ padding: 8, background: 'var(--danger-bg-soft)', border: '1px solid var(--danger)', borderRadius: 6, fontSize: 11, color: 'var(--danger)' }}>
        未知节点: {d.typeId}
      </div>
    );
  }

  const Icon = ICON_MAP[def.icon] ?? Zap;
  const widgetValues = d.widgetValues ?? {};

  // 计算哪些输入端口已连接
  const connectedInputs = new Set<string>();

  return (
    <div style={{
      minWidth: 135,
      maxWidth: 195,
      background: 'var(--bg-secondary)',
      border: `1px solid ${selected ? def.color : 'var(--node-border)'}`,
      borderRadius: 'var(--radius-sm)',
      boxShadow: selected ? `0 0 0 1px ${def.color}, var(--shadow-md)` : 'var(--shadow-sm)',
      overflow: 'hidden',
    }}>
      {/* 头部 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        background: `${def.color}11`,
        borderBottom: '1px solid var(--border)',
      }}>
        <Icon size={10} style={{ color: def.color, flexShrink: 0 }} />
        <span style={{ fontSize: '9px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {d.label ?? def.name}
        </span>
        <span style={{ fontSize: '7px', color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0 }}>
          {def.category}
        </span>
      </div>

      {/* 内容区：输入端口 + widget + 输出端口 */}
      <div style={{ padding: '4px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {/* 输入端口 */}
        {def.inputs.map((socket) => (
          <div key={socket.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <SocketHandle
              socket={socket}
              side="input"
              connected={connectedInputs.has(socket.key)}
              nodeId={d.id}
            />
            {/* 未连接时显示 widget */}
            {!connectedInputs.has(socket.key) && def.widgets?.find((w) => w.socketKey === socket.key) && (
              <div style={{ marginLeft: 12 }}>
                <WidgetRenderer
                  widget={def.widgets.find((w) => w.socketKey === socket.key)!}
                  value={widgetValues[socket.key]}
                  onChange={(val) => onWidgetChange?.(d.id, socket.key, val)}
                  worldDef={worldDef}
                  eventPackId={eventPackId ?? undefined}
                  gameState={gameState}
                />
              </div>
            )}
          </div>
        ))}

        {/* 独立 widget（不绑定输入端口的） */}
        {def.widgets?.filter((w) => !def.inputs.some((s) => s.key === w.socketKey)).map((widget) => (
          <div key={widget.socketKey} style={{ marginTop: 2 }}>
            <div style={{ fontSize: '7px', color: 'var(--text-muted)', marginBottom: 1 }}>{widget.label}</div>
            <WidgetRenderer
              widget={widget}
              value={widgetValues[widget.socketKey]}
              onChange={(val) => onWidgetChange?.(d.id, widget.socketKey, val)}
              worldDef={worldDef}
              eventPackId={eventPackId ?? undefined}
              gameState={gameState}
            />
          </div>
        ))}

        {/* 输出端口 */}
        {def.outputs.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2, alignItems: 'flex-end' }}>
            {def.outputs.map((socket) => (
              <SocketHandle
                key={socket.key}
                socket={socket}
                side="output"
                connected={false}
                nodeId={d.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* 运行时状态指示 */}
      {d.runtimeState?.error && (
        <div style={{ padding: '4px 10px', background: 'var(--danger-bg-soft)', borderTop: '1px solid var(--danger)', fontSize: '10px', color: 'var(--danger)' }}>
          ⚠ {d.runtimeState.error}
        </div>
      )}
      {d.runtimeState?.executed && !d.runtimeState?.error && (
        <div style={{ height: 2, background: 'var(--success)', opacity: 0.6 }} />
      )}
    </div>
  );
}

export default memo(TypedNodeComponent);
