import type { ReactNode } from 'react';
import type { EventPackType } from '../../modules/schema';
import { typeIcon } from './eventIcons';

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const BG: Record<Tone, string> = {
  neutral: 'var(--bg-tertiary)',
  accent: 'var(--accent-dim)',
  success: 'var(--success-bg-soft)',
  warning: 'var(--warning-bg-soft)',
  danger: 'var(--danger-bg-soft)',
};

const FG: Record<Tone, string> = {
  neutral: 'var(--text-secondary)',
  accent: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
};

/** 中性 / 语义胶囊徽章（无渐变，仅 Token） */
export function StatusBadge({
  children,
  tone = 'neutral',
  icon,
}: {
  children: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--font-size-xs)',
        fontWeight: 600,
        background: BG[tone],
        color: FG[tone],
        whiteSpace: 'nowrap',
        lineHeight: 1.4,
      }}
    >
      {icon}
      {children}
    </span>
  );
}

const TYPE_LABEL: Record<EventPackType, string> = {
  card: '卡片',
  rule: '规则',
  worldbook: '世界书',
  bundle: '合集',
};

/** Event 类型中性徽章（图标走 Lucide，按类型） */
export function EventTypeBadge({ type }: { type: EventPackType }) {
  const Icon = typeIcon(type);
  return (
    <StatusBadge tone="neutral" icon={<Icon size={12} strokeWidth={2} />}>
      {TYPE_LABEL[type]}
    </StatusBadge>
  );
}
