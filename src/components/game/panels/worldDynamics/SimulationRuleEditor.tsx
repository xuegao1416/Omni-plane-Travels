/**
 * 演化规则编辑器 — 在 SimSettings 中显示
 * 管理事件效果、周期事件的查看和编辑
 */

import { useState } from 'react';
import { Plus, Trash2, Edit3, Copy, ClipboardPaste, ChevronDown, ChevronRight } from 'lucide-react';
import type {
  SimulationRules, EventEffect, PeriodicEvent, ModuleEffects,
} from '../../../../modules/schema';
import type { WorldDef } from '../../../../data/worlds-schema';

interface SimulationRuleEditorProps {
  rules: SimulationRules;
  onChange: (rules: SimulationRules) => void;
  worldDef: WorldDef | null;
}

export default function SimulationRuleEditor({ rules, onChange, worldDef }: SimulationRuleEditorProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['events']));
  const [editingEvent, setEditingEvent] = useState<EventEffect | null>(null);
  const [editingPeriodic, setEditingPeriodic] = useState<PeriodicEvent | null>(null);
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  // ── 事件效果操作 ──
  const addEventEffect = () => {
    const newEvent: EventEffect = {
      id: `event_${Date.now()}`,
      priority: 10,
      stackStrategy: 'add',
      trigger: { keywords: [] },
      effects: {},
    };
    onChange({ ...rules, eventEffects: [...rules.eventEffects, newEvent] });
    setEditingEvent(newEvent);
  };

  const updateEventEffect = (index: number, updated: EventEffect) => {
    const newEvents = [...rules.eventEffects];
    newEvents[index] = updated;
    onChange({ ...rules, eventEffects: newEvents });
    setEditingEvent(null);
  };

  const deleteEventEffect = (index: number) => {
    onChange({ ...rules, eventEffects: rules.eventEffects.filter((_, i) => i !== index) });
  };

  // ── 周期事件操作 ──
  const addPeriodicEvent = () => {
    const newPeriodic: PeriodicEvent = {
      id: `periodic_${Date.now()}`,
      name: '新周期事件',
      description: '',
      intervalTicks: 30,
      effects: {},
      narrateToAI: true,
    };
    onChange({ ...rules, periodicEvents: [...rules.periodicEvents, newPeriodic] });
    setEditingPeriodic(newPeriodic);
  };

  const updatePeriodicEvent = (index: number, updated: PeriodicEvent) => {
    const newPeriodic = [...rules.periodicEvents];
    newPeriodic[index] = updated;
    onChange({ ...rules, periodicEvents: newPeriodic });
    setEditingPeriodic(null);
  };

  const deletePeriodicEvent = (index: number) => {
    onChange({ ...rules, periodicEvents: rules.periodicEvents.filter((_, i) => i !== index) });
  };

  // ── 安全护栏操作 ──
  const updateGuardrails = (patch: Partial<SimulationRules['narrativeGuardrails']>) => {
    onChange({
      ...rules,
      narrativeGuardrails: { ...rules.narrativeGuardrails, ...patch },
    });
  };

  // ── 导入导出 ──
  const handleExport = async () => {
    const exportData = {
      version: 1,
      name: '自定义演化规则',
      description: '从游戏内导出的演化规则',
      rules,
    };
    const json = JSON.stringify(exportData, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      alert('规则已复制到剪贴板！');
    } catch {
      // 降级：创建临时文本框
      const textarea = document.createElement('textarea');
      textarea.value = json;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      alert('规则已复制到剪贴板！');
    }
  };

  const handleImport = () => {
    if (!importText.trim()) return;
    try {
      const parsed = JSON.parse(importText);
      if (parsed.rules && typeof parsed.rules === 'object') {
        onChange(parsed.rules);
        setImportText('');
        setShowImport(false);
        alert('规则导入成功！');
      } else {
        alert('导入失败：格式不正确，需要包含 rules 字段');
      }
    } catch {
      alert('导入失败：JSON 解析错误');
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setImportText(text);
    } catch {
      alert('无法读取剪贴板，请手动粘贴');
    }
  };

  // ── 辅助函数 ──
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* 导入导出按钮 */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button onClick={handleExport} className="btn-ghost btn-sm" style={{ flex: 1, minWidth: '120px' }}>
          <Copy size={14} style={{ marginRight: '4px' }} />
          导出规则
        </button>
        <button onClick={() => setShowImport(!showImport)} className="btn-ghost btn-sm" style={{ flex: 1, minWidth: '120px' }}>
          <ClipboardPaste size={14} style={{ marginRight: '4px' }} />
          导入规则
        </button>
      </div>

      {/* 导入面板 */}
      {showImport && (
        <div style={{
          padding: '12px',
          background: 'var(--bg-tertiary)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}>
          <textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            placeholder="粘贴规则 JSON..."
            className="input-field"
            style={{ minHeight: '100px', resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handlePasteFromClipboard} className="btn-ghost btn-sm">
              从剪贴板粘贴
            </button>
            <button onClick={handleImport} className="btn-primary btn-sm" style={{ flex: 1 }}>
              确认导入
            </button>
            <button onClick={() => { setShowImport(false); setImportText(''); }} className="btn-ghost btn-sm">
              取消
            </button>
          </div>
        </div>
      )}

      {/* ── 事件效果 ── */}
      <div>
        <button
          onClick={() => toggleSection('events')}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '4px 0', width: '100%',
          }}
        >
          {expandedSections.has('events') ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
            事件效果
          </span>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
            ({rules.eventEffects.length}个)
          </span>
        </button>

        {expandedSections.has('events') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: '22px' }}>
            {rules.eventEffects.map((event, index) => (
              <div
                key={event.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '8px 10px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--font-size-xs)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
                    🎯 {event.id}
                  </div>
                  <div style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    触发: {event.trigger.keywords?.join(', ') || event.trigger.tags?.join(', ') || '无'}
                    {' | '}
                    效果: {getEffectSummary(event.effects)}
                  </div>
                </div>
                <button
                  onClick={() => setEditingEvent(event)}
                  className="btn-ghost btn-xs"
                  style={{ padding: '4px' }}
                >
                  <Edit3 size={12} />
                </button>
                <button
                  onClick={() => deleteEventEffect(index)}
                  className="btn-ghost btn-xs"
                  style={{ padding: '4px', color: 'var(--danger)' }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button
              onClick={addEventEffect}
              className="btn-ghost btn-sm"
              style={{ width: '100%' }}
            >
              <Plus size={14} style={{ marginRight: '4px' }} />
              添加事件效果
            </button>
          </div>
        )}
      </div>

      {/* ── 周期事件 ── */}
      <div>
        <button
          onClick={() => toggleSection('periodic')}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '4px 0', width: '100%',
          }}
        >
          {expandedSections.has('periodic') ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
            周期事件
          </span>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
            ({rules.periodicEvents.length}个)
          </span>
        </button>

        {expandedSections.has('periodic') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: '22px' }}>
            {rules.periodicEvents.map((event, index) => (
              <div
                key={event.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '8px 10px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--font-size-xs)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
                    ⏰ {event.name}
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
                  style={{ padding: '4px' }}
                >
                  <Edit3 size={12} />
                </button>
                <button
                  onClick={() => deletePeriodicEvent(index)}
                  className="btn-ghost btn-xs"
                  style={{ padding: '4px', color: 'var(--danger)' }}
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
              <Plus size={14} style={{ marginRight: '4px' }} />
              添加周期事件
            </button>
          </div>
        )}
      </div>

      {/* ── 安全护栏 ── */}
      <div>
        <button
          onClick={() => toggleSection('guardrails')}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '4px 0', width: '100%',
          }}
        >
          {expandedSections.has('guardrails') ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
            安全护栏
          </span>
        </button>

        {expandedSections.has('guardrails') && (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: '8px',
            paddingLeft: '22px',
            fontSize: 'var(--font-size-xs)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--text-muted)', minWidth: '120px' }}>属性最大变动:</span>
              <input
                type="number"
                value={rules.narrativeGuardrails?.maxDeltaPerStat?.['*'] ?? 20}
                onChange={e => updateGuardrails({
                  maxDeltaPerStat: { ...(rules.narrativeGuardrails?.maxDeltaPerStat ?? {}), '*': parseInt(e.target.value) || 20 },
                })}
                className="input-field"
                style={{ width: '80px' }}
              />
              <span style={{ color: 'var(--text-muted)' }}>/ 次</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--text-muted)', minWidth: '120px' }}>资源最大变动:</span>
              <input
                type="number"
                value={rules.narrativeGuardrails?.maxDeltaPerResource?.['*'] ?? 10}
                onChange={e => updateGuardrails({
                  maxDeltaPerResource: { ...(rules.narrativeGuardrails?.maxDeltaPerResource ?? {}), '*': parseInt(e.target.value) || 10 },
                })}
                className="input-field"
                style={{ width: '80px' }}
              />
              <span style={{ color: 'var(--text-muted)' }}>/ 次</span>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={rules.narrativeGuardrails?.allowCreateResources ?? true}
                onChange={e => updateGuardrails({ allowCreateResources: e.target.checked })}
              />
              <span style={{ color: 'var(--text-primary)' }}>允许 AI 创建新资源</span>
            </label>
          </div>
        )}
      </div>

      {/* ── 编辑弹窗：事件效果 ── */}
      {editingEvent && (
        <EventEffectEditModal
          event={editingEvent}
          worldDef={worldDef}
          onSave={updated => {
            const index = rules.eventEffects.findIndex(e => e.id === editingEvent.id);
            if (index >= 0) updateEventEffect(index, updated);
          }}
          onCancel={() => setEditingEvent(null)}
        />
      )}

      {/* ── 编辑弹窗：周期事件 ── */}
      {editingPeriodic && (
        <PeriodicEventEditModal
          event={editingPeriodic}
          worldDef={worldDef}
          onSave={updated => {
            const index = rules.periodicEvents.findIndex(e => e.id === editingPeriodic.id);
            if (index >= 0) updatePeriodicEvent(index, updated);
          }}
          onCancel={() => setEditingPeriodic(null)}
        />
      )}
    </div>
  );
}

