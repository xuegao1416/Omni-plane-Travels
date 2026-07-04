// 共享生成参数 — Steps / CFG Scale（NAI 与 ComfyUI 共用）
import { FieldGrid, Slider } from '../SettingsUIComponents';
import type { ConfigSectionProps } from './types';

export default function SharedFields({ config, updateConfig }: ConfigSectionProps) {
  return (
    <FieldGrid>
      <Slider label="Steps" value={config.steps} onChange={(v) => updateConfig('steps', v)} min={1} max={50} />
      <Slider label="CFG Scale" value={config.scale} onChange={(v) => updateConfig('scale', v)} min={0} max={30} step={0.5} />
    </FieldGrid>
  );
}
