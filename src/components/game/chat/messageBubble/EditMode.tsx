import { useRef, useCallback, useEffect } from 'react';
import { useUISettings } from '../../../../context/UISettingsContext';

interface EditModeProps {
  editText: string;
  setEditText: (text: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function EditMode({ editText, setEditText, onConfirm, onCancel }: EditModeProps) {
  const editRef = useRef<HTMLTextAreaElement>(null);
  const { t } = useUISettings();

  useEffect(() => {
    editRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onConfirm();
    }
    if (e.key === 'Escape') {
      onCancel();
    }
  }, [onConfirm, onCancel]);

  return (
    <div style={{ width: '100%' }}>
      <textarea
        ref={editRef}
        value={editText}
        onChange={e => setEditText(e.target.value)}
        onKeyDown={handleKeyDown}
        style={{
          width: '100%',
          minHeight: '200px',
          maxHeight: '60vh',
          padding: '10px 12px',
          borderRadius: '6px',
          border: '1px solid var(--border)',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
          fontSize: 'var(--body-font-size)',
          fontFamily: 'var(--font-family)',
          lineHeight: 'var(--body-line-height, 1.8)',
          resize: 'vertical',
          outline: 'none',
          whiteSpace: 'pre-wrap',
          WebkitUserSelect: 'text',
          userSelect: 'text',
          touchAction: 'auto',
        }}
      />
      <div style={{
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '6px',
        marginTop: '6px',
      }}>
        <button
          onClick={onCancel}
          style={{
            padding: '4px 12px',
            borderRadius: '4px',
            border: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-secondary)',
            fontSize: 'var(--font-size-sm)',
            cursor: 'pointer',
          }}
        >{t('common.cancel')}</button>
        <button
          onClick={onConfirm}
          style={{
            padding: '4px 12px',
            borderRadius: '4px',
            border: 'none',
            background: 'var(--accent)',
            color: 'var(--color-on-accent)',
            fontSize: 'var(--font-size-sm)',
            cursor: 'pointer',
          }}
        >{t('common.save')}</button>
      </div>
    </div>
  );
}
