import { ExcelRow } from '../../../shared/ExcelRow';

function toText(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * 读者视角的一行：
 * - 角色在正文里已经确认过该字段 → 直接显示（角色知道，读者自然也知道）。
 * - 只有幕后真相 → 默认打码，由外层的一键开关统一展开，并标注"角色尚不知"。
 * 屏幕前的人可以看到全貌，但玩家扮演的角色并不会因此知情。
 */
export function resolveReveal(known: unknown, hidden: unknown): { text: string; concealed: boolean } {
  const knownText = toText(known);
  if (knownText) return { text: knownText, concealed: false };
  const hiddenText = toText(hidden);
  if (hiddenText) return { text: hiddenText, concealed: true };
  return { text: '未知', concealed: false };
}

export function RevealRow({ label, known, hidden, revealed = false }: {
  label: string; known?: unknown; hidden?: unknown; revealed?: boolean;
}) {
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
    </div>
  );
}
