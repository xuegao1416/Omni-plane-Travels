// 生图设置 Tab — 精简编排层，具体配置由子组件负责
import { useImageStore } from '@/stores/imageStore';
import {
  Section,
  SettingRow,
  Toggle,
  Field,
  TextArea,
  Button,
} from './SettingsUIComponents';
import { DEFAULT_IMAGE_CONFIG } from '@/api/imageGenTypes';
import { ImageIcon, Users, Cpu, Wand2 } from 'lucide-react';

import EngineSelector from './imageGenSettings/EngineSelector';
import NAIConfig from './imageGenSettings/NAIConfig';
import ComfyConfig from './imageGenSettings/ComfyConfig';
import OpenAIConfig from './imageGenSettings/OpenAIConfig';

export default function ImageGenSettingsTab() {
  const config = useImageStore((s) => s.config);
  const updateConfig = useImageStore((s) => s.updateConfig);
  const setConfig = useImageStore((s) => s.setConfig);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* ─── 正文生图 ─── */}
      <Section icon={<ImageIcon size={16} />} title="正文生图">
        <SettingRow label="启用正文生图" desc="开启后，正文中的 image###提示词### 标签将变为「点击生图」按钮">
          <Toggle value={config.inlineImageEnabled} onChange={(v) => updateConfig('inlineImageEnabled', v)} />
        </SettingRow>
        {config.inlineImageEnabled && (
          <>
            <SettingRow label="自动点击生图" desc="视图内可见的「点击生图」按钮将自动触发生成">
              <Toggle value={config.autoClickImageGen} onChange={(v) => updateConfig('autoClickImageGen', v)} />
            </SettingRow>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <Field label="识别正则" hint="用于匹配正文中生图标签的正则表达式，第一个捕获组为提示词">
                <input
                  className="input-field"
                  style={{ width: '100%', padding: '6px 10px' }}
                  value={config.inlineImageRegex}
                  onChange={(e) => updateConfig('inlineImageRegex', e.target.value)}
                  placeholder="image###([\s\S]+?)###"
                />
              </Field>
            </div>
          </>
        )}
      </Section>

      {/* ─── 角色画像 ─── */}
      <Section icon={<Users size={16} />} title="角色画像生成">
        <SettingRow label="启用自动画像生成" desc="新增 NPC 时自动调用 API 分析角色特征，生成画像">
          <Toggle value={config.characterPortraitEnabled} onChange={(v) => updateConfig('characterPortraitEnabled', v)} />
        </SettingRow>
        {config.characterPortraitEnabled && (
          <>
            <SettingRow label="人物画像自动更新" desc="NPC 外貌变化时自动重新生成画像">
              <Toggle
                value={config.characterPortraitAutoUpdateEnabled}
                onChange={(v) => updateConfig('characterPortraitAutoUpdateEnabled', v)}
              />
            </SettingRow>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <Field label="画像提示词模板" hint="自定义发送给主 API 的提示词模板。支持宏变量：{{characterToon}} 角色完整信息。留空使用默认模板。">
                <TextArea
                  value={config.characterPortraitPromptTemplate}
                  onChange={(v) => updateConfig('characterPortraitPromptTemplate', v)}
                  placeholder="留空使用默认 NovelAI 4.5 标签模板"
                  rows={4}
                />
              </Field>
            </div>
          </>
        )}
      </Section>

      {/* ─── 连接设置（引擎选择 + 引擎专属配置） ─── */}
      <Section icon={<Cpu size={16} />} title="连接设置">
        <EngineSelector engine={config.engine} onEngineChange={(v) => updateConfig('engine', v)} />
        {config.engine === 'nai' && <NAIConfig config={config} updateConfig={updateConfig} />}
        {config.engine === 'comfyui' && <ComfyConfig config={config} updateConfig={updateConfig} />}
        {config.engine === 'openai_compatible' && <OpenAIConfig config={config} updateConfig={updateConfig} />}
      </Section>

      {/* ─── 全局提示词 ─── */}
      <Section icon={<Wand2 size={16} />} title="全局提示词">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <Field label="正向提示词" hint="会自动与每次请求的提示词合并去重">
            <TextArea
              value={config.positivePrompt}
              onChange={(v) => updateConfig('positivePrompt', v)}
              placeholder="masterpiece, best quality, very aesthetic, absurdres"
              rows={3}
            />
          </Field>
        </div>
        <div style={{ padding: '12px 16px' }}>
          <Field label="负向提示词" hint="会自动与每次请求的负向提示词合并去重">
            <TextArea
              value={config.negativePrompt}
              onChange={(v) => updateConfig('negativePrompt', v)}
              placeholder={DEFAULT_IMAGE_CONFIG.negativePrompt}
              rows={3}
            />
          </Field>
        </div>
      </Section>

      {/* ─── 重置按钮 ─── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 0' }}>
        <Button onClick={() => setConfig({ ...DEFAULT_IMAGE_CONFIG })}>恢复默认设置</Button>
      </div>
    </div>
  );
}
