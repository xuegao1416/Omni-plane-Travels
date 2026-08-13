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
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
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
    return () => {
      el.removeEventListener('contextmenu', handler);
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
    longPressStartRef.current = null;
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'touch' || editingRef.current) return;
    cancelLongPress();
    const point = { x: e.clientX, y: e.clientY };
    longPressStartRef.current = point;
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      setContextMenu(point);
    }, 520);
  }, [cancelLongPress]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const start = longPressStartRef.current;
    if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 10) return;
    cancelLongPress();
  }, [cancelLongPress]);

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
    <div className={`game-journey__message-row${isUser ? ' is-user' : ' is-assistant'}`}>
      <div
        ref={bubbleRef}
        className={`game-journey__message-bubble${isUser ? ' is-user' : ' is-assistant'}${isMobile ? ' is-mobile' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        style={isMobile ? ({ WebkitTouchCallout: 'none', userSelect: 'none', touchAction: 'pan-y' } as React.CSSProperties) : undefined}
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
