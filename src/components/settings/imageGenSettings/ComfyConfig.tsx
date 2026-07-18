// ComfyUI 引擎配置 — URL 连接、模型/采样器/调度器/VAE、LoRA、工作流编辑器
import { useState, useCallback } from 'react';
import { useImageGen } from '@/hooks/useImageGen';
import {
  FieldGrid,
  Field,
  Select,
  Button,
} from '../SettingsUIComponents';
import SharedFields from './SharedFields';
import ComfyWorkflowEditor from '../ComfyWorkflowEditor';
import type { ConfigSectionProps } from './types';

export default function ComfyConfig({ config, updateConfig }: ConfigSectionProps) {
  const { loadComfyUIData, comfyData } = useImageGen();
  const [connectingComfy, setConnectingComfy] = useState(false);

  const handleComfyConnect = useCallback(async () => {
    setConnectingComfy(true);
    try {
      const data = await loadComfyUIData(config.comfyUrl);
      if (!config.comfyModel) {
        const firstModel = data?.models?.[0] || data?.unetModels?.[0];
        if (firstModel) updateConfig('comfyModel', firstModel);
      }
      if (data?.samplers?.length && !config.comfySampler) {
        updateConfig('comfySampler', data.samplers[0]);
      }
      if (data?.schedulers?.length && !config.comfyScheduler) {
        updateConfig('comfyScheduler', data.schedulers[0]);
      }
    } catch {
      // error logged in hook
    }
    setConnectingComfy(false);
  }, [config.comfyUrl, config.comfyModel, config.comfySampler, config.comfyScheduler, loadComfyUIData, updateConfig]);

  return (
    <>
      {/* API 地址 + 连接 */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <Field label="ComfyUI API 地址" hint="如跨域访问，ComfyUI 启动时需加 --cors 参数">
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              className="input-field"
              style={{ flex: 1, padding: '6px 10px' }}
              value={config.comfyUrl}
              onChange={(e) => updateConfig('comfyUrl', e.target.value)}
              placeholder="http://localhost:8188"
            />
            <Button onClick={handleComfyConnect} disabled={connectingComfy} primary>
              {connectingComfy ? '连接中...' : '连接并刷新'}
            </Button>
          </div>
        </Field>
      </div>

      {/* 模型 / 采样器 / 调度器 / VAE */}
      <FieldGrid>
        <Field label="模型文件">
          <select
            className="input-field"
            value={config.comfyModel}
            onChange={(e) => updateConfig('comfyModel', e.target.value)}
            style={{ padding: '5px 10px', width: '100%', cursor: 'pointer' }}
          >
            <option value="">（选择模型）</option>
            {comfyData.models.length > 0 && (
              <optgroup label="Checkpoint">
                {comfyData.models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </optgroup>
            )}
            {comfyData.unetModels.length > 0 && (
              <optgroup label="UNet">
                {comfyData.unetModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>
        <Field label="采样器">
          <Select
            options={comfyData.samplers.map((s) => ({ label: s, value: s }))}
            value={config.comfySampler}
            onChange={(v) => updateConfig('comfySampler', v)}
            width="100%"
          />
        </Field>
        <Field label="调度器">
          <Select
            options={comfyData.schedulers.map((s) => ({ label: s, value: s }))}
            value={config.comfyScheduler}
            onChange={(v) => updateConfig('comfyScheduler', v)}
            width="100%"
          />
        </Field>
        <Field label="VAE">
          <Select
            options={[{ label: '默认 (baked)', value: '' }, ...comfyData.vaes.map((v) => ({ label: v, value: v }))]}
            value={config.comfyVae}
            onChange={(v) => updateConfig('comfyVae', v)}
            width="100%"
          />
        </Field>
      </FieldGrid>

      {/* Steps / CFG Scale */}
      <SharedFields config={config} updateConfig={updateConfig} />

      {/* LoRA */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <Field label="LoRA" hint="添加 LoRA 模型（需先连接 ComfyUI 获取列表）">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {config.comfyLoras.map((lora, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select
                  className="input-field"
                  style={{ flex: 1, padding: '6px 10px' }}
                  value={lora.name}
                  onChange={(e) => {
                    const newLoras = [...config.comfyLoras];
                    newLoras[idx] = { ...lora, name: e.target.value };
                    updateConfig('comfyLoras', newLoras);
                  }}
                >
                  <option value="">选择 LoRA...</option>
                  {comfyData.loras.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
                <input
                  className="input-field"
                  type="number"
                  style={{ width: '70px', padding: '6px 10px' }}
                  value={lora.strength_model}
                  step={0.1}
                  title="Model Strength"
                  onChange={(e) => {
                    const newLoras = [...config.comfyLoras];
                    newLoras[idx] = { ...lora, strength_model: Number(e.target.value) };
                    updateConfig('comfyLoras', newLoras);
                  }}
                />
                <input
                  className="input-field"
                  type="number"
                  style={{ width: '70px', padding: '6px 10px' }}
                  value={lora.strength_clip}
                  step={0.1}
                  title="Clip Strength"
                  onChange={(e) => {
                    const newLoras = [...config.comfyLoras];
                    newLoras[idx] = { ...lora, strength_clip: Number(e.target.value) };
                    updateConfig('comfyLoras', newLoras);
                  }}
                />
                <Button
                  onClick={() => {
                    const newLoras = config.comfyLoras.filter((_, i) => i !== idx);
                    updateConfig('comfyLoras', newLoras);
                  }}
                >
                  删除
                </Button>
              </div>
            ))}
            <Button
              onClick={() => {
                updateConfig('comfyLoras', [
                  ...config.comfyLoras,
                  { name: '', strength_model: 1.0, strength_clip: 1.0 },
                ]);
              }}
              primary
            >
              + 添加 LoRA
            </Button>
          </div>
        </Field>
      </div>

      {/* 自定义工作流 */}
      <div style={{ padding: '0', borderBottom: '1px solid var(--border)' }}>
        <ComfyWorkflowEditor />
      </div>
    </>
  );
}
