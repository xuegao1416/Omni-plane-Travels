import { useEffect, useState } from 'react';
import type { GameplayComparator, GameplayCondition, GameplayCost, GameplayEffect, GameplayLiteral, GameplayValue } from '../../../gameplay/types';
import { inputStyle } from './shared';

const comparators: GameplayComparator[] = ['==', '!=', '>', '>=', '<', '<=', 'in', 'contains'];

function literal(value: string): GameplayLiteral {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  const number = Number(trimmed);
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) return parsed;
    } catch {
      // An unfinished array remains plain text until it becomes valid JSON.
    }
  }
  return trimmed !== '' && Number.isFinite(number) ? number : value;
}

function literalText(value: GameplayLiteral): string {
  return Array.isArray(value) ? JSON.stringify(value) : String(value);
}

function isGameplayValue(value: unknown): value is GameplayValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isGameplayValue);
  return typeof value === 'object' && Object.values(value as Record<string, unknown>).every(isGameplayValue);
}

function gameplayValue(value: string): GameplayValue {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed);
    if (isGameplayValue(parsed)) return parsed;
  } catch {
    // Plain text is a valid gameplay value.
  }
  return value;
}

function gameplayValueText(value: GameplayValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function JsonInput<T>({ value, onChange, placeholder }: { value: T | undefined; onChange: (value: T | undefined) => void; placeholder: string }) {
  const serialized = value === undefined ? '' : JSON.stringify(value);
  const [draft, setDraft] = useState(serialized);
  useEffect(() => setDraft(serialized), [serialized]);
  const commit = () => {
    if (!draft.trim()) {
      onChange(undefined);
      return;
    }
    try {
      onChange(JSON.parse(draft) as T);
    } catch {
      setDraft(serialized);
    }
  };
  return <textarea style={{ ...inputStyle, resize: 'vertical' }} rows={1} value={draft} placeholder={placeholder} onChange={event => setDraft(event.target.value)} onBlur={commit} />;
}

type ConditionKind = 'state' | 'event' | 'all' | 'any' | 'not';

function conditionKind(condition: GameplayCondition): ConditionKind {
  if ('state' in condition) return 'state';
  if ('event' in condition) return 'event';
  if ('all' in condition) return 'all';
  if ('any' in condition) return 'any';
  return 'not';
}

function createCondition(kind: ConditionKind): GameplayCondition {
  if (kind === 'event') return { event: { type: '' } };
  if (kind === 'all') return { all: [] };
  if (kind === 'any') return { any: [] };
  if (kind === 'not') return { not: { state: { path: '', op: '==', value: '' } } };
  return { state: { path: '', op: '==', value: '' } };
}

export function ConditionListEditor({ value = [], onChange }: { value?: GameplayCondition[]; onChange: (value: GameplayCondition[]) => void }) {
  const update = (index: number, condition: GameplayCondition) => onChange(value.map((item, i) => i === index ? condition : item));
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    {value.map((condition, index) => {
      const kind = conditionKind(condition);
      return <div key={index} style={{ display: 'grid', gridTemplateColumns: '88px minmax(0, 1fr) auto', gap: 4, alignItems: 'start' }}>
        <select style={inputStyle} value={kind} onChange={event => update(index, createCondition(event.target.value as ConditionKind))}>
          <option value="state">状态</option><option value="event">事件</option><option value="all">全部满足</option><option value="any">任一满足</option><option value="not">不满足</option>
        </select>
        {'state' in condition ? <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 1fr', gap: 4 }}>
          <input style={inputStyle} value={condition.state.path} placeholder="状态路径" onChange={event => update(index, { state: { ...condition.state, path: event.target.value } })} />
          <select style={inputStyle} value={condition.state.op} onChange={event => update(index, { state: { ...condition.state, op: event.target.value as GameplayComparator } })}>{comparators.map(op => <option key={op}>{op}</option>)}</select>
          <input style={inputStyle} value={literalText(condition.state.value)} placeholder="值或字符串数组 JSON" onChange={event => update(index, { state: { ...condition.state, value: literal(event.target.value) } })} />
        </div> : 'event' in condition ? <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <input style={inputStyle} value={condition.event.type} placeholder="事件类型" onChange={event => update(index, { event: { ...condition.event, type: event.target.value } })} />
          <JsonInput<Record<string, GameplayLiteral>> value={condition.event.where} placeholder="事件字段约束 JSON（可选）" onChange={where => update(index, { event: { ...condition.event, where } })} />
        </div> : <JsonInput<GameplayCondition> value={condition} placeholder="组合条件 JSON" onChange={next => { if (next) update(index, next); }} />}
        <button type="button" className="btn-ghost" onClick={() => onChange(value.filter((_, i) => i !== index))} style={{ color: 'var(--danger)', padding: '2px 5px' }}>✕</button>
      </div>;
    })}
    <button type="button" className="btn-ghost" onClick={() => onChange([...value, createCondition('state')])} style={{ alignSelf: 'flex-start', padding: '2px 8px' }}>+ 条件</button>
  </div>;
}

export function CostListEditor({ value = [], onChange }: { value?: GameplayCost[]; onChange: (value: GameplayCost[]) => void }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    {value.map((cost, index) => <div key={index} style={{ display: 'grid', gridTemplateColumns: 'minmax(80px,.75fr) 1fr 80px 1fr auto', gap: 4 }}>
      <input style={inputStyle} value={cost.id ?? ''} placeholder="消耗 ID（可选）" onChange={event => onChange(value.map((item, i) => i === index ? { ...item, id: event.target.value || undefined } : item))} />
      <input style={inputStyle} value={cost.path} placeholder="消耗路径" onChange={e => onChange(value.map((item, i) => i === index ? { ...item, path: e.target.value } : item))} />
      <input style={inputStyle} type="number" value={cost.amount} onChange={e => onChange(value.map((item, i) => i === index ? { ...item, amount: Number(e.target.value) || 0 } : item))} />
      <input style={inputStyle} value={cost.label || ''} placeholder="显示名称（可选）" onChange={e => onChange(value.map((item, i) => i === index ? { ...item, label: e.target.value || undefined } : item))} />
      <button type="button" className="btn-ghost" onClick={() => onChange(value.filter((_, i) => i !== index))} style={{ color: 'var(--danger)', padding: '2px 5px' }}>✕</button>
    </div>)}
    <button type="button" className="btn-ghost" onClick={() => onChange([...value, { path: '', amount: 1 }])} style={{ alignSelf: 'flex-start', padding: '2px 8px' }}>+ 消耗</button>
  </div>;
}

type EffectKind = 'set' | 'add' | 'append' | 'remove' | 'emit' | 'schedule';

function effectKind(effect: GameplayEffect): EffectKind {
  if ('set' in effect) return 'set';
  if ('add' in effect) return 'add';
  if ('append' in effect) return 'append';
  if ('remove' in effect) return 'remove';
  if ('emit' in effect) return 'emit';
  return 'schedule';
}

function createEffect(kind: EffectKind): GameplayEffect {
  if (kind === 'set') return { set: { path: '', value: '' } };
  if (kind === 'append') return { append: { path: '', value: '' } };
  if (kind === 'remove') return { remove: { path: '' } };
  if (kind === 'emit') return { emit: { type: '' } };
  if (kind === 'schedule') return { schedule: { after: 1, event: { type: '' } } };
  return { add: { path: '', delta: 1 } };
}

function tagsText(tags: string[] | undefined): string {
  return tags?.join(', ') ?? '';
}

function parseTags(value: string): string[] | undefined {
  const tags = [...new Set(value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean))];
  return tags.length > 0 ? tags : undefined;
}