// ── 事件效果编辑弹窗 ──
function EventEffectEditModal({
  event, worldDef, onSave, onCancel,
}: {
  event: EventEffect;
  worldDef: WorldDef | null;
  onSave: (e: EventEffect) => void;
  onCancel: () => void;
}) {
  const [data, setData] = useState<EventEffect>(JSON.parse(JSON.stringify(event)));

  // 从世界定义提取可联动的资源和属性
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
    statConfig?.dim1?.name,
    statConfig?.dim2?.name,
    statConfig?.dim3?.name,
    statConfig?.dim4?.name,
    statConfig?.dim5?.name,
    statConfig?.dim6?.name,
  ].filter(Boolean);

  const handleSave = () => {
    if (!data.id.trim()) {
      alert('请输入事件 ID');
      return;
    }
    onSave(data);
  };

  const addKeyword = () => {
    setData({
      ...data,
      trigger: {
        ...data.trigger,
        keywords: [...(data.trigger.keywords || []), ''],
      },
    });
  };

  const updateKeyword = (index: number, value: string) => {
    const newKeywords = [...(data.trigger.keywords || [])];
    newKeywords[index] = value;
    setData({ ...data, trigger: { ...data.trigger, keywords: newKeywords } });
  };

  const removeKeyword = (index: number) => {
    setData({
      ...data,
      trigger: { ...data.trigger, keywords: (data.trigger.keywords || []).filter((_, i) => i !== index) },
    });
  };

  const addResourceEffect = () => {
    const newEffects = { ...data.effects };
    if (!newEffects.survival) newEffects.survival = {};
    if (!newEffects.survival.resources) newEffects.survival.resources = {};
    const defaultResource = availableResources[0] || '资源';
    newEffects.survival.resources[defaultResource] = { delta: 0 };
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

  const addStatEffect = () => {
    const newEffects = { ...data.effects };
    if (!newEffects.stats) newEffects.stats = {};
    if (!newEffects.stats.changes) newEffects.stats.changes = {};
    const defaultStat = availableStats[0] || '属性';
    newEffects.stats.changes[defaultStat] = { delta: 0 };
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
      zIndex: 1000,
    }}>
      <div style={{
        background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
        padding: '20px', maxWidth: '500px', width: '90%', maxHeight: '80vh',
        overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '16px',
      }}>
        <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)', color: 'var(--text-primary)' }}>
          编辑事件效果
        </h3>

        {/* ID */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>事件 ID</label>
          <input
            value={data.id}
            onChange={e => setData({ ...data, id: e.target.value })}
            className="input-field"
            placeholder="如: zombie_horde"
          />
        </div>

        {/* 优先级 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>优先级（数字大者先匹配）</label>
          <input
            type="number"
            value={data.priority}
            onChange={e => setData({ ...data, priority: parseInt(e.target.value) || 10 })}
            className="input-field"
          />
        </div>

        {/* 叠加策略 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>叠加策略</label>
          <select
            value={data.stackStrategy}
            onChange={e => setData({ ...data, stackStrategy: e.target.value as any })}
            className="input-field"
          >
            <option value="add">累加</option>
            <option value="max">取最大</option>
            <option value="override">覆盖</option>
            <option value="exclusive">互斥</option>
          </select>
        </div>

        {/* 触发关键词 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>触发关键词</label>
          {(data.trigger.keywords || []).map((keyword, i) => (
            <div key={i} style={{ display: 'flex', gap: '4px' }}>
              <input
                value={keyword}
                onChange={e => updateKeyword(i, e.target.value)}
                className="input-field"
                placeholder="关键词"
                style={{ flex: 1 }}
              />
              <button onClick={() => removeKeyword(i)} className="btn-ghost btn-xs" style={{ color: 'var(--danger)' }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button onClick={addKeyword} className="btn-ghost btn-sm">
            <Plus size={12} style={{ marginRight: '4px' }} /> 添加关键词
          </button>
        </div>

        {/* 生存资源效果 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>生存资源效果</label>
            <button onClick={addResourceEffect} className="btn-ghost btn-xs">
              <Plus size={12} />
            </button>
          </div>
          {Object.entries(data.effects.survival?.resources || {}).map(([name, config]) => (
            <div key={name} style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
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
                {availableResources.map((r: string) => <option key={r} value={r}>{r}</option>)}
                {!availableResources.includes(name) && <option value={name}>{name}</option>}
              </select>
              <select
                value={'delta' in config ? 'delta' : 'set' in config ? 'set' : 'min' in config ? 'min' : 'delta'}
                onChange={e => {
                  const newConfig: any = {};
                  newConfig[e.target.value] = config.delta ?? config.set ?? config.min ?? 0;
                  const newResources = { ...data.effects.survival?.resources, [name]: newConfig };
                  setData({
                    ...data,
                    effects: { ...data.effects, survival: { ...data.effects.survival, resources: newResources } },
                  });
                }}
                className="input-field"
                style={{ width: '80px' }}
              >
                <option value="delta">增减</option>
                <option value="set">设置</option>
                <option value="min">最低</option>
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
        </div>

        {/* 数值属性效果 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>数值属性效果</label>
            <button onClick={addStatEffect} className="btn-ghost btn-xs">
              <Plus size={12} />
            </button>
          </div>
          {Object.entries(data.effects.stats?.changes || {}).map(([name, config]) => (
            <div key={name} style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
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
                {availableStats.map(s => <option key={s} value={s}>{s}</option>)}
                {!availableStats.includes(name) && <option value={name}>{name}</option>}
              </select>
              <select
                value={'delta' in config ? 'delta' : 'set' in config ? 'set' : 'min' in config ? 'min' : 'delta'}
                onChange={e => {
                  const newConfig: any = {};
                  newConfig[e.target.value] = config.delta ?? config.set ?? config.min ?? 0;
                  const newChanges = { ...data.effects.stats?.changes, [name]: newConfig };
                  setData({
                    ...data,
                    effects: { ...data.effects, stats: { ...data.effects.stats, changes: newChanges } },
                  });
                }}
                className="input-field"
                style={{ width: '80px' }}
              >
                <option value="delta">增减</option>
                <option value="set">设置</option>
                <option value="min">最低</option>
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
        </div>

        {/* 经营资金效果 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>经营资金变动</label>
          <input
            type="number"
            value={data.effects.business?.fundsDelta ?? 0}
            onChange={e => setData({
              ...data,
              effects: { ...data.effects, business: { ...data.effects.business, fundsDelta: parseInt(e.target.value) || 0 } },
            })}
            className="input-field"
            placeholder="0"
          />
        </div>

        {/* 按钮 */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} className="btn-ghost btn-sm">取消</button>
          <button onClick={handleSave} className="btn-primary btn-sm">保存</button>
        </div>
      </div>
    </div>
  );
}

