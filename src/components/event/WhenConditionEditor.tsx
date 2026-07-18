// When 条件编辑器 —— condition 节点的 when 字段编辑。
// 支持 state 条件（路径+操作符+值）和 event 条件（事件类型+可选 where）。
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
  /** 当前图中已使用的事件类型（用于下拉建议） */
  knownEventTypes?: string[];
}

interface StateCondition {
  kind: 'state';
  path: string;
  op: Comparator;
  value: Literal;
}

interface EventCondition {
  kind: 'event';
  type: string;
}

type ConditionItem = StateCondition | EventCondition;

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

/** 从 Condition 树中提取所有可编辑的叶子条件 */
function extractConditions(cond?: Condition): { items: ConditionItem[]; logicMode: 'and' | 'or' } {
  if (!cond) return { items: [], logicMode: 'and' };

  if ('state' in cond) {
    return { items: [{ kind: 'state', path: cond.state.path, op: cond.state.op, value: cond.state.value }], logicMode: 'and' };
  }

  if ('event' in cond) {
    return { items: [{ kind: 'event', type: cond.event.type }], logicMode: 'and' };
  }

  if ('all' in cond) {
    const items: ConditionItem[] = [];
    for (const child of cond.all) {
      if ('state' in child) items.push({ kind: 'state', path: child.state.path, op: child.state.op, value: child.state.value });
      else if ('event' in child) items.push({ kind: 'event', type: child.event.type });
    }
    return { items, logicMode: 'and' };
  }

  if ('any' in cond) {
    const items: ConditionItem[] = [];
    for (const child of cond.any) {
      if ('state' in child) items.push({ kind: 'state', path: child.state.path, op: child.state.op, value: child.state.value });
      else if ('event' in child) items.push({ kind: 'event', type: child.event.type });
    }
    return { items, logicMode: 'or' };
  }

  // not / 复杂嵌套 → 不可编辑，返回空
  return { items: [], logicMode: 'and' };
}

/** 把条件列表 + 逻辑模式 重建为 Condition */
function buildCondition(items: ConditionItem[], logicMode: 'and' | 'or'): Condition | undefined {
  if (items.length === 0) return undefined;

  const conditions: Condition[] = items.map((item) => {
    if (item.kind === 'event') {
      return { event: { type: item.type } };
    }
    return { state: { path: item.path, op: item.op, value: item.value } };
  });

  if (conditions.length === 1) return conditions[0];
  return logicMode === 'or' ? { any: conditions } : { all: conditions };
}

/** 推断值的合理输入类型 */
function inferInputType(path: string, op: Comparator): 'number' | 'boolean' | 'text' {
  if (op === 'in') return 'text';
  if (path.startsWith('flags.')) return 'boolean';
  if (path.includes('amount') || path.includes('level') || path.includes('funds') ||
      path.startsWith('attr') || path.startsWith('dim')) return 'number';
  return 'text';
}

function literalToString(v: Literal): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.join(',');
  return String(v);
}

function parseLiteral(s: string, type: 'number' | 'boolean' | 'text'): Literal {
  if (type === 'boolean') return s === 'true';
  if (type === 'number') {
    const n = Number(s);
    return isNaN(n) ? 0 : n;
  }
  if (s.includes(',')) return s.split(',').map((x) => x.trim()).filter(Boolean);
  return s;
}

