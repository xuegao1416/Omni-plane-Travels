// ============================================================
//  卡片节点端口连接点 — 类型化颜色 + 连接验证
// ============================================================
import { Handle,Position } from '@xyflow/react';
import type { CardSocketType } from '../../modules/schema';
import { CARD_SOCKET_COLORS } from '../../modules/workflowSchema';

const SOCKET_COLORS: Record<CardSocketType, string> = CARD_SOCKET_COLORS;

interface Props {
  type: CardSocketType;
  id: string;
  label?: string;
  position: Position;
  isConnectable?: boolean;
}

export default function CardSocketHandle({ type, id, label, position, isConnectable = true }: Props) {
  const color = SOCKET_COLORS[type] ?? SOCKET_COLORS.any;
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4, [position === Position.Left ? 'flexDirection' : 'flexDirection']: 'row' as const }}>
      <Handle
        type={position === Position.Left ? 'target' : 'source'}
        position={position}
        id={id}
        isConnectable={isConnectable}
        style={{
          width: 10,
          height: 10,
          background: color,
          border: `2px solid ${color}`,
          borderRadius: '50%',
        }}
      />
      {label && (
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginLeft: position === Position.Left ? 14 : 0, marginRight: position === Position.Right ? 14 : 0 }}>
          {label}
        </span>
      )}
    </div>
  );
}
