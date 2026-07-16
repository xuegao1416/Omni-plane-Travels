// 路径下拉 —— 用于 When 条件编辑器和 set 动作，分组显示可选路径。
// 路径体系：引擎路径（attrA / resources.food.amount / flags.x）
// 数据来源：worldDef.modules 提供资源/属性列表；无 worldDef 时只显示固定键。
import React, { useMemo, useState, useEffect } from 'react';
import type { WorldDef } from '../../data/worlds-schema';

interface Props {
  value: string;
  onChange: (v: string) => void;
  worldDef?: WorldDef;
  /** 排除生存资源路径（set 动作用，逼用户用 modifyResource） */
  excludeResources?: boolean;
}

const CUSTOM_SENTINEL = '__CUSTOM_PATH__';

interface PathOption {
  value: string;
  label: string;
  group: string;
}

const selectStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  fontSize: 'var(--font-size-sm)',
  fontFamily: 'var(--font-body)',
  width: '100%',
  boxSizing: 'border-box',
};

/** 固定属性路径（所有世界通用） */
const FIXED_STAT_PATHS: PathOption[] = [
  { value: 'attrA', label: '生命 (attrA)', group: '属性' },
  { value: 'attrB', label: '能量 (attrB)', group: '属性' },
  { value: 'dim1', label: '六维 dim1', group: '属性' },
  { value: 'dim2', label: '六维 dim2', group: '属性' },
  { value: 'dim3', label: '六维 dim3', group: '属性' },
  { value: 'dim4', label: '六维 dim4', group: '属性' },
  { value: 'dim5', label: '六维 dim5', group: '属性' },
  { value: 'dim6', label: '六维 dim6', group: '属性' },
];

/** 通用路径（不依赖 worldDef） */
const COMMON_PATHS: PathOption[] = [
  { value: 'flags', label: '自定义标志 (flags.*)', group: '标志' },
];

/** 从 worldDef.modules 提取资源/经营/属性路径 */
function getWorldPaths(worldDef?: WorldDef): PathOption[] {
  if (!worldDef?.modules) return [];
  const paths: PathOption[] = [];
  for (const mod of worldDef.modules) {
    if (!mod.enabled) continue;
    // 生存资源
    if (mod.moduleId === 'survival' && mod.moduleConfig) {
      const resources = mod.moduleConfig.resources as Array<{ id: string; name: string }> | undefined;
      if (resources) {
        for (const r of resources) {
          paths.push({
            value: `resources.${r.id}.amount`,
            label: `${r.name} (${r.id})`,
            group: '生存资源',
          });
        }
      }
    }
    // 经营资产
    if (mod.moduleId === 'business' && mod.moduleConfig) {
      paths.push({ value: 'business.funds', label: '资金', group: '经营' });
      const assets = mod.moduleConfig.assets as Array<{ id: string; name: string }> | undefined;
      if (assets) {
        for (const a of assets) {
          paths.push({
            value: `business.assets.${a.id}.level`,
            label: `${a.name}等级`,
            group: '经营',
          });
        }
      }
    }
    // 自定义特殊属性
    if (mod.moduleId === 'stat' && mod.moduleConfig) {
      const special = mod.moduleConfig.special as Array<{ id: string; name: string }> | undefined;
      if (special) {
        for (const s of special) {
          paths.push({ value: s.id, label: `${s.name} (${s.id})`, group: '属性' });
        }
      }
    }
  }
  return paths;
}

export default function WhenPathSelect({ value, onChange, worldDef, excludeResources }: Props) {
  const options = useMemo(() => {
    const worldPaths = getWorldPaths(worldDef);
    const filtered = excludeResources ? worldPaths.filter(p => p.group !== '生存资源') : worldPaths;
    return [...FIXED_STAT_PATHS, ...filtered, ...COMMON_PATHS];
  }, [worldDef, excludeResources]);

  // 当前值是否在已知选项中
  const known = options.some((o) => o.value === value);

  // 用户是否主动点了"自定义"
  const [forceCustom, setForceCustom] = useState(false);

  // 当 options 变化后，如果当前值现在已知，自动退出自定义模式
  useEffect(() => {
    if (forceCustom && known) setForceCustom(false);
  }, [known, forceCustom]);

  // 是否显示自定义输入：用户主动选了自定义，且当前值不在已知选项中
  const showCustom = forceCustom && !known;

  if (showCustom) {
    return (
      <input
        value={value ?? ''}
        placeholder="引擎路径,如 flags.hasKey"
        onChange={(e) => onChange(e.target.value)}
        style={selectStyle}
      />
    );
  }

  // 按 group 分组
  const groups = new Map<string, PathOption[]>();
  for (const o of options) {
    if (!groups.has(o.group)) groups.set(o.group, []);
    groups.get(o.group)!.push(o);
  }

  return (
    <select
      value={known ? value : ''}
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
      <option value="">（选择路径）</option>
      {Array.from(groups.entries()).map(([group, opts]) => (
        <optgroup key={group} label={group}>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ))}
      <option value={CUSTOM_SENTINEL}>自定义路径…</option>
    </select>
  );
}
