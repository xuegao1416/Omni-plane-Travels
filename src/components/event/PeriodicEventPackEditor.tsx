/**
 * 周期事件包编辑器 — 在「事件中心」中编辑世界内置事件包的周期事件。
 *
 * 数据来源 = 运行时注册进 eventWorldEvolution 的 source:'world' 包。
 * 使用统一的 Action[] 效果系统（不再使用旧版 ModuleEffects）。
 */

import { useState } from 'react';
import { Plus, Trash2, Edit3, ChevronDown, ChevronRight, Clock } from 'lucide-react';
import type { PeriodicRule, Action, Literal } from '../../modules/schema';
import type { WorldDef } from '../../data/worlds-schema';

interface PeriodicEventPackEditorProps {
  periodicEvents: PeriodicRule[];
  onChange: (next: PeriodicRule[]) => void;
  worldDef?: WorldDef | null;
}

export default function PeriodicEventPackEditor({ periodicEvents, onChange, worldDef }: PeriodicEventPackEditorProps) {
  const [expanded, setExpanded] = useState(true);
  const [editingPeriodic, setEditingPeriodic] = useState<PeriodicRule | null>(null);

  const addPeriodicEvent = () => {
    const newPeriodic: PeriodicRule = {
      id: `periodic_${Date.now()}`,
      name: '新周期事件',
      description: '',
      intervalTicks: 30,
      actions: [],
      narrateToAI: true,
    };
    onChange([...periodicEvents, newPeriodic]);
    setEditingPeriodic(newPeriodic);
  };

  const updatePeriodicEvent = (index: number, updated: PeriodicRule) => {
    const next = [...periodicEvents];
    next[index] = updated;
    onChange(next);
    setEditingPeriodic(null);
  };

  const deletePeriodicEvent = (index: number) => {
    onChange(periodicEvents.filter((_, i) => i !== index));
  };

  const getActionSummary = (actions?: Action[]): string => {
    if (!actions || actions.length === 0) return '无效果';
    const parts: string[] = [];
    let modifyCount = 0;
    let setCount = 0;
    let addEventCount = 0;
    for (const a of actions) {
      if ('modifyResource' in a) modifyCount++;
      else if ('set' in a) setCount++;
      else if ('addEvent' in a) addEventCount++;
    }
    if (modifyCount > 0) parts.push(`资源×${modifyCount}`);
    if (setCount > 0) parts.push(`状态×${setCount}`);
    if (addEventCount > 0) parts.push(`事件×${addEventCount}`);
    return parts.join(', ') || '无效果';
  };

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          background: 'none', border: 'none', cursor: 'pointer',
          padding: 'var(--space-1) 0', width: '100%',
        }}
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
          周期事件
        </span>
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
          ({periodicEvents.length}个)
        </span>
      </button>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', paddingLeft: 'var(--space-6)' }}>
          {periodicEvents.map((event, index) => (
            <div
              key={event.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--font-size-xs)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <Clock size={14} /> {event.name}
                </div>
                <div style={{ color: 'var(--text-muted)' }}>
                  每 {event.intervalTicks} 轮触发
                  {event.offsetTicks ? `（偏移 ${event.offsetTicks}）` : ''}
                  {' | '}
                  效果: {getActionSummary(event.actions)}
                </div>
              </div>
              <button
                onClick={() => setEditingPeriodic(event)}
                className="btn-ghost btn-xs"
                style={{ padding: 'var(--space-1)' }}
              >
                <Edit3 size={12} />
              </button>
              <button
                onClick={() => deletePeriodicEvent(index)}
                className="btn-ghost btn-xs"
                style={{ padding: 'var(--space-1)', color: 'var(--danger)' }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button
            onClick={addPeriodicEvent}
            className="btn-ghost btn-sm"
            style={{ width: '100%' }}
          >
            <Plus size={14} style={{ marginRight: 'var(--space-1)' }} />
            添加周期事件
          </button>
        </div>
      )}

      {editingPeriodic && (
        <PeriodicEventEditModal
          event={editingPeriodic}
          worldDef={worldDef}
          onSave={updated => {
            const index = periodicEvents.findIndex(e => e.id === editingPeriodic.id);
            if (index >= 0) updatePeriodicEvent(index, updated);
            else { onChange([...periodicEvents, updated]); setEditingPeriodic(null); }
          }}
          onCancel={() => setEditingPeriodic(null)}
        />
      )}
    </div>
  );
}

