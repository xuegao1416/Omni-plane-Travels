import { useState,useRef,useCallback,useEffect,memo } from 'react';
import { useMediaQuery } from '../../../hooks/useIsMobile';
import ContextMenu from './ContextMenu';
import type { ContextMenuSource } from './contextMenuPlacement';
import type { Props } from './messageBubble/types';
import { useRenderedContent,useDisplayScripts } from './messageBubble/renderPipeline';
import EditMode from './messageBubble/EditMode';
import { useMenuItems } from './messageBubble/useMenuItems';
import BubbleContent from './messageBubble/BubbleContent';

export default memo(function MessageBubble({ message, onDelete, onEdit, onResend, onResendFromHere, onCopy, onOptionClick, worldSystem, onDiceRoll, readOnly = false }: Props) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; source: ContextMenuSource } | null>(null);
  /** 最近一次按下用的是手指还是鼠标：安卓长按也会触发 contextmenu，要按触屏来摆菜单。 */
  const lastPointerTypeRef = useRef<string>('mouse');
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

  // 右键菜单（原生事件）
  const bubbleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      if (editingRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const pointerType = 'pointerType' in e && typeof e.pointerType === 'string' && e.pointerType ? e.pointerType : lastPointerTypeRef.current;
      const source: ContextMenuSource = pointerType === 'touch' ? 'touch' : 'mouse';
      if (source === 'touch') {
        // 安卓的长按：和下面的长按计时器是同一次操作，用手指按下的位置，只打开一次。
        const start = longPressStartRef.current;
        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
        setContextMenu(current => current ?? { x: start?.x ?? e.clientX, y: start?.y ?? e.clientY, source });
        return;
      }
      setContextMenu({ x: e.clientX, y: e.clientY, source });
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
    lastPointerTypeRef.current = e.pointerType;
    if (e.pointerType !== 'touch' || editingRef.current) return;
    cancelLongPress();
    const point = { x: e.clientX, y: e.clientY };
    longPressStartRef.current = point;
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      setContextMenu({ ...point, source: 'touch' });
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
    onEdit: handleEdit, onCopy, onResend, onResendFromHere, onDelete, readOnly,
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
            worldSystem={worldSystem}
            onDiceRoll={onDiceRoll}
            onOptionClick={readOnly ? undefined : onOptionClick}
          />
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          source={contextMenu.source}
          items={menuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
})
