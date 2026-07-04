// ============================================================
// 检索记忆层面板 — 使用共享组件重写
// ============================================================

import { Search } from 'lucide-react';
import type { MemorySystemConfig } from '../../../memory/types';
import type { ApiPreset } from '../apiPresetUtils';
import { Section, FieldGrid, Field, Select, Toggle } from '../SettingsUIComponents';

interface Props {
  config: MemorySystemConfig;
  apiPresets: ApiPreset[];
  onUpdate: (patch: Record<string, unknown>) => void;
  onRetrievalUpdate: (patch: Record<string, unknown>) => void;
}

const inputStyle: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)',
  color: 'var(--text-primary)', fontSize: 'var(--font-size-base)', outline: 'none',
  width: '100%', transition: 'border-color 0.15s, box-shadow 0.15s',
};

function NumField({ label, hint, value, min, max, step, onChange }: {
  label: string; hint?: string; value: number; min?: number; max?: number; step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <input type="number" value={value} min={min} max={max} step={step ?? 1}
        onChange={e => onChange(Number(e.target.value))}
        style={inputStyle}
        onFocus={e => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--accent-dim)'; }}
        onBlur={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none'; }}
      />
    </Field>
  );
}

export function RetrievalConfigPanel({ config, apiPresets, onUpdate, onRetrievalUpdate }: Props) {
  const rt = config.retrieval;

  return (
    <Section icon={<Search size={16} />} title="检索记忆层">
      <div style={{ padding: '8px 16px 0', fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
        发送前上下文记忆整理的生效项。
      </div>
      <FieldGrid>
        {/* API 预设 */}
        <Field
          label="上下文记忆整理 API 预设"
          hint="用于发送前整理关键历史并直接生成可入模的上下文记忆正文。未单独设置时，跟随记忆系统默认 API。"
          span={2}
        >
          <Select
            options={[{ label: '跟随记忆系统默认 API', value: '' }, ...apiPresets.map(p => ({ label: p.name, value: p.id }))]}
            value={config.retrievalApiPresetId ?? ''}
            onChange={v => onUpdate({ retrievalApiPresetId: v || null })}
            width="100%"
          />
        </Field>

        {/* 检索规划开关 */}
        <Field label="启用发送前检索规划" hint="关闭后将跳过发送前上下文记忆整理，直接沿用热编译结果与可选向量召回。" span={2}>
          <Toggle value={rt.plannerEnabled} onChange={v => onRetrievalUpdate({ plannerEnabled: v })} />
        </Field>

        {/* 多轮检索 */}
        <Field label="多轮检索" hint="开启后检索规划器将进行多轮检索，AI 可判断是否需要继续检索以补全遗漏记忆。" span={2}>
          <Toggle value={rt.multiRoundEnabled} onChange={v => onRetrievalUpdate({ multiRoundEnabled: v })} />
        </Field>

        {rt.multiRoundEnabled && (
          <NumField label="最大检索轮数" value={rt.multiRoundMaxRounds} min={2} max={10}
            hint="多轮检索的最大轮数，AI 可能在达到上限前提前终止。建议 2~5 轮。"
            onChange={v => onRetrievalUpdate({ multiRoundMaxRounds: v })} />
        )}

        <NumField label="关键词补召回阈值（%）" value={rt.keywordRecallThreshold} min={0} max={100}
          hint="检索规划结束后，未被选中的候选记忆关键词命中率达此阈值则自动追加。设为 0 关闭，推荐 50。"
          onChange={v => onRetrievalUpdate({ keywordRecallThreshold: v })} />

        <NumField label="检索规划完整候选上限" value={rt.plannerCandidateLimit} min={1}
          hint="发送完整摘要的候选记忆条数上限。默认 200，超出的远层记忆只发送 ID、标题与关键词。"
          onChange={v => onRetrievalUpdate({ plannerCandidateLimit: v })} />

        <NumField label="检索规划标题候选上限" value={rt.plannerTitleOnlyLimit} min={-1} max={500} step={8}
          hint="超出完整候选上限后，仅发送标题的候选记忆条数上限。-1 表示无上限。"
          onChange={v => onRetrievalUpdate({ plannerTitleOnlyLimit: v })} />

        <Field label="本地回退标题策略" hint="仅在整理器未返回完整上下文记忆时用于本地后备选择。">
          <Select
            options={[
              { label: '标题 → 摘要', value: 'title_to_summary' },
              { label: '仅标题', value: 'title_only' },
              { label: '原文', value: 'raw' },
            ]}
            value={config.protocol.titleReplacementStrategy}
            onChange={v => onUpdate({ protocol: { ...config.protocol, titleReplacementStrategy: v } })}
            width="100%"
          />
        </Field>
      </FieldGrid>
    </Section>
  );
}
