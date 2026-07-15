/**
 * 周期事件包编辑器 — 在「事件中心」中编辑世界内置事件包的周期事件。
 *
 * 与「世界动态配置」面板完全解耦：周期事件不再出现在世界动态里，
 * 而是作为事件包在事件中心管理（符合「事件包」独立成类的设计）。
 * 数据来源 = 运行时注册进 eventWorldEvolution 的 source:'world' 包。
 *
 * 同时被「事件包编辑器」(CardEditor) 的周期子标签复用：无世界上下文时，
 * 资源/属性名可自由填写（自定义世界包的资源/属性由创作者自行约定）。
 */

import { useState } from 'react';
import { Plus, Trash2, Edit3, ChevronDown, ChevronRight, Clock } from 'lucide-react';
import type {
  PeriodicRule, ModuleEffects,
} from '../../modules/schema';
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
      effects: {},
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

  const getEffectSummary = (effects: ModuleEffects): string => {
    const parts: string[] = [];
    if (effects.survival?.resources) {
      const count = Object.keys(effects.survival.resources).length;
      if (count > 0) parts.push(`资源×${count}`);
    }
    if (effects.stats?.changes) {
      const count = Object.keys(effects.stats.changes).length;
      if (count > 0) parts.push(`属性×${count}`);
    }
    if (effects.business?.fundsDelta) parts.push(`资金${effects.business.fundsDelta > 0 ? '+' : ''}${effects.business.fundsDelta}`);
    if (effects.progression?.xpDelta) parts.push(`经验+${effects.progression.xpDelta}`);
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
                  效果: {getEffectSummary(event.effects)}
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

// ── 周期事件编辑弹窗 ──
function PeriodicEventEditModal({
  event, worldDef, onSave, onCancel,
}: {
  event: PeriodicRule;
  worldDef: WorldDef | null | undefined;
  onSave: (e: PeriodicRule) => void;
  onCancel: () => void;
}) {
  const [data, setData] = useState<PeriodicRule>(JSON.parse(JSON.stringify(event)));
  // 无世界上下文（事件库编辑器）时，允许创作者自由填写资源/属性名
  const [customResources, setCustomResources] = useState<string[]>([]);
  const [customStats, setCustomStats] = useState<string[]>([]);
  const [newResName, setNewResName] = useState('');
  const [newStatName, setNewStatName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // 与事件效果编辑弹窗同源的「资源/属性联动」逻辑（事件效果弹窗已随 eventEffects 移除）
  const survivalMod = worldDef?.modules?.find(m => m.moduleId === 'survival' && m.enabled);
  const statMod = worldDef?.modules?.find(m => m.moduleId === 'stat' && m.enabled);
  const survivalConfig = survivalMod?.moduleConfig as any;
  const statConfig = statMod?.moduleConfig as any;

  const availableResources = Array.isArray(survivalConfig?.resources)
    ? survivalConfig.resources.map((r: any) => r.name || r.id)
    : [];

  const availableStats = [
    statConfig?.attrA?.name,
    statConfig?.attrB?.name,
  ].filter(Boolean) as string[];

  const effectiveResources = Array.from(new Set([...availableResources, ...customResources]));
  const effectiveStats = Array.from(new Set([...availableStats, ...customStats]));

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
    onSave(data);
  };

  const addResourceEffect = (defaultName?: string) => {
    const newEffects = { ...data.effects };
    if (!newEffects.survival) newEffects.survival = {};
    if (!newEffects.survival.resources) newEffects.survival.resources = {};
    const name = defaultName ?? availableResources[0] ?? '资源';
    newEffects.survival.resources[name] = { delta: 0 };
    setData({ ...data, effects: newEffects });
  };

  const addResourceEffectNamed = (name: string) => {
    const newEffects = { ...data.effects };
    if (!newEffects.survival) newEffects.survival = {};
    if (!newEffects.survival.resources) newEffects.survival.resources = {};
    newEffects.survival.resources[name] = { delta: 0 };
    setData({ ...data, effects: newEffects });
  };

  const updateResourceEffect = (resourceName: string, field: string, value: number) => {
    const newEffects = { ...data.effects };
    if (newEffects.survival?.resources?.[resourceName]) {
      newEffects.survival.resources[resourceName] = {
        ...newEffects.survival.resources[resourceName],
        [field]: value,
      };
      setData({ ...data, effects: newEffects });
    }
  };

  const removeResourceEffect = (resourceName: string) => {
    const newEffects = { ...data.effects };
    if (newEffects.survival?.resources) {
      delete newEffects.survival.resources[resourceName];
      setData({ ...data, effects: newEffects });
    }
  };

  const addStatEffect = (defaultName?: string) => {
    const newEffects = { ...data.effects };
    if (!newEffects.stats) newEffects.stats = {};
    if (!newEffects.stats.changes) newEffects.stats.changes = {};
    const name = defaultName ?? availableStats[0] ?? '属性';
    newEffects.stats.changes[name] = { delta: 0 };
    setData({ ...data, effects: newEffects });
  };

  const addStatEffectNamed = (name: string) => {
    const newEffects = { ...data.effects };
    if (!newEffects.stats) newEffects.stats = {};
    if (!newEffects.stats.changes) newEffects.stats.changes = {};
    newEffects.stats.changes[name] = { delta: 0 };
    setData({ ...data, effects: newEffects });
  };

  const updateStatEffect = (statName: string, field: string, value: number) => {
    const newEffects = { ...data.effects };
    if (newEffects.stats?.changes?.[statName]) {
      newEffects.stats.changes[statName] = {
        ...newEffects.stats.changes[statName],
        [field]: value,
      };
      setData({ ...data, effects: newEffects });
    }
  };

  const removeStatEffect = (statName: string) => {
    const newEffects = { ...data.effects };
    if (newEffects.stats?.changes) {
      delete newEffects.stats.changes[statName];
      setData({ ...data, effects: newEffects });
    }
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

        {/* 生存资源效果 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>生存资源效果</label>
            <button onClick={() => addResourceEffect()} className="btn-ghost btn-xs">
              <Plus size={12} />
            </button>
          </div>
          {Object.entries(data.effects.survival?.resources || {}).map(([name, config]) => (
            <div key={name} style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
              <select
                value={name}
                onChange={e => {
                  const newResources = { ...data.effects.survival?.resources };
                  delete newResources[name];
                  newResources[e.target.value] = config;
                  setData({
                    ...data,
                    effects: { ...data.effects, survival: { ...data.effects.survival, resources: newResources } },
                  });
                }}
                className="input-field"
                style={{ flex: 1 }}
              >
                {effectiveResources.map((r: string) => <option key={r} value={r}>{r}</option>)}
                {!effectiveResources.includes(name) && <option value={name}>{name}</option>}
              </select>
              <input
                type="number"
                value={config.delta ?? config.set ?? config.min ?? 0}
                onChange={e => updateResourceEffect(name, 'delta', parseInt(e.target.value) || 0)}
                className="input-field"
                style={{ width: '80px' }}
              />
              <button onClick={() => removeResourceEffect(name)} className="btn-ghost btn-xs" style={{ color: 'var(--danger)' }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {!worldDef && (
            <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
              <input
                className="input-field"
                value={newResName}
                onChange={(e) => setNewResName(e.target.value)}
                placeholder="自定义资源名（无世界时手动填写）"
                style={{ flex: 1 }}
              />
              <button
                className="btn-ghost btn-xs"
                onClick={() => {
                  const n = newResName.trim();
                  if (!n) return;
                  setCustomResources((p) => (p.includes(n) ? p : [...p, n]));
                  addResourceEffectNamed(n);
                  setNewResName('');
                }}
              >添加</button>
            </div>
          )}
        </div>

        {/* 数值属性效果 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>数值属性效果</label>
            <button onClick={() => addStatEffect()} className="btn-ghost btn-xs">
              <Plus size={12} />
            </button>
          </div>
          {Object.entries(data.effects.stats?.changes || {}).map(([name, config]) => (
            <div key={name} style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
              <select
                value={name}
                onChange={e => {
                  const newChanges = { ...data.effects.stats?.changes };
                  delete newChanges[name];
                  newChanges[e.target.value] = config;
                  setData({
                    ...data,
                    effects: { ...data.effects, stats: { ...data.effects.stats, changes: newChanges } },
                  });
                }}
                className="input-field"
                style={{ flex: 1 }}
              >
                {effectiveStats.map(s => <option key={s} value={s}>{s}</option>)}
                {!effectiveStats.includes(name) && <option value={name}>{name}</option>}
              </select>
              <input
                type="number"
                value={config.delta ?? config.set ?? config.min ?? 0}
                onChange={e => updateStatEffect(name, 'delta', parseInt(e.target.value) || 0)}
                className="input-field"
                style={{ width: '80px' }}
              />
              <button onClick={() => removeStatEffect(name)} className="btn-ghost btn-xs" style={{ color: 'var(--danger)' }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {!worldDef && (
            <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
              <input
                className="input-field"
                value={newStatName}
                onChange={(e) => setNewStatName(e.target.value)}
                placeholder="自定义属性名（无世界时手动填写）"
                style={{ flex: 1 }}
              />
              <button
                className="btn-ghost btn-xs"
                onClick={() => {
                  const n = newStatName.trim();
                  if (!n) return;
                  setCustomStats((p) => (p.includes(n) ? p : [...p, n]));
                  addStatEffectNamed(n);
                  setNewStatName('');
                }}
              >添加</button>
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
