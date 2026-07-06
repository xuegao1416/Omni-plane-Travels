import { useState, useRef, useCallback, useEffect, memo } from 'react';
import { useMediaQuery } from '../../../hooks/useIsMobile';
import ContextMenu from './ContextMenu';
import type { Props } from './messageBubble/types';
import { useRenderedContent, useDisplayScripts } from './messageBubble/renderPipeline';
import { useInlinePortals } from './messageBubble/InlinePortals';
import EditMode from './messageBubble/EditMode';
import { useMenuItems } from './messageBubble/useMenuItems';
import BubbleContent from './messageBubble/BubbleContent';

export default memo(function MessageBubble({ message, onDelete, onEdit, onResend, onResendFromHere, onCopy, onOptionClick, worldSystem, onDiceRoll }: Props) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const editingRef = useRef(false);
  editingRef.current = editing;
  const isUser = message.role === 'user';
  const isMobile = useMediaQuery('(max-width: 640px)');

  // 渲染管线
  const { renderedContent, iframeRef } = useRenderedContent(message, isUser);
  const displayScripts = useDisplayScripts();

  // 内联 Portal 挂载
  const messageHtmlRef = useRef<HTMLDivElement>(null);
  useInlinePortals(messageHtmlRef, renderedContent, worldSystem, onDiceRoll, isUser, message);

  // 右键菜单（原生事件）
  const bubbleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      if (editingRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY });
    };
    el.addEventListener('contextmenu', handler);
    return () => el.removeEventListener('contextmenu', handler);
  }, []);

  // 编辑操作
  const handleEdit = useCallback(() => {
    setEditText(message.rawText || '');
    setEditing(true);
    setContextMenu(null);
  }, [message.rawText]);

  const handleEditConfirm = useCallback(() => {
    const raw = message.rawText || '';
    if (editText.trim() !== raw) {
      onEdit(message.id, editText.trim());
    }
    setEditing(false);
  }, [editText, message.id, message.rawText, onEdit]);

  const handleEditCancel = useCallback(() => setEditing(false), []);

  // 菜单项
  const menuItems = useMenuItems({
    message, isUser, displayScripts,
    onEdit: handleEdit, onCopy, onResend, onResendFromHere, onDelete,
  });

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
    }}>
      <div
        ref={bubbleRef}
        style={{
          width: isUser ? undefined : (isMobile ? '92%' : '75%'),
          maxWidth: isUser ? (isMobile ? '95%' : '80%') : undefined,
          padding: isMobile ? '0.625rem 0.875rem' : '0.75rem 1rem',
          borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
          background: isUser ? 'var(--accent)' : 'var(--bg-secondary)',
          color: isUser ? 'var(--color-on-accent)' : 'var(--text-primary)',
          border: isUser ? 'none' : '1px solid var(--border)',
          position: 'relative',
          wordBreak: 'break-word',
          lineHeight: 'var(--body-line-height, 1.8)',
          fontSize: 'var(--body-font-size)',
          fontFamily: 'var(--font-family)',
        }}
      >
        {editing ? (
          <EditMode
            editText={editText}
            setEditText={setEditText}
            onConfirm={handleEditConfirm}
            onCancel={handleEditCancel}
          />
        ) : (
          <BubbleContent
            message={message}
            isUser={isUser}
            renderedContent={renderedContent}
            iframeRef={iframeRef}
            messageHtmlRef={messageHtmlRef}
            onOptionClick={onOptionClick}
          />
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
})
