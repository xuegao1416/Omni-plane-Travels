import { Loader } from 'lucide-react';
import {
  customEditAreaStyle, labelStyle, inputStyle, textareaStyle,
  primaryBtnStyle, secondaryBtnStyle,
} from './styles';

interface CustomEditAreaProps {
  dimLabel: string;
  placeholderTitle: string;
  placeholderSubtitle: string;
  customTitle: string;
  customSubtitle: string;
  isCompleting: boolean;
  onTitleChange: (v: string) => void;
  onSubtitleChange: (v: string) => void;
  onCancel: () => void;
  onAIComplete: () => void;
  onSave: () => void;
}

export function CustomEditArea({
  dimLabel, placeholderTitle, placeholderSubtitle,
  customTitle, customSubtitle, isCompleting,
  onTitleChange, onSubtitleChange,
  onCancel, onAIComplete, onSave,
}: CustomEditAreaProps) {
  return (
    <div style={customEditAreaStyle}>
      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
        自定义【{dimLabel}】
      </div>

      <div style={{ marginBottom: '0.75rem' }}>
        <label style={labelStyle}>标题（2-8字）</label>
        <input
          type="text"
          value={customTitle}
          onChange={e => onTitleChange(e.target.value)}
          placeholder={`例如：${placeholderTitle}`}
          style={inputStyle}
          maxLength={20}
        />
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label style={labelStyle}>描述（20-50字）</label>
        <textarea
          value={customSubtitle}
          onChange={e => onSubtitleChange(e.target.value)}
          placeholder={`例如：${placeholderSubtitle}`}
          style={textareaStyle}
          rows={3}
          maxLength={200}
        />
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={secondaryBtnStyle}>
          取消
        </button>
        <button
          onClick={onAIComplete}
          disabled={!customTitle.trim() || isCompleting}
          style={{
            ...secondaryBtnStyle,
            opacity: !customTitle.trim() || isCompleting ? 0.5 : 1,
            cursor: !customTitle.trim() || isCompleting ? 'not-allowed' : 'pointer',
          }}
        >
          {isCompleting ? (
            <>
              <Loader size={14} style={{ animation: 'spin 0.8s linear infinite' }} />
              补全中...
            </>
          ) : (
            'AI 补全'
          )}
        </button>
        <button
          onClick={onSave}
          disabled={!customTitle.trim()}
          style={{
            ...primaryBtnStyle,
            opacity: !customTitle.trim() ? 0.5 : 1,
            cursor: !customTitle.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          保存并选中
        </button>
      </div>
    </div>
  );
}
