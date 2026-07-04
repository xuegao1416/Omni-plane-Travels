// NovelAI 引擎配置 — API Key、模型、采样器、分辨率、UC Preset、质量开关
import { useState } from 'react';
import {
  SettingRow,
  Toggle,
  FieldGrid,
  Field,
  Select,
  Button,
} from '../SettingsUIComponents';
import {
  NAI_MODELS,
  NAI_SAMPLERS,
  NAI_RESOLUTIONS,
  UC_PRESETS,
} from '@/api/imageGenTypes';
import SharedFields from './SharedFields';
import type { ConfigSectionProps } from './types';

const naiModelOptions = Object.entries(NAI_MODELS).map(([value, info]) => ({
  label: info.label + (info.recommended ? ' ★' : ''),
  value,
}));

const naiSamplerOptions = NAI_SAMPLERS.map((s) => ({ label: s, value: s }));

const naiResolutionOptions = Object.entries(NAI_RESOLUTIONS).map(([value, info]) => ({
  label: info.label,
  value,
}));

const ucPresetOptions = UC_PRESETS.map((p) => ({ label: p.label, value: String(p.value) }));

export default function NAIConfig({ config, updateConfig }: ConfigSectionProps) {
  const [showApiKey, setShowApiKey] = useState(false);

  return (
    <>
      {/* API Key */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <Field label="NovelAI API Key" hint="在 NovelAI 账号设置中获取 API Key">
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              className="input-field"
              type={showApiKey ? 'text' : 'password'}
              style={{ flex: 1, padding: '6px 10px' }}
              value={config.apiKey}
              onChange={(e) => updateConfig('apiKey', e.target.value)}
              placeholder="pst-..."
            />
            <Button onClick={() => setShowApiKey(!showApiKey)}>{showApiKey ? '隐藏' : '显示'}</Button>
          </div>
        </Field>
      </div>

      {/* 模型 / 采样器 / 分辨率 / UC Preset */}
      <FieldGrid>
        <Field label="模型">
          <Select options={naiModelOptions} value={config.model} onChange={(v) => updateConfig('model', v)} width="100%" />
        </Field>
        <Field label="采样器">
          <Select options={naiSamplerOptions} value={config.sampler} onChange={(v) => updateConfig('sampler', v)} width="100%" />
        </Field>
        <Field label="分辨率">
          <Select options={naiResolutionOptions} value={config.resolution} onChange={(v) => updateConfig('resolution', v)} width="100%" />
        </Field>
        <Field label="UC Preset">
          <Select options={ucPresetOptions} value={String(config.ucPreset)} onChange={(v) => updateConfig('ucPreset', Number(v))} width="100%" />
        </Field>
      </FieldGrid>

      {/* Steps / CFG Scale */}
      <SharedFields config={config} updateConfig={updateConfig} />

      {/* Quality Toggle */}
      <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
        <SettingRow label="Quality Toggle" desc="自动添加质量标签 (masterpiece, best quality)">
          <Toggle value={config.qualityToggle} onChange={(v) => updateConfig('qualityToggle', v)} />
        </SettingRow>
      </div>
    </>
  );
}
