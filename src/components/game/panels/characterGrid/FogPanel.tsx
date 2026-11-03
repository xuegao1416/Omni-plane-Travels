import type { ReactNode } from 'react';

/**
 * 整片迷雾：用于技能/物品这类成块的内容。
 *
 * 真实内容照常渲染，上面糊一层高斯模糊的毛玻璃；展开后玻璃消失。
 * 这是给屏幕前的读者看的，不写回玩家认知，AI 提示词依旧只见角色已知内容。
 * 展开状态由外层的一键开关统一控制。
 */
export function FogPanel({ label, revealed, children }: { label: string; revealed: boolean; children: ReactNode }) {
  return (
    <div style={{
      position: 'relative', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)', overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '5px 8px', background: 'var(--bg-tertiary)',
      }}>
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          {label}
          {revealed && (
            <span style={{
              fontSize: 'var(--font-size-xs)', color: 'var(--warning)',
              border: '1px solid var(--warning)', borderRadius: '8px', padding: '0 6px', whiteSpace: 'nowrap',
            }}>角色尚不知</span>
          )}
        </span>
      </div>
      <div style={{ position: 'relative' }}>
        <div
          aria-hidden={!revealed}
          style={{
            padding: '10px',
            filter: revealed ? 'none' : 'blur(6px)',
            opacity: revealed ? 1 : 0.85,
            userSelect: revealed ? 'auto' : 'none',
            pointerEvents: revealed ? 'auto' : 'none',
            transition: 'filter 0.15s ease',
          }}
        >
          {children}
        </div>
        {!revealed && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'color-mix(in srgb, var(--bg-primary) 30%, transparent)',
            backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
            pointerEvents: 'none',
          }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', letterSpacing: '3px' }}>••••••</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** 成块内容是否有实质数据，用于决定"该放迷雾还是该显示暂无"。 */
export function hasBlockContent(...values: unknown[]): boolean {
  return values.some(value => {
    if (value === undefined || value === null || value === '') return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
    return true;
  });
}
