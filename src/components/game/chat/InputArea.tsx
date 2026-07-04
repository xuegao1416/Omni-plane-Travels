import { useState, useRef, useCallback, useEffect } from 'react';
import { useUISettings } from '../../../context/UISettingsContext';
import { useMediaQuery } from '../../../hooks/useIsMobile';
import { Activity, Send, StopCircle } from 'lucide-react';
import type { PipelineStatus as PipelineStatusType } from '../../../engine/pipelineTypes';

interface Props {
  onSend: (text: string) => void;
  onCancel: () => void;
  isGenerating: boolean;
  pipelineStatus?: PipelineStatusType | null;
  onOpenMonitor?: () => void;
  externalText?: string;
  onExternalTextChange?: () => void;
}

export default function InputArea({ onSend, onCancel, isGenerating, pipelineStatus, onOpenMonitor, externalText, onExternalTextChange }: Props) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { t } = useUISettings();
  const isMobile = useMediaQuery('(max-width: 640px)');

  // 处理外部文本变化（只处理非空值，避免清空回调导致的循环）
  const lastExternalRef = useRef(externalText);
  useEffect(() => {
    if (externalText && externalText !== lastExternalRef.current) {
      lastExternalRef.current = externalText;
      setText(externalText);
      onExternalTextChange?.();
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [externalText, onExternalTextChange]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isGenerating) return;
    onSend(trimmed);
    setText('');
    inputRef.current?.focus();
  }, [text, isGenerating, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);


  return (
    <div style={{
      borderTop: '1px solid var(--border)',
      background: 'var(--bg-secondary)',
    }}>
      {/* 输入区 */}
      <div style={{
        padding: isMobile ? '8px 12px' : '12px 16px',
        display: 'flex',
        gap: '8px',
        alignItems: 'flex-end',
      }}>
        <textarea
          ref={inputRef}
          className="input-field"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('input.placeholder')}
          disabled={isGenerating}
          rows={isMobile ? 2 : 3}
          style={{
            flex: 1,
            resize: 'none',
            fontFamily: 'inherit',
            minHeight: 'var(--touch-min)',
          }}
        />
        {/* 管线监控按钮 */}
        <button
          onClick={onOpenMonitor}
          title="查看管线监控"
          style={{
            padding: '8px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            background: pipelineStatus && !isAllDone(pipelineStatus) ? 'var(--accent-dim)' : 'transparent',
            color: pipelineStatus && !isAllDone(pipelineStatus) ? 'var(--accent)' : 'var(--text-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            minWidth: 'var(--touch-min)',
            minHeight: 'var(--touch-min)',
          }}
        >
          <Activity size={16} />
          {pipelineStatus && !isAllDone(pipelineStatus) && (
            <span style={{
              position: 'absolute', top: '2px', right: '2px',
              width: '6px', height: '6px', borderRadius: '50%',
              background: 'var(--accent)',
              animation: 'pulse 1.5s ease-in-out infinite',
            }} />
          )}
        </button>
        {isGenerating ? (
          <button
            className="btn-ghost"
            onClick={onCancel}
            style={{
              padding: '8px 16px',
              color: 'var(--danger)',
              minWidth: 'var(--touch-min)',
              minHeight: 'var(--touch-min)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
            }}
          >
            <StopCircle size={16} />
            {t('input.stop')}
          </button>
        ) : (
          <button
            className="btn-primary"
            onClick={handleSend}
            disabled={!text.trim()}
            style={{
              padding: '8px 16px',
              minWidth: 'var(--touch-min)',
              minHeight: 'var(--touch-min)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
            }}
          >
            <Send size={16} />
            {t('input.send')}
          </button>
        )}
      </div>
    </div>
  );
}

function isAllDone(status: PipelineStatusType): boolean {
  return Object.values(status.stages).every(s => s.status !== 'pending' && s.status !== 'running');
}
