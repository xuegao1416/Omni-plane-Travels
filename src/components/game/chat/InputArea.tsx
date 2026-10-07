import { useState,useRef,useCallback,useEffect } from 'react';
import { useUISettings } from '../../../context/UISettingsContext';
import { useMediaQuery } from '../../../hooks/useIsMobile';
import { Activity,Send,StopCircle } from 'lucide-react';
import type { PipelineStatus as PipelineStatusType } from '../../../engine/pipelineTypes';
import { acceptDraft, appendDraft, draftSendBlockReason, editDraft, submitDraft, type ActionSender } from './draftSubmission';

interface Props {
  onSend: ActionSender;
  onCancel: () => void;
  isGenerating: boolean;
  pipelineStatus?: PipelineStatusType | null;
  onOpenMonitor?: () => void;
  externalText?: string;
  onExternalTextChange?: () => void;
  readOnly?: boolean;
  externalBlockedReason?: string;
}

export default function InputArea({ onSend, onCancel, isGenerating, pipelineStatus, onOpenMonitor, externalText, onExternalTextChange, readOnly = false, externalBlockedReason }: Props) {
  const [draft, setDraft] = useState({ text: '', revision: 0 });
  const text = draft.text;
  const [rejection, setRejection] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const submissionIdRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { t } = useUISettings();
  const isMobile = useMediaQuery('(max-width: 640px)');

  // 处理外部文本变化（只处理非空值，避免清空回调导致的循环）
  const lastExternalRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const previous = lastExternalRef.current;
    lastExternalRef.current = externalText;
    if (externalText && externalText !== previous) {
      setDraft(current => appendDraft(current, externalText));
      setRejection('');
      onExternalTextChange?.();
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [externalText, onExternalTextChange]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || readOnly || submittingRef.current) return;
    const blockedReason = draftSendBlockReason({ externalBlockedReason, isGenerating, readOnly });
    if (blockedReason) {
      setRejection(blockedReason);
      return;
    }
    submittingRef.current = true;
    const submissionId = ++submissionIdRef.current;
    setIsSubmitting(true);
    setRejection('');
    void submitDraft(text, onSend, () => {
      setDraft(current => acceptDraft(current, draft.revision));
      submittingRef.current = false;
      setIsSubmitting(false);
      inputRef.current?.focus();
    }, reason => {
      setRejection(reason);
    }).finally(() => {
      if (submissionIdRef.current !== submissionId) return;
      submittingRef.current = false;
      setIsSubmitting(false);
    });
  }, [text, draft.revision, isGenerating, readOnly, externalBlockedReason, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);


  const pipelineRunning = Boolean(pipelineStatus && Object.values(pipelineStatus.stages).some(stage => stage.status === 'pending' || stage.status === 'running'));
  return (
    <div className="game-journey__input-area">
      {/* 输入区 */}
      <div className="game-journey__input-inner">
        <textarea
          ref={inputRef}
          className="input-field game-journey__input"
          value={text}
          onChange={e => { const nextText = e.target.value; setDraft(current => editDraft(current, nextText)); setRejection(''); }}
          onKeyDown={handleKeyDown}
          placeholder={readOnly ? '封存存档仅供回顾，不能继续旅程' : isGenerating ? '可以先写下一步，等待本轮完成后发送' : t('input.placeholder')}
          disabled={readOnly}
          aria-label={readOnly ? '封存存档只读输入区' : '旅程行动草稿'}
          aria-describedby={rejection || externalBlockedReason ? 'journey-input-feedback' : undefined}
          rows={isMobile ? 2 : 3}
        />
        {/* 管线监控按钮 */}
        <button
          onClick={onOpenMonitor}
          title="查看本轮处理详情"
          aria-label="查看本轮处理详情"
          className={`game-journey__monitor-button${pipelineRunning ? ' is-running' : ''}`}
        >
          <Activity size={16} />
          {pipelineRunning && (
            <span className="game-journey__monitor-dot" />
          )}
        </button>
        {isGenerating && !readOnly ? (
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
            disabled={readOnly || Boolean(externalBlockedReason) || isSubmitting || !text.trim()}
            title={externalBlockedReason || (readOnly ? '封存存档不能继续旅程' : !text.trim() ? '请输入内容后发送' : '发送')}
          >
            <Send size={16} />
            {readOnly ? '只读' : isSubmitting ? '正在接纳' : t('input.send')}
          </button>
        )}
      </div>
      {(rejection || externalBlockedReason) && <p id="journey-input-feedback" className={`game-journey__input-feedback${rejection ? ' is-rejected' : ''}`} role={rejection ? 'alert' : undefined}>
        {rejection ? `${rejection} 草稿仍在输入框中。` : externalBlockedReason}
      </p>}
    </div>
  );
}