export function EffectListEditor({ value = [], onChange }: { value?: GameplayEffect[]; onChange: (value: GameplayEffect[]) => void }) {
  const replace = (index: number, next: GameplayEffect) => onChange(value.map((item, i) => i === index ? next : item));
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    {value.map((effect, index) => <div key={index} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 5, border: '1px solid var(--border)', borderRadius: 4 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr auto', gap: 4, alignItems: 'center' }}>
        <select style={inputStyle} value={effectKind(effect)} onChange={event => replace(index, createEffect(event.target.value as EffectKind))}>
          <option value="add">增加</option><option value="set">设置</option><option value="append">追加</option><option value="remove">删除</option><option value="emit">发事件</option><option value="schedule">延迟事件</option>
        </select>
        <small style={{ color: 'var(--text-muted)' }}>声明式效果</small>
        <button type="button" className="btn-ghost" onClick={() => onChange(value.filter((_, i) => i !== index))} style={{ color: 'var(--danger)', padding: '2px 5px' }}>✕</button>
      </div>

      {'set' in effect && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        <input style={inputStyle} value={effect.set.path} placeholder="效果路径" onChange={event => replace(index, { set: { ...effect.set, path: event.target.value } })} />
        <input style={inputStyle} value={gameplayValueText(effect.set.value)} placeholder="值或 JSON" onChange={event => replace(index, { set: { ...effect.set, value: gameplayValue(event.target.value) } })} />
      </div>}

      {'add' in effect && <div style={{ display: 'grid', gridTemplateColumns: '1fr repeat(3, 82px) auto', gap: 4, alignItems: 'center' }}>
        <input style={inputStyle} value={effect.add.path} placeholder="效果路径" onChange={event => replace(index, { add: { ...effect.add, path: event.target.value } })} />
        <input style={inputStyle} type="number" value={effect.add.delta} placeholder="增量" onChange={event => replace(index, { add: { ...effect.add, delta: Number(event.target.value) || 0 } })} />
        <input style={inputStyle} type="number" value={effect.add.min ?? ''} placeholder="最小" onChange={event => replace(index, { add: { ...effect.add, min: event.target.value === '' ? undefined : Number(event.target.value) } })} />
        <input style={inputStyle} type="number" value={effect.add.max ?? ''} placeholder="最大" onChange={event => replace(index, { add: { ...effect.add, max: event.target.value === '' ? undefined : Number(event.target.value) } })} />
        <label style={{ whiteSpace: 'nowrap' }}><input type="checkbox" checked={Boolean(effect.add.create)} onChange={event => replace(index, { add: { ...effect.add, create: event.target.checked || undefined } })} />缺失时创建</label>
      </div>}

      {'append' in effect && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px auto', gap: 4, alignItems: 'center' }}>
        <input style={inputStyle} value={effect.append.path} placeholder="数组路径" onChange={event => replace(index, { append: { ...effect.append, path: event.target.value } })} />
        <input style={inputStyle} value={gameplayValueText(effect.append.value)} placeholder="追加值或 JSON" onChange={event => replace(index, { append: { ...effect.append, value: gameplayValue(event.target.value) } })} />
        <input style={inputStyle} type="number" min={1} value={effect.append.limit ?? ''} placeholder="数组上限" onChange={event => replace(index, { append: { ...effect.append, limit: event.target.value === '' ? undefined : Math.max(1, Number(event.target.value) || 1) } })} />
        <label style={{ whiteSpace: 'nowrap' }}><input type="checkbox" checked={Boolean(effect.append.create)} onChange={event => replace(index, { append: { ...effect.append, create: event.target.checked || undefined } })} />缺失时创建</label>
      </div>}

      {'remove' in effect && <input style={inputStyle} value={effect.remove.path} placeholder="删除路径" onChange={event => replace(index, { remove: { path: event.target.value } })} />}

      {'emit' in effect && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        <input style={inputStyle} value={effect.emit.type} placeholder="事件类型" onChange={event => replace(index, { emit: { ...effect.emit, type: event.target.value } })} />
        <input style={inputStyle} value={tagsText(effect.emit.tags)} placeholder="标签，逗号分隔" onChange={event => replace(index, { emit: { ...effect.emit, tags: parseTags(event.target.value) } })} />
        <div style={{ gridColumn: '1 / -1' }}><JsonInput<Record<string, GameplayValue>> value={effect.emit.payload} placeholder="事件载荷 JSON（可选）" onChange={payload => replace(index, { emit: { ...effect.emit, payload } })} /></div>
      </div>}

      {'schedule' in effect && <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr', gap: 4 }}>
        <input style={inputStyle} type="number" min={0} value={effect.schedule.after} placeholder="延迟 tick" onChange={event => replace(index, { schedule: { ...effect.schedule, after: Math.max(0, Number(event.target.value) || 0) } })} />
        <input style={inputStyle} value={effect.schedule.event.type} placeholder="事件类型" onChange={event => replace(index, { schedule: { ...effect.schedule, event: { ...effect.schedule.event, type: event.target.value } } })} />
        <input style={inputStyle} value={tagsText(effect.schedule.event.tags)} placeholder="标签，逗号分隔" onChange={event => replace(index, { schedule: { ...effect.schedule, event: { ...effect.schedule.event, tags: parseTags(event.target.value) } } })} />
        <div style={{ gridColumn: '1 / -1' }}><JsonInput<Record<string, GameplayValue>> value={effect.schedule.event.payload} placeholder="延迟事件载荷 JSON（可选）" onChange={payload => replace(index, { schedule: { ...effect.schedule, event: { ...effect.schedule.event, payload } } })} /></div>
      </div>}
    </div>)}
    <button type="button" className="btn-ghost" onClick={() => onChange([...value, createEffect('add')])} style={{ alignSelf: 'flex-start', padding: '2px 8px' }}>+ 效果</button>
  </div>;
}

