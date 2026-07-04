import { useRef } from 'react';
import type { ChatMessage } from '../../../../engine/types';
import { useUISettings } from '../../../../context/UISettingsContext';
import { createIframeSrcDoc } from '../../../../utils/markdown';
import type { RenderedContent } from './renderPipeline';

interface BubbleContentProps {
  message: ChatMessage;
  isUser: boolean;
  renderedContent: RenderedContent;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  messageHtmlRef: React.RefObject<HTMLDivElement | null>;
  onOptionClick?: (optionText: string) => void;
}

/**
 * 主内容渲染：用户消息 pre-wrap、iframe、或 HTML div + ref。
 */
export default function BubbleContent({
  message,
  isUser,
  renderedContent,
  iframeRef,
  messageHtmlRef,
  onOptionClick,
}: BubbleContentProps) {
  const { t } = useUISettings();

  if (isUser) {
    return (
      <div style={{ whiteSpace: 'pre-wrap' }}>
        {message.rawText || ''}
      </div>
    );
  }

  if (renderedContent?.type === 'iframe') {
    return (
      <iframe
        ref={iframeRef}
        className="message-renderer-iframe"
        srcDoc={createIframeSrcDoc(renderedContent.content)}
        sandbox="allow-same-origin"
        loading="lazy"
        style={{
          width: '100%',
          minHeight: '360px',
          border: 'none',
          background: 'transparent',
        }}
      />
    );
  }

  return (
    <>
      {renderedContent?.content ? (
        <div
          ref={messageHtmlRef}
          className="message-html-content"
          dangerouslySetInnerHTML={{ __html: renderedContent.content }}
          style={{
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
          }}
          onClick={(e) => {
            const target = e.target as HTMLElement;

            // 代码块复制按钮（事件委托，替代 inline onclick 防止 XSS）
            const copyBtn = target.closest('[data-action="copy-code"]') as HTMLButtonElement | null;
            if (copyBtn) {
              e.preventDefault();
              e.stopPropagation();
              const wrapper = copyBtn.closest('.code-block-wrapper');
              const code = wrapper?.querySelector('code');
              if (code) {
                navigator.clipboard.writeText(code.textContent || '').then(() => {
                  copyBtn.textContent = '已复制!';
                  setTimeout(() => { copyBtn.textContent = '复制' }, 2000);
                }).catch(() => {
                  copyBtn.textContent = '失败';
                  setTimeout(() => { copyBtn.textContent = '复制' }, 2000);
                });
              }
              return;
            }

            // 行动选项点击
            const optionEl = target.closest('.action-option-card') as HTMLElement;
            if (optionEl && onOptionClick) {
              const optionText = optionEl.getAttribute('data-option-text');
              if (optionText) {
                onOptionClick(optionText);
              }
            }
          }}
        />
      ) : message.streaming && !(message.rawText) ? (
        <span style={{ opacity: 0.5 }}>{t('chat.thinking')}</span>
      ) : null}
      {message.streaming && (
        <span style={{ animation: 'blink 1s infinite', marginLeft: '2px' }}>▋</span>
      )}
    </>
  );
}
