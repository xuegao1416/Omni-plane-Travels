interface Props {
  editText: string;
  isLatest: boolean;
  onEditTextChange: (text: string) => void;
  onApply: () => void;
}

export function SnapshotDetail({ editText, isLatest, onEditTextChange, onApply }: Props) {
  return (
    <div className="game-variable-snapshot-detail" style={{
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
          maxHeight: 400,
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-primary)',
          fontSize: 'var(--font-size-sm)',
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
