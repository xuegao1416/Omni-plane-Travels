// 引擎选择器 — NovelAI / ComfyUI / 其他
import { SegmentedControl } from '../SettingsUIComponents';
import type { ImageEngine } from '@/api/imageGenTypes';

const engineOptions = [
  { label: 'NovelAI', value: 'nai' },
  { label: 'ComfyUI', value: 'comfyui' },
  { label: '其他', value: 'openai_compatible' },
];

interface EngineSelectorProps {
  engine: ImageEngine;
  onEngineChange: (engine: ImageEngine) => void;
}

export default function EngineSelector({ engine, onEngineChange }: EngineSelectorProps) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
      <SegmentedControl
        options={engineOptions}
        value={engine}
        onChange={(v) => onEngineChange(v as ImageEngine)}
      />
    </div>
  );
}
