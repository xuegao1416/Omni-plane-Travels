interface Props {
  editText: string;
  isLatest: boolean;
  onEditTextChange: (text: string) => void;
  onApply: () => void;
}

export function SnapshotDetail({ editText, isLatest, onEditTextChange, onApply }: Props) {
  return (
    <div className="game-variable-snapshot-detail" style={{
      padding: '10px 14px',
      borderTop: '1px solid var(--border)',
      background: 'var(--bg-primary)',
    }}>
      <textarea
        className="game-variable-snapshot-editor"
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
        <div className="game-variable-snapshot-actions">
          <button
            onClick={onApply}
            className="btn-primary btn-sm"
          >
            应用并保存
          </button>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', lineHeight: '28px' }}>
            编辑 JSON 后一次完成状态更新与存档
          </span>
        </div>
      )}
    </div>
  );
}
