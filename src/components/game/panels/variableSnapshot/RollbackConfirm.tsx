import type { SnapshotLayer } from './types';

interface Props {
  layer: SnapshotLayer;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RollbackConfirm({ layer, onConfirm, onCancel }: Props) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)',
      zIndex: 10,
    }}>
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '24px',
        maxWidth: 400,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: '600', color: 'var(--text-primary)', marginBottom: 8 }}>
          确认回滚？
        </div>
        <div style={{ fontSize: 'var(--font-size-base)', color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
          回滚到第 {layer.msgIndex + 1} 层
          {layer.content && (
            <span style={{ display: 'block', marginTop: 4, color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
              "{layer.content.slice(0, 50)}..."
            </span>
          )}
          <span style={{ display: 'block', marginTop: 8, color: 'var(--warning)', fontSize: 'var(--font-size-sm)' }}>
            ⚠️ 此操作将覆盖当前变量状态
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button onClick={onCancel} className="btn-secondary">取消</button>
          <button onClick={onConfirm} className="btn-danger">确认回滚</button>
        </div>
      </div>
    </div>
  );
}
