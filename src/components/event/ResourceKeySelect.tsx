// 资源名选择器 —— 下拉规范键 + 自定义兜底,杜绝手打错 key 的沉默失败。
import { useEffect, useState, useMemo } from 'react';
import type { GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';

interface Props {
  value?: string;
  gameState?: GameState;
  /** 世界定义（无 gameState 时从 worldDef.modules 提取资源列表） */
  worldDef?: WorldDef;
  onChange: (v: string) => void;
}

const CUSTOM_SENTINEL = '__CUSTOM_RESOURCE__';

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

export default function ResourceKeySelect({ value, gameState, worldDef, onChange }: Props) {
  // 优先从 gameState.玩家.生存资源 提取键列表，其次从 worldDef.modules 提取
  const options = useMemo(() => {
    const keys: { value: string; label: string }[] = [];
    const resources = gameState?.玩家?.生存资源;
    if (resources) {
      for (const [k, v] of Object.entries(resources)) {
        keys.push({ value: k, label: v.name ?? k });
      }
      return keys;
    }
    // 无 gameState 时从 worldDef 提取
    if (worldDef?.modules) {
      for (const mod of worldDef.modules) {
        if (mod.moduleId === 'survival' && mod.enabled && mod.moduleConfig) {
          const res = mod.moduleConfig.resources as Array<{ id: string; name: string }> | undefined;
          if (res) {
            for (const r of res) {
              keys.push({ value: r.id, label: r.name ?? r.id });
            }
          }
        }
      }
    }
    return keys;
  }, [gameState?.玩家?.生存资源, worldDef]);

  const known = options.some((o) => o.value === value);
  // 用户是否主动点了"自定义"
  const [forceCustom, setForceCustom] = useState(false);

  // 当 options 变化后，如果当前值现在已知，自动退出自定义模式
  useEffect(() => {
    if (forceCustom && known) setForceCustom(false);
  }, [known, forceCustom]);

  const showCustom = forceCustom && !known;

  if (showCustom) {
    return (
      <input
        value={value ?? ''}
        placeholder="资源名,如 gold / food"
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
      <option value="">（不绑定资源）</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      <option value={CUSTOM_SENTINEL}>自定义…</option>
    </select>
  );
}
