// ─── 生图功能类型定义 ───

export type ImageEngine = 'nai' | 'comfyui' | 'openai_compatible' | 'krea';
export type ImageCategory = 'story' | 'character' | 'player';
export type ImageTaskStatus = 'queued' | 'generating' | 'completed' | 'failed';

export interface ComfyLora {
  name: string;
  strength_model: number;
  strength_clip: number;
}

// ─── ComfyUI 自定义工作流 ───

/** 参数注入点 — 标识工作流 JSON 中哪个节点的哪个输入槽用于动态注入 */
export interface ParamInjectPoint {
  nodeId: string;
  inputKey: string;
}

/** 单个 ComfyUI 节点映射 — 自动检测哪些节点可以注入参数 */
export interface DetectedNode {
  nodeId: string;
  classType: string;
  inputs: string[];
  /** 建议的映射角色（如 'positive_prompt', 'negative_prompt', 'seed' 等） */
  suggestedRole: string | null;
}

/** 工作流参数映射表 */
export interface WorkflowParamMapping {
  positivePrompt?: ParamInjectPoint;
  negativePrompt?: ParamInjectPoint;
  seed?: ParamInjectPoint;
  steps?: ParamInjectPoint;
  cfg?: ParamInjectPoint;
  sampler?: ParamInjectPoint;
  scheduler?: ParamInjectPoint;
  width?: ParamInjectPoint;
  height?: ParamInjectPoint;
  batchSize?: ParamInjectPoint;
  denoise?: ParamInjectPoint;
  /** 自定义注入 — key 为 nodeId.inputKey */
  custom: Record<string, string>;
}

/** 工作流验证结果 */
export interface WorkflowValidation {
  /** 工作流中所有 class_type */
  nodeTypes: string[];
  /** 本地 ComfyUI 中已安装的节点类型 */
  available: string[];
  /** 本地缺失的节点类型 */
  missing: string[];
  /** 引用的模型/VAE/LoRA 在本地是否存在 */
  modelWarnings: string[];
  /** 是否有致命问题（如没有 SaveImage 节点） */
  fatalErrors: string[];
  /** 是否通过基本验证 */
  valid: boolean;
}

/** ComfyUI 自定义工作流预设 */
export interface ComfyWorkflowPreset {
  id: string;
  name: string;
  /** 原始 ComfyUI workflow JSON（api format） */
  workflow: Record<string, Record<string, unknown>>;
  /** 参数映射 */
  paramMapping: WorkflowParamMapping;
  /** 导入时的验证快照 */
  validation: WorkflowValidation;
  createdAt: number;
  updatedAt: number;
}

export interface ImageGenConfig {
  engine: ImageEngine;
  // ─── NovelAI ───
  apiKey: string;
  model: string;
  sampler: string;
  steps: number;
  scale: number;
  resolution: string;
  customWidth: number;
  customHeight: number;
  seed: number;
  positivePrompt: string;
  negativePrompt: string;
  qualityToggle: boolean;
  varietyPlus: boolean;
  cfgRescale: number;
  ucPreset: number;
  noiseSchedule: string;
  // ─── ComfyUI ───
  comfyUrl: string;
  comfyModel: string;
  comfySampler: string;
  comfyScheduler: string;
  comfyVae: string;
  comfyLoras: ComfyLora[];
  comfyPositivePrompt: string;
  comfyNegativePrompt: string;
  /** 是否使用自定义工作流（否则用内置默认流） */
  comfyUseCustomWorkflow: boolean;
  /** 当前选中的自定义工作流 ID */
  comfyActiveWorkflowId: string;
  /** 所有自定义工作流预设 */
  comfyWorkflowPresets: ComfyWorkflowPreset[];
  // ─── OpenAI Compatible ───
  openaiCompatibleProvider: string;
  openaiCompatibleApiUrl: string;
  openaiCompatibleApiKey: string;
  openaiCompatibleModel: string;
  // ─── Krea ───
  kreaApiKey: string;
  kreaModel: string;
  kreaAspectRatio: string;
  kreaResolution: string;
  kreaCreativity: string;
  // ─── 正文生图 ───
  inlineImageEnabled: boolean;
  inlineImageRegex: string;
  autoClickImageGen: boolean;
  inlineImagePromptTemplate: string;
  // ─── 角色画像 ───
  characterPortraitEnabled: boolean;
  characterPortraitAutoUpdateEnabled: boolean;
  characterPortraitPromptTemplate: string;
}

export interface ImageTask {
  id: string;
  status: ImageTaskStatus;
  prompt: string;
  negativePrompt: string;
  imageUrl: string;
  imageBlobKey: string | null;
  createdAt: number;
  updatedAt: number;
  params: Record<string, unknown>;
  errorMessage: string;
  category: ImageCategory;
  characterName: string;
}

export interface ImageGenResult {
  blob: Blob;
  seed: number | null;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  model: string;
  sampler: string;
  steps: number | null;
  scale: number | null;
}

export interface ComfyUIData {
  models: string[];
  unetModels: string[];
  samplers: string[];
  schedulers: string[];
  vaes: string[];
  loras: string[];
  objectInfo: Record<string, unknown>;
}

// ─── 常量 ───

export const DEFAULT_NEGATIVE_PROMPT =
  'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry';

