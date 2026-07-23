// ============================================================
//  类型化端口 Handle — 带颜色指示器（缩小版）
// ============================================================
import { Handle, Position } from '@xyflow/react';
import type { SocketDefinition } from '../../modules/workflowSchema';
import { SOCKET_COLORS } from '../../modules/workflowSchema';

interface SocketHandleProps {
  socket: SocketDefinition;
  side: 'input' | 'output';
  connected: boolean;
  nodeId: string;
}

export default function SocketHandle({ socket, side, connected }: SocketHandleProps) {
  const color = SOCKET_COLORS[socket.type] ?? SOCKET_COLORS.any;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 3,
      position: 'relative',
      flexDirection: side === 'input' ? 'row' : 'row-reverse',
      paddingLeft: side === 'input' ? 10 : 0,
      paddingRight: side === 'output' ? 10 : 0,
      opacity: connected ? 1 : 0.6,
    }}>
      <Handle
        type={side === 'input' ? 'target' : 'source'}
        id={socket.key}
        position={side === 'input' ? Position.Left : Position.Right}
        style={{
          background: color,
          width: 7,
          height: 7,
          border: `1.5px solid ${connected ? color : 'var(--bg-secondary)'}`,
          boxShadow: connected ? `0 0 3px ${color}` : 'none',
        }}
      />
      <span style={{
        fontSize: '8px',
        color: connected ? 'var(--text-primary)' : 'var(--text-muted)',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: 100,
      }}>
        {socket.label}
        {socket.required && <span style={{ color: 'var(--danger)', marginLeft: 1 }}>*</span>}
      </span>
    </div>
  );
}
