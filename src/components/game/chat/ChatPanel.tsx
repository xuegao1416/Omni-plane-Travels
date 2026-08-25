import { useEffect, useRef, useMemo, useState, useCallback, useLayoutEffect } from 'react';
import { useUISettings } from '../../../context/UISettingsContext';
import type { ChatMessage } from '../../../engine/types';
import type { PipelineStatus as PipelineStatusType, PipelineTaskId } from '../../../engine/pipelineTypes';
import type { WorldSystemData, DiceRoll } from '../../../modules/schema';
import MessageBubble from './MessageBubble';
import ErrorBoundary from '../../ErrorBoundary';
import InputArea from './InputArea';
import PipelineMonitorModal from './PipelineMonitorModal';
import { getInitialMessageStart, getPreviousMessageStart } from './messageWindow';

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
  worldName?: string;
  worldSceneUrl?: string;
  mobileSummary?: React.ReactNode;
  readOnly?: boolean;
  externalDraft?: { id: string; text: string } | null;
}

export default function ChatPanel({ messages, isGenerating, onSend, onCancel, onDelete, onEdit, onResend, onResendFromHere, pipelineStatus, worldSystem, onDiceRoll, onRetrySingleStage, worldName, worldSceneUrl, mobileSummary, readOnly = false, externalDraft = null }: Props) {
  const [showMonitor, setShowMonitor] = useState(false);
  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [visibleStart, setVisibleStart] = useState(() => getInitialMessageStart(messages.length));
  const historyAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const messageHistoryRef = useRef({ firstId: messages[0]?.id, length: messages.length });
  const { settings, t } = useUISettings();
  const lastDraftIdRef = useRef('');

  useEffect(() => {
    if (!externalDraft?.text || externalDraft.id === lastDraftIdRef.current) return;
    lastDraftIdRef.current = externalDraft.id;
    setInputText(externalDraft.text);
  }, [externalDraft]);

  const previousHistory = messageHistoryRef.current;
  const historyWasReplaced = previousHistory.firstId !== messages[0]?.id || messages.length < previousHistory.length;
  const renderedStart = historyWasReplaced ? getInitialMessageStart(messages.length) : visibleStart;
  const visibleMessages = useMemo(() => messages.slice(renderedStart), [messages, renderedStart]);

  // A new/truncated save gets a fresh recent window. Appending turns keeps the current reading range.
  useEffect(() => {
    const previous = messageHistoryRef.current;
    const firstId = messages[0]?.id;
    if (previous.firstId !== firstId || messages.length < previous.length) {
      historyAnchorRef.current = null;
      setVisibleStart(renderedStart);
    }
    messageHistoryRef.current = { firstId, length: messages.length };
  }, [messages, renderedStart]);

  const handleMessageListScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.scrollTop > 64 || visibleStart === 0 || historyAnchorRef.current) return;
    historyAnchorRef.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
    setVisibleStart(current => getPreviousMessageStart(current));
  }, [visibleStart]);

  // Prepending history must not move the paragraph currently under the reader's eyes.
  useLayoutEffect(() => {
    const anchor = historyAnchorRef.current;
    const el = scrollRef.current;
    if (!anchor || !el) return;
    el.scrollTop = anchor.scrollTop + (el.scrollHeight - anchor.scrollHeight);
    historyAnchorRef.current = null;
  }, [visibleStart]);

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
    <div className="game-journey__chat-panel">
      <div className="game-journey__narrative-banner">
        {worldSceneUrl && <span className="game-journey__narrative-banner-scene" style={{ backgroundImage: `url("${worldSceneUrl}")` }} aria-hidden="true" />}
        <span className="game-journey__narrative-banner-glass" aria-hidden="true" />
        <span className="game-journey__narrative-banner-kicker">当前旅程</span>
        <strong>{worldName || '世界漫游指南'}</strong>
      </div>
      {mobileSummary && <div className="game-journey__mobile-summary">{mobileSummary}</div>}
      {/* 消息列表 */}
      <div
        ref={scrollRef}
        className={`game-journey__message-list${settings.centeredNarrative ? ' is-centered' : ''}`}
        onScroll={handleMessageListScroll}
      >
        {messages.length === 0 && (
          <div className="game-journey__empty-state">
            {t('chat.empty')}
          </div>
        )}
        {visibleMessages.map(msg => (
          <ErrorBoundary key={msg.id} fallback={
            <div className="game-journey__message-error">
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
              onDiceRoll={readOnly ? undefined : onDiceRoll}
              readOnly={readOnly}
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
        readOnly={readOnly}
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