export const NAI_MODELS: Record<string, { label: string; recommended?: boolean }> = {
  'nai-diffusion-4-5-full': { label: 'NAI Diffusion V4.5 Full', recommended: true },
  'nai-diffusion-4-5-curated': { label: 'NAI Diffusion V4.5 Curated' },
  'nai-diffusion-4-full': { label: 'NAI Diffusion V4 Full' },
  'nai-diffusion-4-curated': { label: 'NAI Diffusion V4 Curated' },
  'nai-diffusion-3': { label: 'NAI Diffusion V3 (Anime)' },
};

export const NAI_SAMPLERS = [
  'k_euler_ancestral',
  'k_euler',
  'k_dpmpp_2m',
  'k_dpmpp_2s_ancestral',
  'k_dpmpp_sde',
  'ddim_v3',
];

export const NAI_RESOLUTIONS: Record<string, { width: number; height: number; label: string }> = {
  portrait: { width: 832, height: 1216, label: '竖版 (832×1216)' },
  landscape: { width: 1216, height: 832, label: '横版 (1216×832)' },
  square: { width: 1024, height: 1024, label: '方形 (1024×1024)' },
  portrait_sm: { width: 512, height: 768, label: '竖版小 (512×768)' },
  landscape_sm: { width: 768, height: 512, label: '横版小 (768×512)' },
  square_sm: { width: 640, height: 640, label: '方形小 (640×640)' },
};

export const UC_PRESETS = [
  { value: 0, label: 'Heavy' },
  { value: 1, label: 'Light' },
  { value: 2, label: 'Furry' },
  { value: 3, label: 'Human' },
  { value: 4, label: 'None' },
];

export const OPENAI_COMPATIBLE_IMAGE_PROVIDERS: Record<
  string,
  { label: string; defaultApiUrl: string; modelPlaceholder: string }
> = {
  openai: { label: 'OpenAI', defaultApiUrl: 'https://api.openai.com/v1', modelPlaceholder: 'gpt-image-1' },
  grok: { label: 'Grok', defaultApiUrl: 'https://api.x.ai/v1', modelPlaceholder: 'grok-2-image-1212' },
  gemini: {
    label: 'Gemini',
    defaultApiUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelPlaceholder: 'imagen-3.0-generate-002',
  },
  custom: { label: '自定义兼容地址', defaultApiUrl: '', modelPlaceholder: 'your-image-model' },
};

export const KREA_MODELS: Record<string, { label: string; provider: string; model: string }> = {
  'krea/krea-2/medium': { label: 'Krea 2 Medium', provider: 'krea', model: 'krea-2/medium' },
  'krea/krea-2/large': { label: 'Krea 2 Large', provider: 'krea', model: 'krea-2/large' },
  'bfl/flux-1-dev': { label: 'Flux 1 Dev', provider: 'bfl', model: 'flux-1-dev' },
  'bfl/flux-1-pro': { label: 'Flux 1 Pro', provider: 'bfl', model: 'flux-1-pro' },
  'google/imagen-4': { label: 'Imagen 4', provider: 'google', model: 'imagen-4' },
  'google/nano-banana-pro': { label: 'Nano Banana Pro', provider: 'google', model: 'nano-banana-pro' },
};

export const KREA_ASPECT_RATIOS = [
  { value: '1:1', label: '1:1 方形' },
  { value: '4:3', label: '4:3 横版' },
  { value: '3:4', label: '3:4 竖版' },
  { value: '16:9', label: '16:9 宽屏' },
  { value: '9:16', label: '9:16 竖屏' },
  { value: '4:5', label: '4:5 竖版' },
  { value: '5:4', label: '5:4 横版' },
];

export const KREA_RESOLUTIONS = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
];

export const KREA_CREATIVITY_LEVELS = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

export const DEFAULT_IMAGE_CONFIG: ImageGenConfig = {
  engine: 'nai',
  // NovelAI
  apiKey: '',
  model: 'nai-diffusion-4-5-full',
  sampler: 'k_euler_ancestral',
  steps: 28,
  scale: 5,
  resolution: 'portrait',
  customWidth: 832,
  customHeight: 1216,
  seed: 0,
  positivePrompt: '',
  negativePrompt: DEFAULT_NEGATIVE_PROMPT,
  qualityToggle: true,
  varietyPlus: true,
  cfgRescale: 0,
  ucPreset: 4,
  noiseSchedule: 'karras',
  // ComfyUI
  comfyUrl: 'http://localhost:8188',
  comfyModel: '',
  comfySampler: 'euler',
  comfyScheduler: 'normal',
  comfyVae: '',
  comfyLoras: [],
  comfyPositivePrompt: '',
  comfyNegativePrompt: '',
  comfyUseCustomWorkflow: false,
  comfyActiveWorkflowId: '',
  comfyWorkflowPresets: [],
  // OpenAI Compatible
  openaiCompatibleProvider: 'openai',
  openaiCompatibleApiUrl: '',
  openaiCompatibleApiKey: '',
  openaiCompatibleModel: '',
  // Krea
  kreaApiKey: '',
  kreaModel: 'krea/krea-2/medium',
  kreaAspectRatio: '1:1',
  kreaResolution: '1K',
  kreaCreativity: 'medium',
  // 正文生图
  inlineImageEnabled: false,
  inlineImageRegex: 'image###([\\s\\S]+?)###',
  autoClickImageGen: false,
  inlineImagePromptTemplate: '',
  // 角色画像
  characterPortraitEnabled: false,
  characterPortraitAutoUpdateEnabled: false,
  characterPortraitPromptTemplate: '',
};
