/**
 * 世界动态面板 — 设置面板
 */

import { useState, useEffect } from 'react';
import { Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { useSimulationStore } from '../../../../stores/simulationStore';
import type { SimConfig } from '../../../../simulation/types';
import { DEFAULT_SIM_CONFIG } from '../../../../simulation/types';
import { getSimulationEngine } from '../../../../simulation/SimulationApi';
import { loadPresets } from '../../../settings/apiPresetUtils';
import { SIM_API_PRESET_KEY } from './constants';
import type { WorldDynamicsConfig } from '../../../../modules/schema';
import type { WorldDef } from '../../../../data/worlds-schema';
import SimulationRuleEditor from './SimulationRuleEditor';

interface SimSettingsProps {
  worldDef?: WorldDef | null;
  onRulesChange?: (rules: WorldDynamicsConfig) => void;
}

export function SimSettings({ worldDef, onRulesChange }: SimSettingsProps) {
  const { simState, updateConfig } = useSimulationStore();
  const cfg = simState.config ?? DEFAULT_SIM_CONFIG;
  const presets = loadPresets();
  const [showRules, setShowRules] = useState(false);

  // 从世界定义获取当前的世界动态配置
  const simMod = worldDef?.modules?.find(m => m.moduleId === 'simulation' && m.enabled);
  const currentRules = (simMod?.moduleConfig as unknown as WorldDynamicsConfig) ?? null;

  const handleRulesChange = (rules: WorldDynamicsConfig) => {
    if (onRulesChange) {
      onRulesChange(rules);
    }
  };

  const [presetId, setPresetId] = useState<string>(() => {
    try { return localStorage.getItem(SIM_API_PRESET_KEY) || ''; } catch { return ''; }
  });

  // preset 变更时：取完整 ApiConfig 注入引擎（不 merge 主 API）
  useEffect(() => {
    const preset = presets.find(p => p.id === presetId);
    getSimulationEngine().setSimApiOverride(preset?.config ?? null);
  }, [presetId, presets]);

  const handlePresetChange = (id: string) => {
    setPresetId(id);
    try { localStorage.setItem(SIM_API_PRESET_KEY, id); } catch {}
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* 开关 */}
      <label style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 10px', background: 'var(--bg-tertiary)', borderRadius: '8px',
      }}>
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)' }}>启用世界推演</span>
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={e => updateConfig({ enabled: e.target.checked })}
        />
      </label>

      {/* API 预设 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>推演 API</span>
        <select
          value={presetId}
          onChange={e => handlePresetChange(e.target.value)}
          className="input-field"
          style={{ width: '100%' }}
        >
          <option value="">跟随主 API</option>
          {presets.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* 时间单位 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>推演触发方式</span>
        <select
          value={cfg.timeUnit}
          onChange={e => updateConfig({ timeUnit: e.target.value as SimConfig['timeUnit'] })}
          className="input-field"
          style={{ width: '100%' }}
        >
          <option value="per_scene">每次场景切换</option>
          <option value="per_day">每天一次</option>
          <option value="per_week">每周一次</option>
          <option value="per_month">每月一次</option>
        </select>
      </div>

      {/* 自动推演间隔 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
          自动推演间隔（消息轮数，0=仅手动触发）
        </span>
        <input
          type="number"
          min={0}
          max={20}
          value={cfg.autoTickInterval}
          onChange={e => updateConfig({ autoTickInterval: parseInt(e.target.value) || 0 })}
          className="input-field"
          style={{ width: '80px' }}
        />
      </div>

      {/* 最大级联深度 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
          事件级联深度: {cfg.maxCascadeDepth}
        </span>
        <input
          type="range"
          min={1} max={5}
          value={cfg.maxCascadeDepth}
          onChange={e => updateConfig({ maxCascadeDepth: parseInt(e.target.value) })}
          style={{ width: '100%' }}
        />
      </div>

      {/* 最大活跃事件 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
          最大活跃事件数: {cfg.maxActiveEvents}
        </span>
        <input
          type="range"
          min={1} max={10}
          value={cfg.maxActiveEvents}
          onChange={e => updateConfig({ maxActiveEvents: parseInt(e.target.value) })}
          style={{ width: '100%' }}
        />
      </div>

      {/* 陈旧事件阈值 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
          陈旧事件衰减阈值: {cfg.staleTickThreshold} tick（0=禁用）
        </span>
        <input
          type="range"
          min={0} max={30}
          value={cfg.staleTickThreshold}
          onChange={e => updateConfig({ staleTickThreshold: parseInt(e.target.value) })}
          style={{ width: '100%' }}
        />
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', opacity: 0.7 }}>
          超过此 tick 数未更新的事件将自动衰减严重度
        </span>
      </div>

      {/* 统计信息 */}
      <div style={{
        fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', padding: '8px 10px',
        background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)',
      }}>
        <div>推演次数: {simState.tickCount ?? 0}</div>
        <div>活跃事件: {Object.values(simState.events ?? {}).filter(e => e.status !== 'resolved').length}</div>
        <div>已解决事件: {Object.keys(simState.resolvedEvents ?? {}).length}</div>
        <div>暗线角色: {Object.keys(simState.storylines ?? {}).length}</div>
        <div>待处理交互: {(simState.pendingInteractions ?? []).length}</div>
      </div>

      {/* ── 世界动态配置 ── */}
      <div style={{
        borderTop: '1px solid var(--border)',
        paddingTop: '12px',
        marginTop: '4px',
      }}>
        <button
          onClick={() => setShowRules(!showRules)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '4px 0', width: '100%',
          }}
        >
          {showRules ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
            世界动态配置
          </span>
        </button>

        {showRules && currentRules && (
          <div style={{ marginTop: '8px' }}>
            <SimulationRuleEditor
              rules={currentRules}
              onChange={handleRulesChange}
            />
          </div>
        )}

        {showRules && !currentRules && (
          <div style={{
            marginTop: '8px', padding: '12px',
            background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)',
            fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)',
            textAlign: 'center',
          }}>
            当前世界未启用世界动态模块
          </div>
        )}
      </div>

      {/* 重置推演 */}
      <button
        onClick={() => {
          if (confirm('确定要重置所有世界推演状态吗？这将清除所有事件、暗线和交互。')) {
            getSimulationEngine().reset();
          }
        }}
        className="btn-ghost btn-sm"
        style={{
          color: 'var(--danger)',
          borderColor: 'var(--danger)',
          width: '100%',
        }}
      >
        <Trash2 size={14} style={{ marginRight: '6px' }} />
        重置世界推演
      </button>
      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', textAlign: 'center' }}>
        清除所有推演数据（事件、暗线、交互），但保留存档中已保存的状态
      </span>
    </div>
  );
}