// ── 周期事件编辑弹窗（统一 Action 系统） ──
function PeriodicEventEditModal({
  event, worldDef, onSave, onCancel,
}: {
  event: PeriodicRule;
  worldDef: WorldDef | null | undefined;
  onSave: (e: PeriodicRule) => void;
  onCancel: () => void;
}) {
  const [data, setData] = useState<PeriodicRule>(JSON.parse(JSON.stringify(event)));
  const [error, setError] = useState<string | null>(null);

  // 向后兼容：如果只有 effects 没有 actions，迁移 effects → actions
  const actions: Action[] = data.actions ?? [];

  const setActions = (next: Action[]) => setData({ ...data, actions: next });
  const addAction = () => setActions([...actions, { modifyResource: { key: '食物', delta: -1 } }]);
  const updateAction = (i: number, a: Action) => { const next = [...actions]; next[i] = a; setActions(next); };
  const removeAction = (i: number) => setActions(actions.filter((_, idx) => idx !== i));

  const handleSave = () => {
    if (!data.id.trim()) {
      setError('请输入事件 ID');
      return;
    }
    if (!data.name?.trim()) {
      setError('请输入事件名称');
      return;
    }
    setError(null);
    // 保存时清除旧版 effects 字段
    const { effects: _, ...clean } = data;
    onSave(clean as PeriodicRule);
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 60,
    }}>
      <div style={{
        background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)', maxWidth: 'min(500px, 92vw)', width: '90%', maxHeight: '80vh',
        overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
      }}>
        <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)', color: 'var(--text-primary)' }}>
          编辑周期事件
        </h3>

        {/* ID */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>事件 ID</label>
          <input
            value={data.id}
            onChange={e => setData({ ...data, id: e.target.value })}
            className="input-field"
            placeholder="如: zombie_horde"
          />
        </div>

        {/* 名称 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>事件名称</label>
          <input
            value={data.name}
            onChange={e => setData({ ...data, name: e.target.value })}
            className="input-field"
            placeholder="如: 僵尸潮"
          />
        </div>

        {/* 描述 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>事件描述</label>
          <textarea
            value={data.description}
            onChange={e => setData({ ...data, description: e.target.value })}
            className="input-field"
            placeholder="描述这个周期事件..."
            style={{ minHeight: '60px', resize: 'vertical' }}
          />
        </div>

        {/* 触发间隔 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>触发间隔（轮次）</label>
          <input
            type="number"
            value={data.intervalTicks}
            onChange={e => setData({ ...data, intervalTicks: parseInt(e.target.value) || 30 })}
            className="input-field"
          />
        </div>

        {/* 首次偏移 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>首次偏移（可选，避免所有周期事件同轮爆发）</label>
          <input
            type="number"
            value={data.offsetTicks ?? 0}
            onChange={e => setData({ ...data, offsetTicks: parseInt(e.target.value) || 0 })}
            className="input-field"
          />
        </div>

        {/* 是否喂给 AI 叙事 */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={data.narrateToAI ?? true}
            onChange={e => setData({ ...data, narrateToAI: e.target.checked })}
          />
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-primary)' }}>
            结算后喂给 AI 做叙事渲染
          </span>
        </label>

        {/* 动作列表（统一效果系统） */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>周期动作</label>
            <button onClick={addAction} className="btn-ghost btn-xs">
              <Plus size={12} />
            </button>
          </div>
          {actions.map((a, i) => (
            <SimpleActionRow key={i} action={a} onChange={(updated) => updateAction(i, updated)} onRemove={() => removeAction(i)} />
          ))}
          {actions.length === 0 && (
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--space-2)' }}>
              暂无动作，点击上方 + 添加
            </div>
          )}
        </div>

        {/* 校验错误提示 */}
        {error && (
          <div style={{ background: 'var(--danger-bg-soft)', color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
            {error}
          </div>
        )}

        {/* 按钮 */}
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} className="btn-ghost btn-sm">取消</button>
          <button onClick={handleSave} className="btn-primary btn-sm">保存</button>
        </div>
      </div>
    </div>
  );
}

