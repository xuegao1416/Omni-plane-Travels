// ============================================================
//  卡片节点端口连接点 — 类型化颜色 + 连接验证
// ============================================================
import { Handle, Position, type HandleProps } from '@xyflow/react';
import type { CardSocketType } from '../../modules/schema';

const SOCKET_COLORS: Record<CardSocketType, string> = {
  flow:     '#a78bfa',
  number:   '#60a5fa',
  string:   '#34d399',
  boolean:  '#fbbf24',
  stat:     '#38bdf8',
  resource: '#fb923c',
  flag:     '#e879f9',
  any:      '#94a3b8',
};

interface Props {
  type: CardSocketType;
  id: string;
  label?: string;
  position: Position;
  isConnectable?: boolean;
}

export default function CardSocketHandle({ type, id, label, position, isConnectable = true }: Props) {
  const color = SOCKET_COLORS[type] ?? '#94a3b8';
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
