/**
 * 世界动态面板 — 玩家切入点条目
 */

import type { PlayerHook } from '../../../../simulation/types';
import { URGENCY_ICONS, URGENCY_LABELS } from './constants';

interface PlayerHookItemProps {
  hook: PlayerHook;
}

export function PlayerHookItem({ hook }: PlayerHookItemProps) {
  return (
    <div style={{
      fontSize: 'var(--font-size-xs)', padding: '6px 8px', marginBottom: '4px',
      borderLeft: '2px solid var(--accent)',
      background: 'var(--accent-dim)',
      borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{hook.title}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
          {URGENCY_ICONS[hook.urgency]}
          {URGENCY_LABELS[hook.urgency]}
        </span>
      </div>
      <div style={{ color: 'var(--text-secondary)', lineHeight: '1.5' }}>{hook.description}</div>
      {(hook.suggestedActions?.length ?? 0) > 0 && (
        <div style={{ marginTop: '4px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {(hook.suggestedActions ?? []).map((action, ai) => (
            <span key={ai} style={{
              fontSize: 'var(--font-size-xs)', padding: '1px 6px', borderRadius: 'var(--radius-md)',
              background: 'var(--bg-tertiary)', color: 'var(--text-muted)',
            }}>
              {action}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