export function KeyValueListEditor({ value = {}, onChange, keyPlaceholder = '键', valuePlaceholder = '数值' }: { value?: Record<string, number>; onChange: (value: Record<string, number>) => void; keyPlaceholder?: string; valuePlaceholder?: string }) {
  const entries = Object.entries(value);
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    {entries.map(([key, amount], index) => <div key={`${key}-${index}`} style={{ display: 'grid', gridTemplateColumns: '1fr 90px auto', gap: 4 }}>
      <input style={inputStyle} value={key} placeholder={keyPlaceholder} onChange={e => { const next = { ...value }; delete next[key]; next[e.target.value] = amount; onChange(next); }} />
      <input style={inputStyle} type="number" value={amount} placeholder={valuePlaceholder} onChange={e => onChange({ ...value, [key]: Number(e.target.value) || 0 })} />
      <button type="button" className="btn-ghost" onClick={() => { const next = { ...value }; delete next[key]; onChange(next); }} style={{ color: 'var(--danger)', padding: '2px 5px' }}>✕</button>
    </div>)}
    <button type="button" className="btn-ghost" onClick={() => onChange({ ...value, [`key_${entries.length + 1}`]: 1 })} style={{ alignSelf: 'flex-start', padding: '2px 8px' }}>+ 键值</button>
  </div>;
}
