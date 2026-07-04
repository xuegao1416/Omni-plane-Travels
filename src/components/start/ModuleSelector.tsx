// ============================================================
//  模块选择器 — 第一步勾选模块的UI
//  用于世界创建时选择要启用的系统模块
// ============================================================

import { useMemo } from 'react';
import {
  BarChart3, TrendingUp, Leaf, Briefcase, Dice6, Star,
  type LucideIcon,
} from 'lucide-react';

/** 模块定义（框架层零指向性） — 唯一模块定义源 */
export interface ModuleOption {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  /** 是否为必选模块 */
  required?: boolean;
  /** 是否禁用（开发中） */
  disabled?: boolean;
  /** AI生成时的指令片段 */
  aiInstruction?: string;
}

/** 可选模块列表 */
export const MODULE_OPTIONS: ModuleOption[] = [
  {
    id: 'stat',
    name: '数值属性',
    description: '生命/能量 + 可选六维 + 可选特色属性',
    icon: BarChart3,
  },
  {
    id: 'progression',
    name: '成长体系',
    description: '段位制或等级制，角色成长进阶机制',
    icon: TrendingUp,
  },
  {
    id: 'survival',
    name: '生存资源',
    description: '荒岛求生/末日生存类，资源采集、制作、消耗（与数值属性/成长/天赋互斥）',
    icon: Leaf,
  },
  {
    id: 'business',
    name: '经营资产',
    description: '网吧/房东/商店模拟器类，资产、收支、利润',
    icon: Briefcase,
  },
  {
    id: 'dice',
    name: '骰子检定',
    description: 'd20+修正 vs DC，随机性判定机制',
    icon: Dice6,
  },
  {
    id: 'talent',
    name: '天赋体系',
    description: '天赋大类与具体天赋，角色固有特质与觉醒机制',
    icon: Star,
    aiInstruction: '生成天赋体系，包含天赋大类和具体天赋，品质分为普通/精良/稀有/史诗/传说五档，天赋效果为纯文本描述',
  },
];

interface ModuleSelectorProps {
  /** 当前选中的模块ID集合 */
  selected: Set<string>;
  /** 切换模块选中状态 */
  onToggle: (moduleId: string) => void;
  /** 是否紧凑模式（用于嵌入在其他组件中） */
  compact?: boolean;
  /** 因互斥而被禁用的模块ID集合 */
  disabledByConflict?: Set<string>;
}

/** 模块依赖关系：选了 key 模块时，value 模块会被自动启用 */
const MODULE_DEPENDENCIES: Record<string, string[]> = {
  'progression': ['stat'],  // 成长体系依赖数值属性
};

export default function ModuleSelector({ selected, onToggle, compact, disabledByConflict }: ModuleSelectorProps) {
  // 计算被依赖自动启用的模块集合
  const autoEnabledByDependency = useMemo(() => {
    const autoEnabled = new Set<string>();
    for (const [source, deps] of Object.entries(MODULE_DEPENDENCIES)) {
      if (selected.has(source)) {
        deps.forEach(dep => autoEnabled.add(dep));
      }
    }
    return autoEnabled;
  }, [selected]);

  return (
    <div style={{ marginTop: compact ? 8 : 12 }}>
      {!compact && (
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: 8 }}>
          选择要启用的系统模块（均可选）：
        </div>
      )}
      <div style={{
        display: 'grid',
        gridTemplateColumns: compact ? '1fr' : 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 8,
      }}>
        {MODULE_OPTIONS.map(mod => {
          const active = selected.has(mod.id) || autoEnabledByDependency.has(mod.id);
          const isAutoEnabled = autoEnabledByDependency.has(mod.id);
          const Icon = mod.icon;
          const disabled = mod.disabled || (disabledByConflict?.has(mod.id) ?? false);
          return (
            <label
              key={mod.id}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '8px 12px', borderRadius: 8,
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                background: active ? 'var(--accent-dim)' : 'transparent',
                cursor: disabled || isAutoEnabled ? 'not-allowed' : mod.required ? 'default' : 'pointer',
                opacity: disabled ? 0.4 : mod.required ? 0.8 : 1,
                transition: 'all 0.15s',
              }}
            >
              <input
                type="checkbox"
                checked={active}
                disabled={mod.required || disabled || isAutoEnabled}
                onChange={() => !mod.required && !disabled && !isAutoEnabled && onToggle(mod.id)}
                style={{ display: 'none' }}
              />
              <Icon
                size={18}
                style={{
                  flexShrink: 0, marginTop: 1,
                  color: active ? 'var(--accent)' : disabled ? 'var(--text-muted)' : 'var(--text-muted)',
                }}
              />
              <div>
                <div style={{
                  fontSize: 'var(--font-size-sm)', fontWeight: 600,
                  color: active ? 'var(--accent)' : disabled ? 'var(--text-muted)' : 'var(--text-primary)',
                }}>
                  {mod.name}
                  {mod.disabled && (
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginLeft: 4 }}>
                      开发中
                    </span>
                  )}
                  {!mod.disabled && disabledByConflict?.has(mod.id) && (
                    <span style={{ fontSize: 'var(--font-size-xs)', color: '#f59e0b', marginLeft: 4 }}>
                      互斥
                    </span>
                  )}
                  {isAutoEnabled && (
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--accent)', marginLeft: 4 }}>
                      自动启用
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                  {mod.description}
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/** 获取默认选中的模块集合（默认不选任何模块） */
export function getDefaultSelectedModules(): Set<string> {
  return new Set();
}
