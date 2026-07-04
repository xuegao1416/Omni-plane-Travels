import { useUISettings } from '../../../context/UISettingsContext';
import { ChevronRight } from 'lucide-react';

interface Props {
  reasoning: string;
  expanded: boolean;
  onToggle: () => void;
}

export default function ReasoningBlock({ reasoning, expanded, onToggle }: Props) {
  const { t } = useUISettings();

  return (
    <div style={{ marginBottom: '0.5rem' }}>
      <button
        onClick={onToggle}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          fontSize: 'var(--font-size-sm)',
          cursor: 'pointer',
          padding: '2px 0',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', transform: expanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s' }}><ChevronRight size={12} /></span>
        {t('chat.reasoning')}
      </button>
      {expanded && (
        <div style={{
          marginTop: '0.25rem',
          padding: '0.5rem',
          background: 'var(--bg-tertiary)',
          borderRadius: '6px',
          fontSize: 'var(--font-size-sm)',
          color: 'var(--text-muted)',
          whiteSpace: 'pre-wrap',
          maxHeight: '200px',
          overflowY: 'auto',
          lineHeight: '1.5',
        }}>
          {reasoning}
        </div>
      )}
    </div>
  );
}
