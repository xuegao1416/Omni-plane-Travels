// When 条件编辑器 —— condition 节点的 when 字段编辑。
// 支持多条件列表 + AND/OR 组合，每个条件 = 路径 + 操作符 + 值。
import React, { useCallback, useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import type { Condition, Comparator, Literal } from '../../modules/schema';
import type { WorldDef } from '../../data/worlds-schema';
import WhenPathSelect from './WhenPathSelect';
import ComparatorSelect from './ComparatorSelect';

interface Props {
  when?: Condition;
  onChange: (when: Condition | undefined) => void;
  worldDef?: WorldDef;
}

interface StateCondition {
  path: string;
  op: Comparator;
  value: Literal;
}

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  minHeight: 32,
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  fontSize: 'var(--font-size-sm)',
  fontFamily: 'var(--font-body)',
  flex: 1,
  minWidth: 0,
  boxSizing: 'border-box',
};

const fieldLabel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 'var(--font-size-xs)',
  color: 'var(--text-secondary)',
};

/** 从 Condition 树中提取所有 state 叶子条件 */
function extractStateConditions(cond?: Condition): { conditions: StateCondition[]; logicMode: 'and' | 'or' } {
  if (!cond) return { conditions: [], logicMode: 'and' };

  if ('state' in cond) {
    return { conditions: [{ path: cond.state.path, op: cond.state.op, value: cond.state.value }], logicMode: 'and' };
  }

  if ('all' in cond) {
    const conditions: StateCondition[] = [];
    for (const child of cond.all) {
      if ('state' in child) {
        conditions.push({ path: child.state.path, op: child.state.op, value: child.state.value });
      }
    }
    return { conditions, logicMode: 'and' };
  }

  if ('any' in cond) {
    const conditions: StateCondition[] = [];
    for (const child of cond.any) {
      if ('state' in child) {
        conditions.push({ path: child.state.path, op: child.state.op, value: child.state.value });
      }
    }
    return { conditions, logicMode: 'or' };
  }

  // not / event / 复杂嵌套 → 不可编辑，返回空
  return { conditions: [], logicMode: 'and' };
}

/** 把条件列表 + 逻辑模式 重建为 Condition */
function buildCondition(conditions: StateCondition[], logicMode: 'and' | 'or'): Condition | undefined {
  if (conditions.length === 0) return undefined;

  const stateConditions: Condition[] = conditions.map((c) => ({
    state: { path: c.path, op: c.op, value: c.value },
  }));

  if (stateConditions.length === 1) return stateConditions[0];
  return logicMode === 'or' ? { any: stateConditions } : { all: stateConditions };
}

/** 推断值的合理输入类型 */
function inferInputType(path: string, op: Comparator): 'number' | 'boolean' | 'text' {
  if (op === 'in') return 'text'; // in 操作符用逗号分隔列表
  // flags 路径通常是布尔
  if (path.startsWith('flags.')) return 'boolean';
  // 数值路径
  if (path.includes('amount') || path.includes('level') || path.includes('funds') ||
      path.startsWith('attr') || path.startsWith('dim')) return 'number';
  return 'text';
}

/** 把 Literal 转为字符串显示 */
function literalToString(v: Literal): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.join(',');
  return String(v);
}

/** 把字符串解析回 Literal */
function parseLiteral(s: string, type: 'number' | 'boolean' | 'text'): Literal {
  if (type === 'boolean') return s === 'true';
  if (type === 'number') {
    const n = Number(s);
    return isNaN(n) ? 0 : n;
  }
  // in 操作符：逗号分隔 → string[]
  if (s.includes(',')) return s.split(',').map((x) => x.trim()).filter(Boolean);
  return s;
}

export default function WhenConditionEditor({ when, onChange, worldDef }: Props) {
  const { conditions: initialConditions, logicMode: initialMode } = useMemo(
    () => extractStateConditions(when),
    [when],
  );

  const [conditions, setConditions] = React.useState<StateCondition[]>(initialConditions);
  const [logicMode, setLogicMode] = React.useState<'and' | 'or'>(initialMode);

  // 同步外部 when 变化（只在 when 从外部被重置时）
  React.useEffect(() => {
    const { conditions: ext, logicMode: extMode } = extractStateConditions(when);
    // 只在外部 when 完全不同时同步（避免循环）
    const extKey = JSON.stringify(ext);
    const curKey = JSON.stringify(conditions);
    if (extKey !== curKey) {
      setConditions(ext);
      setLogicMode(extMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [when]);

  const emitChange = useCallback(
    (next: StateCondition[], mode: 'and' | 'or') => {
      const cond = buildCondition(next, mode);
      onChange(cond);
    },
    [onChange],
  );

  const addCondition = () => {
    const next = [...conditions, { path: '', op: '==' as Comparator, value: 0 }];
    setConditions(next);
    emitChange(next, logicMode);
  };

  const removeCondition = (index: number) => {
    const next = conditions.filter((_, i) => i !== index);
    setConditions(next);
    emitChange(next, logicMode);
  };

  const updateCondition = (index: number, patch: Partial<StateCondition>) => {
    const next = conditions.map((c, i) => (i === index ? { ...c, ...patch } : c));
    setConditions(next);
    emitChange(next, logicMode);
  };

  const changeLogicMode = (mode: 'and' | 'or') => {
    setLogicMode(mode);
    emitChange(conditions, mode);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', fontWeight: 600 }}>
          When 条件
        </span>
        {conditions.length > 1 && (
          <select
            value={logicMode}
            onChange={(e) => changeLogicMode(e.target.value as 'and' | 'or')}
            style={{ ...inputStyle, width: 'auto', minHeight: 28, padding: '2px 6px', fontSize: 'var(--font-size-xs)' }}
          >
            <option value="and">AND（全部满足）</option>
            <option value="or">OR（任一满足）</option>
          </select>
        )}
      </div>

      {conditions.map((c, i) => {
        const inputType = inferInputType(c.path, c.op);
        return (
          <div
            key={i}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              background: 'var(--bg-primary)',
            }}
          >
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', minWidth: 16 }}>
                {i + 1}.
              </span>
              <div style={{ flex: 1 }}>
                <WhenPathSelect
                  value={c.path}
                  onChange={(v) => updateCondition(i, { path: v })}
                  worldDef={worldDef}
                />
              </div>
              <button
                className="btn-ghost btn-sm"
                onClick={() => removeCondition(i)}
                aria-label="删除条件"
                style={{ color: 'var(--danger)', padding: 4, flexShrink: 0 }}
              >
                <X size={14} />
              </button>
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', minWidth: 16 }} />
              <ComparatorSelect
                value={c.op}
                onChange={(v) => updateCondition(i, { op: v })}
              />
              {inputType === 'boolean' ? (
                <select
                  value={String(c.value)}
                  onChange={(e) => updateCondition(i, { value: e.target.value === 'true' })}
                  style={inputStyle}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  type={inputType === 'number' ? 'number' : 'text'}
                  value={literalToString(c.value)}
                  onChange={(e) => updateCondition(i, { value: parseLiteral(e.target.value, inputType) })}
                  placeholder={c.op === 'in' ? '值1,值2,值3' : '值'}
                  style={inputStyle}
                />
              )}
            </div>
          </div>
        );
      })}

      <button
        className="btn-ghost btn-xs"
        onClick={addCondition}
        style={{ alignSelf: 'flex-start' }}
      >
        <Plus size={12} /> 添加条件
      </button>

      {conditions.length === 0 && (
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          无条件（始终通过）
        </div>
      )}
    </div>
  );
}
