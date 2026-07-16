// 卡片 ID 选择器 —— 下拉当前事件包的卡片列表 + 自定义兜底。
import { useEffect, useState } from 'react';
import { getWebEvent } from '../../modules/eventDb';

interface Props {
  value?: string;
  eventPackId?: string;
  onChange: (v: string) => void;
}

const CUSTOM_SENTINEL = '__CUSTOM_CARD__';

const selectStyle: React.CSSProperties = {
  padding: '8px 10px',
  minHeight: 40,
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  fontSize: 'var(--font-size-sm)',
  fontFamily: 'var(--font-body)',
  width: '100%',
  boxSizing: 'border-box',
};

export default function CardIdSelect({ value, eventPackId, onChange }: Props) {
  const [cards, setCards] = useState<{ id: string; name: string }[]>([]);

  // 从 IndexedDB 读取当前事件包的 schema/card.json 和 schema/event-*.json，提取卡片 ID 列表
  useEffect(() => {
    if (!eventPackId) return;
    (async () => {
      try {
        const rec = await getWebEvent(eventPackId);
        if (!rec) return;
        const ids: { id: string; name: string }[] = [];
        // 读取所有可能的卡片文件
        for (const [key, val] of Object.entries(rec.files)) {
          if (typeof val !== 'string') continue;
          if (key.startsWith('schema/card') || key.startsWith('schema/event-')) {
            try {
              const parsed = JSON.parse(val);
              if (parsed.id) {
                ids.push({ id: parsed.id, name: parsed.name ?? parsed.id });
              }
              // 如果是数组形式
              if (Array.isArray(parsed)) {
                for (const item of parsed) {
                  if (item.id) ids.push({ id: item.id, name: item.name ?? item.id });
                }
              }
            } catch {
              // 忽略解析失败
            }
          }
        }
        setCards(ids);
      } catch {
        // 忽略
      }
    })();
  }, [eventPackId]);

  const known = cards.some((c) => c.id === value);
  // 用户是否主动点了"自定义"
  const [forceCustom, setForceCustom] = useState(false);

  // 当 cards 变化后，如果当前值现在已知，自动退出自定义模式
  useEffect(() => {
    if (forceCustom && known) setForceCustom(false);
  }, [known, forceCustom]);

  const showCustom = forceCustom && !known;

  if (showCustom) {
    return (
      <input
        value={value ?? ''}
        placeholder="卡片 ID,如 adventure"
        onChange={(e) => onChange(e.target.value)}
        style={selectStyle}
      />
    );
  }

  return (
    <select
      value={known ? (value ?? '') : ''}
      onChange={(e) => {
        if (e.target.value === CUSTOM_SENTINEL) {
          setForceCustom(true);
          onChange('');
          return;
        }
        onChange(e.target.value);
      }}
      style={selectStyle}
    >
      <option value="">（不绑定卡片）</option>
      {cards.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
      <option value={CUSTOM_SENTINEL}>自定义…</option>
    </select>
  );
}
