import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { ExcelRow } from '../../../shared/ExcelRow';

function toText(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * 读者视角的一行：
 * - 角色在正文里已经确认过该字段 → 直接显示（角色知道，读者自然也知道）。
 * - 只有幕后真相 → 默认遮住，点眼睛才展开，并标注"角色尚不知"。
 * 屏幕前的人可以看到全貌，但玩家扮演的角色并不会因此知情。
 */
export function resolveReveal(known: unknown, hidden: unknown): { text: string; concealed: boolean } {
  const knownText = toText(known);
  if (knownText) return { text: knownText, concealed: false };
  const hiddenText = toText(hidden);
  if (hiddenText) return { text: hiddenText, concealed: true };
  return { text: '未知', concealed: false };
}

export function RevealRow({ label, known, hidden }: { label: string; known?: unknown; hidden?: unknown }) {
  const [revealed, setRevealed] = useState(false);
  const { text, concealed } = resolveReveal(known, hidden);
  if (!concealed) return <ExcelRow label={label} value={text} />;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '4px 0', fontSize: 'var(--font-size-sm)' }}>
      <span style={{ color: 'var(--text-muted)', minWidth: '72px', flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1, lineHeight: '1.6', wordBreak: 'break-word', color: revealed ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
        {revealed ? text : '••••••'}
        {revealed && (
          <span style={{
            marginLeft: '6px', fontSize: 'var(--font-size-xs)', color: 'var(--warning)',
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
          flexShrink: 0, width: '22px', height: '22px', padding: 0, border: 'none', background: 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          color: revealed ? 'var(--accent)' : 'var(--text-muted)',
        }}
      >
        {revealed ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
      </button>
    </div>
  );
}
