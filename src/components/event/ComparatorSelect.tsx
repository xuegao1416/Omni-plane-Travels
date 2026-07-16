// 操作符下拉 —— 用于 When 条件编辑器的比较运算符选择。
import type { Comparator } from '../../modules/schema';

interface Props {
  value: Comparator;
  onChange: (v: Comparator) => void;
}

const COMPARATORS: { value: Comparator; label: string; hint: string }[] = [
  { value: '==', label: '==', hint: '等于' },
  { value: '!=', label: '!=', hint: '不等于' },
  { value: '>', label: '>', hint: '大于' },
  { value: '>=', label: '>=', hint: '大于等于' },
  { value: '<', label: '<', hint: '小于' },
  { value: '<=', label: '<=', hint: '小于等于' },
  { value: 'in', label: 'in', hint: '在列表中' },
  { value: 'contains', label: 'contains', hint: '包含' },
];

const selectStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  fontSize: 'var(--font-size-sm)',
  fontFamily: 'var(--font-body)',
};

export default function ComparatorSelect({ value, onChange }: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Comparator)}
      style={selectStyle}
    >
      {COMPARATORS.map((c) => (
        <option key={c.value} value={c.value} title={c.hint}>
          {c.label} — {c.hint}
        </option>
      ))}
    </select>
  );
}
