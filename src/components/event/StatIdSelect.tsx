// 属性 id 选择器 —— 下拉规范键 + 自定义兜底,杜绝手打错 key 的沉默失败。
import { useEffect, useState } from 'react';
import type { GameState } from '../../schema/variables';
import {
  getStatOptionsFromState,
  CUSTOM_STAT_SENTINEL,
} from '../../modules/canonicalStats';

interface Props {
  value?: string;
  gameState?: GameState;
  onChange: (v: string) => void;
}

const selectStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  fontSize: 'var(--font-size-sm)',
  fontFamily: 'var(--font-body)',
};

export default function StatIdSelect({ value, gameState, onChange }: Props) {
  const options = getStatOptionsFromState(gameState);
  const known = options.some((o) => o.value === value);
  const [mode, setMode] = useState<'select' | 'custom'>(known || !value ? 'select' : 'custom');
  const [custom, setCustom] = useState(!known && value ? value : '');

  // 外部 value 变化且不在选项内 → 自动切到自定义并回填,避免旧数据丢失
  useEffect(() => {
    const k = options.some((o) => o.value === value);
    if (!k && value) {
      setMode('custom');
      setCustom(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, options.map((o) => o.value).join(',')]);

  if (mode === 'custom') {
    return (
      <input
        value={custom}
        placeholder="属性键,如 attrA / dim1"
        onChange={(e) => {
          setCustom(e.target.value);
          onChange(e.target.value);
        }}
        style={selectStyle}
      />
    );
  }

  return (
    <select
      value={value ?? ''}
      onChange={(e) => {
        if (e.target.value === CUSTOM_STAT_SENTINEL) {
          setMode('custom');
          setCustom('');
          return;
        }
        onChange(e.target.value);
      }}
      style={selectStyle}
    >
      <option value="">（不绑定属性）</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      <option value={CUSTOM_STAT_SENTINEL}>自定义…</option>
    </select>
  );
}
