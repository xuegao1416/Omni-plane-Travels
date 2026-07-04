import type { LucideIcon } from 'lucide-react';
import s from './EmptyState.module.css';

interface EmptyStateProps {
  icon?: LucideIcon;
  message: string;
  action?: { label: string; onClick: () => void };
}

/**
 * 统一空状态组件
 * 替代原来散落在各处的 "大号emoji + 文字" 模式
 */
export default function EmptyState({ icon: Icon, message, action }: EmptyStateProps) {
  return (
    <div className={s.wrapper}>
      {Icon && <Icon size={32} strokeWidth={1.2} className={s.icon} />}
      <p className={s.message}>{message}</p>
      {action && (
        <button onClick={action.onClick} className={`btn-secondary ${s.action}`}>
          {action.label}
        </button>
      )}
    </div>
  );
}
