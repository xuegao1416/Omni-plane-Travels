import { Pencil, Copy, RefreshCw, ArrowLeftToLine, Trash2 } from 'lucide-react';
import type { ContextMenuItem } from '../ContextMenu';
import type { ChatMessage } from '../../../../engine/types';
import { processRegexScripts } from '../../../../utils/regexScripts';

interface UseMenuItemsParams {
  message: ChatMessage;
  isUser: boolean;
  displayScripts: any[];
  onEdit: () => void;
  onCopy: (text: string) => void;
  onResend: (id: string) => void;
  onResendFromHere: (id: string) => void;
  onDelete: (id: string) => void;
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
}: UseMenuItemsParams): ContextMenuItem[] {
  return [
    {
      label: '编辑消息',
      icon: <Pencil size={14} />,
      action: onEdit,
    },
    {
      label: '复制内容',
      icon: <Copy size={14} />,
      action: () => {
        const raw = message.rawText || '';
        onCopy(isUser ? raw : processRegexScripts(raw, displayScripts));
      },
    },
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
