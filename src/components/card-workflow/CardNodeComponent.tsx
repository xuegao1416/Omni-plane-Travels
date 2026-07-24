// ============================================================
//  通用卡片节点渲染组件 — 标题 + 端口 + widget 区域
// ============================================================
import { memo, useCallback } from 'react';
import { Position, type NodeProps } from '@xyflow/react';
import { getCardNodeDefinition } from '../../modules/cardNodeRegistry';
import type { CardNodeInstance } from '../../modules/schema';
import CardSocketHandle from './CardSocketHandle';
import CardWidgetRenderer from './CardWidgetRenderer';

function CardNodeComponent({ id, data, selected }: NodeProps) {
  const node = data as unknown as CardNodeInstance;
  const def = getCardNodeDefinition(node.typeId);
  if (!def) return <div style={{ padding: 8, color: 'red' }}>未知节点: {node.typeId}</div>;

  const handleWidgetChange = useCallback((socketKey: string, value: unknown) => {
    // 通过自定义事件通知父组件更新 widgetValues
    const event = new CustomEvent('cardNodeWidgetChange', {
      detail: { nodeId: id, socketKey, value },
      bubbles: true,
    });
    document.dispatchEvent(event);
  }, [id]);

  return (
    <div
      style={{
        minWidth: 180,
        background: 'var(--bg-elevated)',
        border: `2px solid ${selected ? def.color : 'var(--border)'}`,
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* 标题栏 */}
      <div
        style={{
          padding: '6px 10px',
          background: def.color,
          color: '#fff',
          fontSize: 'var(--font-size-sm)',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span>{def.name}</span>
        <span style={{ marginLeft: 'auto', fontSize: 'var(--font-size-xs)', opacity: 0.7 }}>{def.category}</span>
      </div>

      {/* 描述 */}
      <div style={{ padding: '4px 10px', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
        {def.description}
      </div>

      {/* 输入端口 + Widget 区域 */}
      <div style={{ padding: '4px 10px 8px' }}>
        {def.inputs.map((socket) => (
          <div key={socket.key} style={{ display: 'flex', alignItems: 'center', marginBottom: 4, position: 'relative' }}>
            <CardSocketHandle type={socket.type} id={socket.key} label={socket.label} position={Position.Left} />
          </div>
        ))}

        {/* Widget 区域 */}
        {def.widgets && def.widgets.length > 0 && (
          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {def.widgets.map((w) => (
              <div key={w.socketKey}>
                <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 2, display: 'block' }}>
                  {w.label}
                </label>
                <CardWidgetRenderer
                  config={w}
                  value={node.widgetValues?.[w.socketKey]}
                  onChange={(v) => handleWidgetChange(w.socketKey, v)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 输出端口 */}
      <div style={{ padding: '0 10px 8px' }}>
        {def.outputs.map((socket) => (
          <div key={socket.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 4, position: 'relative' }}>
            <CardSocketHandle type={socket.type} id={socket.key} label={socket.label} position={Position.Right} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(CardNodeComponent);