// ── 简化版动作行（用于周期事件编辑弹窗） ──
function SimpleActionRow({ action, onChange, onRemove }: { action: Action; onChange: (a: Action) => void; onRemove: () => void }) {
  const kind = 'set' in action ? 'set'
    : 'addEvent' in action ? 'addEvent'
    : 'modifyResource' in action ? 'modifyResource'
    : 'scheduleTick';

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
      padding: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 4,
      background: 'var(--bg-primary)',
    }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select
          value={kind}
          onChange={e => {
            const k = e.target.value;
            if (k === 'modifyResource') onChange({ modifyResource: { key: 'food', delta: -1 } });
            else if (k === 'set') onChange({ set: { path: 'flags.x', value: true } });
            else if (k === 'addEvent') onChange({ addEvent: { eventId: 'new' } });
            else if (k === 'scheduleTick') onChange({ scheduleTick: { after: 1 } });
          }}
          style={{ fontSize: 'var(--font-size-xs)', padding: '2px 4px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}
        >
          <option value="modifyResource">资源变化</option>
          <option value="set">设置状态</option>
          <option value="addEvent">触发事件</option>
          <option value="scheduleTick">调度 tick</option>
        </select>
        <button onClick={onRemove} className="btn-ghost btn-xs" style={{ color: 'var(--danger)', padding: 2, marginLeft: 'auto' }}>
          <Trash2 size={12} />
        </button>
      </div>

      {/* modifyResource: key + delta */}
      {kind === 'modifyResource' && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            value={(action as { modifyResource: { key: string; delta: number } }).modifyResource.key}
            onChange={e => onChange({ modifyResource: { ...(action as { modifyResource: { key: string; delta: number } }).modifyResource, key: e.target.value } })}
            placeholder="资源名"
            style={{ flex: 1, fontSize: 'var(--font-size-xs)', padding: '2px 4px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
          />
          <input
            type="number"
            value={(action as { modifyResource: { key: string; delta: number } }).modifyResource.delta}
            onChange={e => onChange({ modifyResource: { ...(action as { modifyResource: { key: string; delta: number } }).modifyResource, delta: parseInt(e.target.value) || 0 } })}
            style={{ width: 60, fontSize: 'var(--font-size-xs)', padding: '2px 4px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
          />
        </div>
      )}

      {/* set: path + value */}
      {kind === 'set' && (() => {
        const a = action as { set: { path: string; value: Literal } };
        return (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              value={a.set.path}
              onChange={e => onChange({ set: { ...a.set, path: e.target.value } })}
              placeholder="路径 (如 stats.hp)"
              style={{ flex: 1, fontSize: 'var(--font-size-xs)', padding: '2px 4px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
            />
            <input
              value={String(a.set.value)}
              onChange={e => {
                const v = e.target.value;
                const num = Number(v);
                onChange({ set: { ...a.set, value: isNaN(num) ? v : num } });
              }}
              placeholder="值"
              style={{ width: 80, fontSize: 'var(--font-size-xs)', padding: '2px 4px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
            />
          </div>
        );
      })()}

      {/* addEvent: eventId */}
      {kind === 'addEvent' && (
        <input
          value={(action as { addEvent: { eventId: string } }).addEvent.eventId}
          onChange={e => onChange({ addEvent: { eventId: e.target.value } })}
          placeholder="事件 ID"
          style={{ fontSize: 'var(--font-size-xs)', padding: '2px 4px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
        />
      )}

      {/* scheduleTick: after */}
      {kind === 'scheduleTick' && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>延迟</span>
          <input
            type="number"
            value={(action as { scheduleTick: { after: number } }).scheduleTick.after}
            onChange={e => onChange({ scheduleTick: { after: parseInt(e.target.value) || 1 } })}
            style={{ width: 60, fontSize: 'var(--font-size-xs)', padding: '2px 4px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}
          />
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>轮次后触发</span>
        </div>
      )}
    </div>
  );
}
