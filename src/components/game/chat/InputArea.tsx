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
    <div className="game-journey__input-area">
      {/* 输入区 */}
      <div className="game-journey__input-inner">
        <textarea
          ref={inputRef}
          className="input-field game-journey__input"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('input.placeholder')}
          disabled={isGenerating}
          aria-label={isGenerating ? '生成中，输入已暂停' : '旅程输入'}
          rows={isMobile ? 2 : 3}
        />
        {/* 管线监控按钮 */}
        <button
          onClick={onOpenMonitor}
          title="查看管线监控"
          className={`game-journey__monitor-button${pipelineStatus && !isAllDone(pipelineStatus) ? ' is-running' : ''}`}
        >
          <Activity size={16} />
          {pipelineStatus && !isAllDone(pipelineStatus) && (
            <span className="game-journey__monitor-dot" />
          )}
        </button>
        {isGenerating ? (
          <button
            className="btn-ghost game-journey__cancel-button"
            onClick={onCancel}
          >
            <StopCircle size={16} />
            {t('input.stop')}
          </button>
        ) : (
          <button
            className="btn-primary game-journey__send-button"
            onClick={handleSend}
            disabled={!text.trim()}
            title={!text.trim() ? '请输入内容后发送' : '发送'}
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
