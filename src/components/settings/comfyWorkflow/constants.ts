// ComfyUI 工作流编辑器 — 角色常量

export const ROLE_LABELS: Record<string, string> = {
  positive_prompt: '正提示词',
  negative_prompt: '负提示词',
  seed: '种子',
  steps: '步数',
  cfg: 'CFG',
  sampler: '采样器',
  scheduler: '调度器',
  width: '宽度',
  height: '高度',
  batch_size: '批量',
  denoise: '降噪',
};

export const ROLE_ORDER = [
  'positive_prompt',
  'negative_prompt',
  'seed',
  'steps',
  'cfg',
  'sampler',
  'scheduler',
  'width',
  'height',
  'batch_size',
  'denoise',
];