// ── 周期事件编辑弹窗 ──
function PeriodicEventEditModal({
  event, worldDef, onSave, onCancel,
}: {
  event: PeriodicEvent;
  worldDef: WorldDef | null;
  onSave: (e: PeriodicEvent) => void;
  onCancel: () => void;
}) {
  const [data, setData] = useState<PeriodicEvent>(JSON.parse(JSON.stringify(event)));

  // 复用 EventEffectEditModal 的联动逻辑
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
  ].filter(Boolean);

  const handleSave = () => {
    if (!data.id.trim()) {
      alert('请输入事件 ID');
      return;
    }
    if (!data.name.trim()) {
      alert('请输入事件名称');
      return;
    }
    onSave(data);
  };

  const addResourceEffect = () => {
    const newEffects = { ...data.effects };
    if (!newEffects.survival) newEffects.survival = {};
    if (!newEffects.survival.resources) newEffects.survival.resources = {};
    const defaultResource = availableResources[0] || '资源';
    newEffects.survival.resources[defaultResource] = { delta: 0 };
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

  const addStatEffect = () => {
    const newEffects = { ...data.effects };
    if (!newEffects.stats) newEffects.stats = {};
    if (!newEffects.stats.changes) newEffects.stats.changes = {};
    const defaultStat = availableStats[0] || '属性';
    newEffects.stats.changes[defaultStat] = { delta: 0 };
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
      zIndex: 1000,
    }}>
      <div style={{
        background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
        padding: '20px', maxWidth: '500px', width: '90%', maxHeight: '80vh',
        overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '16px',
      }}>
        <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)', color: 'var(--text-primary)' }}>
          编辑周期事件
        </h3>

        {/* ID */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>事件 ID</label>
          <input
            value={data.id}
            onChange={e => setData({ ...data, id: e.target.value })}
            className="input-field"
            placeholder="如: zombie_horde"
          />
        </div>

        {/* 名称 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>事件名称</label>
          <input
            value={data.name}
            onChange={e => setData({ ...data, name: e.target.value })}
            className="input-field"
            placeholder="如: 僵尸潮"
          />
        </div>

        {/* 描述 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>触发间隔（轮次）</label>
          <input
            type="number"
            value={data.intervalTicks}
            onChange={e => setData({ ...data, intervalTicks: parseInt(e.target.value) || 30 })}
            className="input-field"
          />
        </div>

        {/* 首次偏移 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>首次偏移（可选，避免所有周期事件同轮爆发）</label>
          <input
            type="number"
            value={data.offsetTicks ?? 0}
            onChange={e => setData({ ...data, offsetTicks: parseInt(e.target.value) || 0 })}
            className="input-field"
          />
        </div>

        {/* 是否喂给 AI 叙事 */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>生存资源效果</label>
            <button onClick={addResourceEffect} className="btn-ghost btn-xs">
              <Plus size={12} />
            </button>
          </div>
          {Object.entries(data.effects.survival?.resources || {}).map(([name, config]) => (
            <div key={name} style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
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
                {availableResources.map((r: string) => <option key={r} value={r}>{r}</option>)}
                {!availableResources.includes(name) && <option value={name}>{name}</option>}
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
        </div>

        {/* 数值属性效果 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>数值属性效果</label>
            <button onClick={addStatEffect} className="btn-ghost btn-xs">
              <Plus size={12} />
            </button>
          </div>
          {Object.entries(data.effects.stats?.changes || {}).map(([name, config]) => (
            <div key={name} style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
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
                {availableStats.map(s => <option key={s} value={s}>{s}</option>)}
                {!availableStats.includes(name) && <option value={name}>{name}</option>}
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
        </div>

        {/* 按钮 */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} className="btn-ghost btn-sm">取消</button>
          <button onClick={handleSave} className="btn-primary btn-sm">保存</button>
        </div>
      </div>
    </div>
  );
}