export default function WhenConditionEditor({ when, onChange, worldDef, knownEventTypes = [] }: Props) {
  const { items: initialItems, logicMode: initialMode } = useMemo(
    () => extractConditions(when),
    [when],
  );

  const [items, setItems] = React.useState<ConditionItem[]>(initialItems);
  const [logicMode, setLogicMode] = React.useState<'and' | 'or'>(initialMode);

  React.useEffect(() => {
    const { items: ext, logicMode: extMode } = extractConditions(when);
    const extKey = JSON.stringify(ext);
    const curKey = JSON.stringify(items);
    if (extKey !== curKey) {
      setItems(ext);
      setLogicMode(extMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [when]);

  const emitChange = useCallback(
    (next: ConditionItem[], mode: 'and' | 'or') => {
      const cond = buildCondition(next, mode);
      onChange(cond);
    },
    [onChange],
  );

  const addStateCondition = () => {
    const next = [...items, { kind: 'state' as const, path: '', op: '==' as Comparator, value: 0 }];
    setItems(next);
    emitChange(next, logicMode);
  };

  const addEventCondition = () => {
    const next = [...items, { kind: 'event' as const, type: '' }];
    setItems(next);
    emitChange(next, logicMode);
  };

  const removeCondition = (index: number) => {
    const next = items.filter((_, i) => i !== index);
    setItems(next);
    emitChange(next, logicMode);
  };

  const updateCondition = (index: number, patch: Partial<ConditionItem>) => {
    const next = items.map((c, i) => (i === index ? { ...c, ...patch } as ConditionItem : c));
    setItems(next);
    emitChange(next, logicMode);
  };

  const changeLogicMode = (mode: 'and' | 'or') => {
    setLogicMode(mode);
    emitChange(items, mode);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', fontWeight: 600 }}>
          When 条件
        </span>
        {items.length > 1 && (
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

      {items.map((item, i) => (
        <div
          key={i}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-2)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            background: item.kind === 'event' ? 'var(--bg-secondary)' : 'var(--bg-primary)',
          }}
        >
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', minWidth: 16 }}>
              {i + 1}.
            </span>
            {item.kind === 'event' ? (
              // 事件条件：事件类型输入
              <div style={{ flex: 1, display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  事件
                </span>
                {knownEventTypes.length > 0 ? (
                  <select
                    value={item.type}
                    onChange={(e) => updateCondition(i, { type: e.target.value })}
                    style={inputStyle}
                  >
                    <option value="">选择事件类型...</option>
                    {knownEventTypes.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                    <option value="__custom__">自定义...</option>
                  </select>
                ) : (
                  <input
                    value={item.type}
                    onChange={(e) => updateCondition(i, { type: e.target.value })}
                    placeholder="事件类型（如 dice_roll）"
                    style={inputStyle}
                  />
                )}
              </div>
            ) : (
              // 状态条件：路径选择
              <div style={{ flex: 1 }}>
                <WhenPathSelect
                  value={item.path}
                  onChange={(v) => updateCondition(i, { path: v })}
                  worldDef={worldDef}
                />
              </div>
            )}
            <button
              className="btn-ghost btn-sm"
              onClick={() => removeCondition(i)}
              aria-label="删除条件"
              style={{ color: 'var(--danger)', padding: 4, flexShrink: 0 }}
            >
              <X size={14} />
            </button>
          </div>
          {item.kind === 'state' && (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', minWidth: 16 }} />
              <ComparatorSelect
                value={item.op}
                onChange={(v) => updateCondition(i, { op: v })}
              />
              {inferInputType(item.path, item.op) === 'boolean' ? (
                <select
                  value={String(item.value)}
                  onChange={(e) => updateCondition(i, { value: e.target.value === 'true' })}
                  style={inputStyle}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  type={inferInputType(item.path, item.op) === 'number' ? 'number' : 'text'}
                  value={literalToString(item.value)}
                  onChange={(e) => updateCondition(i, { value: parseLiteral(e.target.value, inferInputType(item.path, item.op)) })}
                  placeholder={item.op === 'in' ? '值1,值2,值3' : '值'}
                  style={inputStyle}
                />
              )}
            </div>
          )}
        </div>
      ))}

      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button
          className="btn-ghost btn-xs"
          onClick={addStateCondition}
          style={{ alignSelf: 'flex-start' }}
        >
          <Plus size={12} /> 状态条件
        </button>
        <button
          className="btn-ghost btn-xs"
          onClick={addEventCondition}
          style={{ alignSelf: 'flex-start' }}
        >
          <Plus size={12} /> 事件条件
        </button>
      </div>

      {items.length === 0 && (
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          无条件（始终通过）
        </div>
      )}
    </div>
  );
}
