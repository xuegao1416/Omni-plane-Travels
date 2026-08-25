import { Pencil, Copy, RefreshCw, ArrowLeftToLine, Trash2 } from 'lucide-react';
import type { ContextMenuItem } from '../ContextMenu';
import type { ChatMessage } from '../../../../engine/types';
import { processRegexScripts } from '../../../../utils/regexScripts';
import { dialogueMarkupToPlainText } from '../../../../utils/dialogueMarkup';
import { stripTimeAdvanceTags } from '../../../../time/worldClock';

interface UseMenuItemsParams {
  message: ChatMessage;
  isUser: boolean;
  displayScripts: any[];
  onEdit: () => void;
  onCopy: (text: string) => void;
  onResend: (id: string) => void;
  onResendFromHere: (id: string) => void;
  onDelete: (id: string) => void;
  readOnly?: boolean;
}

/**
 * 构建右键菜单项。
 */
export function useMenuItems({
  message,
  isUser,
  displayScripts,
  onEdit,
  onCopy,
  onResend,
  onResendFromHere,
  onDelete,
  readOnly = false,
}: UseMenuItemsParams): ContextMenuItem[] {
  const copyItem: ContextMenuItem = {
    label: '复制内容',
    icon: <Copy size={14} />,
    action: () => {
      const raw = message.rawText || '';
      const cleaned = processRegexScripts(stripTimeAdvanceTags(raw), displayScripts);
      onCopy(isUser ? raw : dialogueMarkupToPlainText(stripTimeAdvanceTags(cleaned)));
    },
  };
  if (readOnly) return [copyItem];
  return [
    {
      label: '编辑消息',
      icon: <Pencil size={14} />,
      action: onEdit,
    },
    copyItem,
    ...(isUser ? [{
      label: '重新发送',
      icon: <RefreshCw size={14} />,
      action: () => onResend(message.id),
    }] : []),
    ...(!isUser && !message.streaming ? [{
      label: '从此处重新开始',
      icon: <ArrowLeftToLine size={14} />,
      action: () => onResendFromHere(message.id),
    }] : []),
    ...(isUser ? [{
      label: '删除消息',
      icon: <Trash2 size={14} />,
      action: () => onDelete(message.id),
      danger: true,
    }] : []),
  ];
}
