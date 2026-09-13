import { useState } from 'react';
import type { ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * 整片迷雾：用于技能/物品这类成块的内容。
 *
 * 角色无从知晓的整块资料默认被迷雾盖住，点眼睛才展开。
 * 展开时内容才真正渲染——迷雾期间真相不在 DOM 里，不是视觉遮罩。
 * 这是给屏幕前的读者看的，不写回玩家认知，AI 提示词依旧只见角色已知内容。
 */
export function FogPanel({ label, children }: { label: string; children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
      background: 'var(--bg-primary)', overflow: 'hidden',
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
        <button
          type="button"
          onClick={() => setRevealed(v => !v)}
          title={revealed ? '收起幕后内容' : '查看幕后内容（角色并不知道）'}
          aria-label={revealed ? '收起幕后内容' : '查看幕后内容'}
          aria-pressed={revealed}
          style={{
            width: '22px', height: '22px', padding: 0, border: 'none', background: 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            color: revealed ? 'var(--accent)' : 'var(--text-muted)',
          }}
        >
          {revealed ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
        </button>
      </div>
      <div style={{ padding: '10px' }}>
        {revealed ? children : (
          <div aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
            {[72, 48, 60, 36].map((width, index) => (
              <div key={index} style={{ height: '10px', width: `${width}%`, borderRadius: '4px', background: 'var(--bg-tertiary)' }} />
            ))}
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', letterSpacing: '2px' }}>••••••</div>
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
