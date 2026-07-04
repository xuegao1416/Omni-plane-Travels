// ============================================================
// 记忆系统设置 Tab — 内嵌模式渲染
// ============================================================

import { MemorySettingsOverlay } from './memory';

interface Props {
  onBack?: () => void;
}

export default function MemorySettingsTab({ onBack }: Props) {
  return (
    <MemorySettingsOverlay
      visible={true}
      onClose={() => onBack?.()}
      onSave={() => {}}
      mode="inline"
    />
  );
}
