/**
 * 通用工具按钮 — 共享组件
 *
 * 使用方：variableSnapshot、variableSettings 等高面板
 */

import s from './ToolBtn.module.css';

interface ToolBtnProps {
  onClick: (e?: any) => void;
  title?: string;
  disabled?: boolean;
  children: React.ReactNode;
}

export default function ToolBtn({ onClick, title, disabled, children }: ToolBtnProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`btn-ghost btn-icon ${s.root}`}
    >
      {children}
    </button>
  );
}
