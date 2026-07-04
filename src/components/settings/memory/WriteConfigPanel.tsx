// ============================================================
// 写入记忆层面板 — 使用共享组件重写
// ============================================================

import { useState } from 'react';
import { Pen } from 'lucide-react';
import type { MemorySystemConfig } from '../../../memory/types';
import type { ApiPreset } from '../apiPresetUtils';
import { Section, FieldGrid, Field, Select, Collapsible } from '../SettingsUIComponents';

interface Props {
  config: MemorySystemConfig;
  apiPresets: ApiPreset[];
  isSimple: boolean;
  onUpdate: (patch: Record<string, unknown>) => void;
  onWritePipelineUpdate: (patch: Record<string, unknown>) => void;
  onRetentionUpdate: (patch: Record<string, unknown>) => void;
  onCompilerUpdate: (patch: Record<string, unknown>) => void;
}

export function WriteConfigPanel({ config, apiPresets, isSimple, onUpdate, onWritePipelineUpdate, onRetentionUpdate, onCompilerUpdate }: Props) {
  const wp = config.writePipeline;
  const rt = config.retention;
  const cp = config.compiler;

  return (
    <Section icon={<Pen size={16} />} title="写入记忆层">
      <div style={{ padding: '8px 16px 0', fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
        {isSimple ? '简单模式下仅保留近场轮对与编译预算设置。' : '配置热态写入管线的各项参数。'}
      </div>
      <FieldGrid>
        {/* API 预设选择（满血模式） */}
        {!isSimple && (
          <PresetSelect
            label="热态主写入 API 预设"
            hint="未单独设置时，跟随记忆系统默认 API。"
            value={wp.apiPresetId}
            presets={apiPresets}
            fallbackLabel="跟随记忆系统默认 API"
            onChange={v => onWritePipelineUpdate({ apiPresetId: v })}
          />
        )}
        {!isSimple && (
          <PresetSelect
            label="热态摘要保存 API 预设"
            hint="未单独设置时，先跟随热态主写入 API。"
            value={wp.summaryApiPresetId}
            presets={apiPresets}
            fallbackLabel="跟随热态主写入 API"
            onChange={v => onWritePipelineUpdate({ summaryApiPresetId: v })}
          />
        )}
        {!isSimple && (
          <PresetSelect
            label="对象候选精排 API 预设"
            hint="未单独设置时，先跟随热态主写入 API。"
            value={config.retrieval.rerankApiPresetId}
            presets={apiPresets}
            fallbackLabel="跟随热态主写入 API"
            onChange={v => onUpdate({ retrieval: { ...config.retrieval, rerankApiPresetId: v } })}
          />
        )}

        {/* 开关 */}
        {!isSimple && (
          <Field label="写入后保存摘要">
            <Select
              options={[{ label: '开启', value: 'true' }, { label: '关闭', value: 'false' }]}
              value={String(wp.saveSummaryAfterIngest)}
              onChange={v => onWritePipelineUpdate({ saveSummaryAfterIngest: v === 'true' })}
            />
          </Field>
        )}
        {!isSimple && (
          <Field label="对象冲突检查">
            <Select
              options={[{ label: '开启', value: 'true' }, { label: '关闭', value: 'false' }]}
              value={String(wp.conflictJudgeEnabled)}
              onChange={v => onWritePipelineUpdate({ conflictJudgeEnabled: v === 'true' })}
            />
          </Field>
        )}
        {wp.conflictJudgeEnabled && !isSimple && (
          <PresetSelect
            label="热态冲突检查 API 预设"
            hint="未单独设置时，先跟随热态主写入 API。"
            value={wp.conflictJudgeApiPresetId}
            presets={apiPresets}
            fallbackLabel="跟随热态主写入 API"
            onChange={v => onWritePipelineUpdate({ conflictJudgeApiPresetId: v })}
          />
        )}

        {/* 数值输入 */}
        <NumberField label="近场原文轮对" value={config.protocol.recentTurnPairs} min={1} max={12}
          onChange={v => onUpdate({ protocol: { ...config.protocol, recentTurnPairs: v } })} />
        <NumberField label="编译上下文预算" value={config.protocol.compiledContextTokenBudget} min={-1} step={50}
          onChange={v => onUpdate({ protocol: { ...config.protocol, compiledContextTokenBudget: v } })} />
        {!isSimple && (
          <NumberField label="最小写入轮对" value={wp.minBatchTurns} min={1} max={6}
            onChange={v => onWritePipelineUpdate({ minBatchTurns: v })} />
        )}
        {!isSimple && (
          <NumberField label="单次写入最大轮对" value={wp.maxBatchTurns} min={-1}
            onChange={v => onWritePipelineUpdate({ maxBatchTurns: v })} />
        )}
        {!isSimple && (
          <NumberField label="Checkpoint 间隔" value={rt.checkpointInterval} min={1} max={60}
            onChange={v => onRetentionUpdate({ checkpointInterval: v })} />
        )}
        {!isSimple && (
          <NumberField label="老化倍率" value={rt.agingMultiplier} min={1} max={12}
            hint="默认 2，表示当前摘要/事件/线程的老化 age 阈值整体翻倍。"
            onChange={v => onRetentionUpdate({ agingMultiplier: v })} />
        )}

        {/* 候选池可折叠 */}
        {!isSimple && (
          <Collapsible title="候选池 Limit 配置" desc="控制热态编译各层的候选上限与精排入选上限。展开可逐项调整。">
            <FieldGrid>
              <NumberField label="热态线程直留" value={cp.hotThreadLimit} min={1} max={20} onChange={v => onCompilerUpdate({ hotThreadLimit: v })} />
              <NumberField label="热态状态直留" value={cp.hotStateLimit} min={1} max={30} onChange={v => onCompilerUpdate({ hotStateLimit: v })} />
              <NumberField label="热态关系直留" value={cp.hotRelationLimit} min={1} max={20} onChange={v => onCompilerUpdate({ hotRelationLimit: v })} />
              <NumberField label="热态事件直留" value={cp.hotEventLimit} min={1} max={20} onChange={v => onCompilerUpdate({ hotEventLimit: v })} />
              <NumberField label="热态实体直留" value={cp.hotEntityLimit} min={1} max={20} onChange={v => onCompilerUpdate({ hotEntityLimit: v })} />
              <NumberField label="线程候选上限" value={cp.threadCandidateLimit} min={1} max={40} onChange={v => onCompilerUpdate({ threadCandidateLimit: v })} />
              <NumberField label="状态候选上限" value={cp.stateCandidateLimit} min={1} max={60} onChange={v => onCompilerUpdate({ stateCandidateLimit: v })} />
              <NumberField label="关系候选上限" value={cp.relationCandidateLimit} min={1} max={40} onChange={v => onCompilerUpdate({ relationCandidateLimit: v })} />
              <NumberField label="事件候选上限" value={cp.eventCandidateLimit} min={1} max={60} onChange={v => onCompilerUpdate({ eventCandidateLimit: v })} />
              <NumberField label="实体候选上限" value={cp.entityCandidateLimit} min={1} max={40} onChange={v => onCompilerUpdate({ entityCandidateLimit: v })} />
              <NumberField label="归档候选上限" value={cp.archiveCandidateLimit} min={1} max={20} onChange={v => onCompilerUpdate({ archiveCandidateLimit: v })} />
              <NumberField label="精排候选总上限" value={cp.rerankCandidateTotalLimit} min={4} max={60} hint="送入 LLM 精排的候选对象总数上限。" onChange={v => onCompilerUpdate({ rerankCandidateTotalLimit: v })} />
              <NumberField label="精排入选总上限" value={cp.rerankSelectedTotalLimit} min={4} max={40} hint="精排后最终进入编译结果的对象总数上限。" onChange={v => onCompilerUpdate({ rerankSelectedTotalLimit: v })} />
            </FieldGrid>
          </Collapsible>
        )}
      </FieldGrid>
    </Section>
  );
}

// ─── 本地 helper 组件 ───

function NumberField({ label, hint, value, min, max, step, onChange }: {
  label: string; hint?: string; value: number; min?: number; max?: number; step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        value={value} min={min} max={max} step={step ?? 1}
        onChange={e => onChange(Number(e.target.value))}
        style={{
          padding: '7px 10px', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)',
          color: 'var(--text-primary)', fontSize: 'var(--font-size-base)', outline: 'none',
          width: '100%', transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
        onFocus={e => {
          e.target.style.borderColor = 'var(--accent)';
          e.target.style.boxShadow = '0 0 0 3px var(--accent-dim)';
        }}
        onBlur={e => {
          e.target.style.borderColor = 'var(--border)';
          e.target.style.boxShadow = 'none';
        }}
      />
    </Field>
  );
}

function PresetSelect({ label, hint, value, presets, fallbackLabel, onChange }: {
  label: string; hint?: string; value: string | null; presets: ApiPreset[];
  fallbackLabel: string; onChange: (v: string | null) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <Select
        options={[
          { label: fallbackLabel, value: '' },
          ...presets.map(p => ({ label: p.name, value: p.id })),
        ]}
        value={value ?? ''}
        onChange={v => onChange(v || null)}
        width="100%"
      />
    </Field>
  );
}
