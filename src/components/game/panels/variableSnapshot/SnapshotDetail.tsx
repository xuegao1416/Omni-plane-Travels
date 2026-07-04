import type { SnapshotLayer } from './types';

interface Props {
  layer: SnapshotLayer;
  editText: string;
  isLatest: boolean;
  onEditTextChange: (text: string) => void;
  onApply: () => void;
}

export function SnapshotDetail({ layer, editText, isLatest, onEditTextChange, onApply }: Props) {
  return (
    <div style={{
      padding: '10px 14px',
      borderTop: '1px solid var(--border)',
      background: 'var(--bg-primary)',
    }}>
      <textarea
        value={editText}
        onChange={e => onEditTextChange(e.target.value)}
        readOnly={!isLatest}
        spellCheck={false}
        style={{
          width: '100%',
          minHeight: 200,
          maxHeight: 400,
          padding: '10px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          background: isLatest ? 'var(--bg-secondary)' : 'var(--bg-tertiary, rgba(255,255,255,0.02))',
          color: 'var(--text-primary)',
          fontSize: 'var(--font-size-sm)',
          fontFamily: "var(--font-mono, 'Consolas', monospace)",
          lineHeight: 1.6,
          resize: 'vertical',
          outline: 'none',
        }}
      />
      {isLatest && (
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <button
            onClick={onApply}
            className="btn-primary btn-sm"
          >
            应用编辑
          </button>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', lineHeight: '28px' }}>
            编辑 JSON 后点击应用
          </span>
        </div>
      )}
    </div>
  );
}
