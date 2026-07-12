import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { useUISettings } from '../../../context/UISettingsContext';
import type { ChatMessage } from '../../../engine/types';
import type { PipelineStatus as PipelineStatusType, PipelineTaskId } from '../../../engine/pipelineTypes';
import type { WorldSystemData, DiceRoll } from '../../../modules/schema';
import MessageBubble from './MessageBubble';
import ErrorBoundary from '../../ErrorBoundary';
import InputArea from './InputArea';
import PipelineMonitorModal from './PipelineMonitorModal';

interface Props {
  messages: ChatMessage[];
  isGenerating: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, content: string) => void;
  onResend: (id: string) => void;
  onResendFromHere: (id: string) => void;
  pipelineStatus?: PipelineStatusType | null;
  /** 世界系统数据（用于内联骰子卡片） */
  worldSystem?: WorldSystemData | null;
  /** 骰子掷骰结果回调 */
  onDiceRoll?: (roll: DiceRoll) => void;
  /** 单步重试回调 */
  onRetrySingleStage?: (taskId: PipelineTaskId) => void;
}

export default function ChatPanel({ messages, isGenerating, onSend, onCancel, onDelete, onEdit, onResend, onResendFromHere, pipelineStatus, worldSystem, onDiceRoll, onRetrySingleStage }: Props) {
  const [showMonitor, setShowMonitor] = useState(false);
  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const { settings, t } = useUISettings();

  // 处理内联选项点击
  const handleOptionClick = useCallback((optionText: string) => {
    setInputText(prev => {
      const trimmed = prev.trim()
      if (!trimmed) return optionText
      return `${trimmed} ${optionText}`
    })
  }, []);

  // 自动滚动到底部（受设置控制）
  useEffect(() => {
    if (!settings.autoScroll) return;
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, settings.autoScroll]);

  // 复制到剪贴板
  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {
      // fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'var(--bg-primary)',
      overflow: 'hidden',
    }}>
      {/* 消息列表 */}
      <div ref={scrollRef} style={{
        flex: 1,
        overflowY: 'auto',
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        fontSize: 'var(--body-font-size)',
        lineHeight: 'var(--body-line-height)',
        fontFamily: 'var(--font-family)',
      }}>
        {messages.length === 0 && (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            fontSize: 'var(--font-size-md)',
          }}>
            {t('chat.empty')}
          </div>
        )}
        {messages.map(msg => (
          <ErrorBoundary key={msg.id} fallback={
            <div style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--danger)',
              color: 'var(--text-muted)',
              fontSize: 'var(--font-size-sm)',
            }}>
              ⚠ 消息渲染失败 (ID: {msg.id.slice(0, 8)}…)
            </div>
          }>
            <MessageBubble
              message={msg}
              onDelete={onDelete}
              onEdit={onEdit}
              onResend={onResend}
              onResendFromHere={onResendFromHere}
              onCopy={handleCopy}
              onOptionClick={handleOptionClick}
              worldSystem={worldSystem}
              onDiceRoll={onDiceRoll}
            />
          </ErrorBoundary>
        ))}
      </div>

      {/* 输入区 */}
      <InputArea
        onSend={onSend}
        onCancel={onCancel}
        isGenerating={isGenerating}
        pipelineStatus={pipelineStatus ?? null}
        onOpenMonitor={() => setShowMonitor(true)}
        externalText={inputText}
        onExternalTextChange={() => setInputText('')}
      />

      {/* 管线监控弹窗 */}
      {showMonitor && (
        <PipelineMonitorModal
          status={pipelineStatus ?? null}
          onClose={() => setShowMonitor(false)}
          onRetrySingleStage={onRetrySingleStage}
          isGenerating={isGenerating}
        />
      )}
    </div>
  );
}
