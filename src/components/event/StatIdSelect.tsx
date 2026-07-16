// 属性 id 选择器 —— 下拉规范键 + 自定义兜底,杜绝手打错 key 的沉默失败。
import { useEffect, useState, useMemo } from 'react';
import type { GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import {
  getStatOptionsFromState,
  CUSTOM_STAT_SENTINEL,
} from '../../modules/canonicalStats';

interface Props {
  value?: string;
  gameState?: GameState;
  /** 世界定义（无 gameState 时从 worldDef.modules 提取属性列表） */
  worldDef?: WorldDef;
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

export default function StatIdSelect({ value, gameState, worldDef, onChange }: Props) {
  // 优先用 gameState，其次用 worldDef 提取属性选项
  const worldOptions = useMemo(() => {
    if (gameState || !worldDef?.modules) return null;
    const base = [
      { value: 'attrA', label: '生命 (attrA)' },
      { value: 'attrB', label: '能量 (attrB)' },
      { value: 'dim1', label: '六维 dim1' },
      { value: 'dim2', label: '六维 dim2' },
      { value: 'dim3', label: '六维 dim3' },
      { value: 'dim4', label: '六维 dim4' },
      { value: 'dim5', label: '六维 dim5' },
      { value: 'dim6', label: '六维 dim6' },
    ];
    // 从 worldDef 补充特殊属性
    for (const mod of worldDef.modules) {
      if (mod.moduleId === 'stat' && mod.enabled && mod.moduleConfig) {
        const special = mod.moduleConfig.special as Array<{ id: string; name: string }> | undefined;
        if (special) {
          for (const s of special) {
            base.push({ value: s.id, label: `${s.name} (${s.id})` });
          }
        }
      }
    }
    return base;
  }, [gameState, worldDef]);

  const options = worldOptions ?? getStatOptionsFromState(gameState);
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
        placeholder="属性键,如 attrA / dim1"
        onChange={(e) => onChange(e.target.value)}
        style={selectStyle}
      />
    );
  }

  return (
    <select
      value={known ? (value ?? '') : ''}
      onChange={(e) => {
        if (e.target.value === CUSTOM_STAT_SENTINEL) {
          setForceCustom(true);
          onChange('');
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
