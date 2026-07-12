// 生图 API 调用层 — 三种引擎的 fetch 逻辑

import type {
  ImageGenConfig,
  ImageGenResult,
  ComfyUIData,
  ComfyWorkflowPreset,
  WorkflowParamMapping,
  WorkflowValidation,
  DetectedNode,
} from './imageGenTypes';
import {
  DEFAULT_NEGATIVE_PROMPT,
  NAI_RESOLUTIONS,
  OPENAI_COMPATIBLE_IMAGE_PROVIDERS,
} from './imageGenTypes';
import {
  applyRuntimeValuesToApiPrompt,
  validateAndRepairComfyApiPromptResources,
  formatComfyWorkflowResourceValidationError,
} from './comfy/comfyWorkflow';
import type { ApiPromptWorkflow } from './comfy/comfyWorkflow';
import { getProxyUrl } from './client';
import { nativeFetch } from '../utils/nativeFetch';

/** 轻量代理辅助 — 为生图请求注入用户自建 CF Worker 代理（无日志，适合轮询场景） */
function withProxy(
  url: string,
  headers: Record<string, string> = {},
): { url: string; headers: Record<string, string> } {
  const proxyUrl = getProxyUrl();
  if (proxyUrl) {
    return { url: proxyUrl, headers: { ...headers, 'X-Target-URL': url } };
  }
  return { url, headers };
}

// ─── 工具函数 ───

export function normalizePromptText(text: string): string {
  const normalized = String(text ?? '').replace(/\r\n?/g, '\n');
  return normalized
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function normalizePositivePrompt(text: string): string {
  let normalized = normalizePromptText(text);
  normalized = normalized
    .replace(/^\s*(prompt|positive\s*prompt|正面提示词|提示词)\s*[:：]\s*/i, '')
    .trim();
  return normalized;
}

export function normalizeNegativePrompt(text: string): string {
  let normalized = normalizePromptText(text);
  normalized = normalized
    .replace(/^\s*(negative\s*prompt|negative|neg\s*prompt|负面提示词)\s*[:：]\s*/i, '')
    .trim();
  return normalized;
}

export function mergePromptTags(...texts: string[]): string {
  const merged: string[] = [];
  const seen = new Set<string>();

  texts.forEach((text) => {
    const normalized = normalizePromptText(text);
    if (!normalized) return;

    normalized
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .forEach((tag) => {
        const key = tag.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(tag);
      });
  });

  return merged.join(', ');
}

export function parseLinkDirective(prompt: string): { engine: string | null; cleanPrompt: string } {
  if (!prompt || typeof prompt !== 'string') return { engine: null, cleanPrompt: prompt || '' };

  const linkMatch = prompt.match(/\blink:(NAI|NovelAI|com|comfyui|other)\b/i);
  if (!linkMatch) return { engine: null, cleanPrompt: prompt };

  const directive = linkMatch[1].toLowerCase();
  const cleanPrompt = prompt
    .replace(linkMatch[0], '')
    .replace(/,\s*,/g, ',')
    .replace(/^\s*,\s*/, '')
    .replace(/\s*,\s*$/, '')
    .trim();

  const engineMap: Record<string, string> = {
    nai: 'nai',
    novelai: 'nai',
    com: 'comfyui',
    comfyui: 'comfyui',
    other: 'openai_compatible',
  };

  return { engine: engineMap[directive] || null, cleanPrompt };
}

export function resolveMergedPrompts(
  prompt: string,
  options: { negativePrompt?: string } = {},
  cfg: Partial<ImageGenConfig> = {},
): { positivePrompt: string; negativePrompt: string } {
  const globalPositivePrompt = normalizePositivePrompt(cfg?.positivePrompt || '');
  const requestPositivePrompt = normalizePositivePrompt(prompt);
  const positivePrompt = mergePromptTags(globalPositivePrompt, requestPositivePrompt);

  const globalNegativePrompt = normalizeNegativePrompt(cfg?.negativePrompt || '');
  const requestNegativePrompt = normalizeNegativePrompt(options?.negativePrompt || '');
  const negativePrompt = mergePromptTags(globalNegativePrompt, requestNegativePrompt) || DEFAULT_NEGATIVE_PROMPT;

  return { positivePrompt, negativePrompt };
}

export function resolveComfyMergedPrompts(
  prompt: string,
  options: { negativePrompt?: string } = {},
  cfg: Partial<ImageGenConfig> = {},
): { positivePrompt: string; negativePrompt: string } {
  const globalPositivePrompt = normalizePositivePrompt(cfg?.positivePrompt || '');
  const requestPositivePrompt = normalizePositivePrompt(prompt);
  const positivePrompt = mergePromptTags(globalPositivePrompt, requestPositivePrompt);

  const globalNegativePrompt = normalizeNegativePrompt(cfg?.negativePrompt || '');
  const requestNegativePrompt = normalizeNegativePrompt(options?.negativePrompt || '');
  const negativePrompt = mergePromptTags(globalNegativePrompt, requestNegativePrompt) || DEFAULT_NEGATIVE_PROMPT;

  return { positivePrompt, negativePrompt };
}

export function resolveOpenAICompatibleMergedPrompts(
  prompt: string,
  options: { negativePrompt?: string } = {},
  cfg: Partial<ImageGenConfig> = {},
): { positivePrompt: string; negativePrompt: string } {
  const globalPositivePrompt = normalizePositivePrompt(cfg?.positivePrompt || '');
  const requestPositivePrompt = normalizePositivePrompt(prompt);
  const positivePrompt = mergePromptTags(globalPositivePrompt, requestPositivePrompt);

  const globalNegativePrompt = normalizeNegativePrompt(cfg?.negativePrompt || '');
  const requestNegativePrompt = normalizeNegativePrompt(options?.negativePrompt || '');
  const negativePrompt = mergePromptTags(globalNegativePrompt, requestNegativePrompt);

  return { positivePrompt, negativePrompt };
}

export function resolvePromptsForEngine(
  prompt: string,
  options: { negativePrompt?: string } = {},
  cfg: Partial<ImageGenConfig> = {},
): { positivePrompt: string; negativePrompt: string } {
  if (cfg?.engine === 'comfyui') return resolveComfyMergedPrompts(prompt, options, cfg);
  if (cfg?.engine === 'openai_compatible') return resolveOpenAICompatibleMergedPrompts(prompt, options, cfg);
  return resolveMergedPrompts(prompt, options, cfg);
}

export function resolveRequestedImageSize(
  cfg: Partial<ImageGenConfig> = {},
  options: { width?: number; height?: number } = {},
): { width: number; height: number } {
  let resW = 832;
  let resH = 1216;

  if (cfg.resolution === 'custom') {
    resW = cfg.customWidth || 832;
    resH = cfg.customHeight || 1216;
  } else if (cfg.resolution && typeof cfg.resolution === 'string') {
    const resEntry = NAI_RESOLUTIONS[cfg.resolution];
    if (resEntry) {
      resW = resEntry.width;
      resH = resEntry.height;
    } else if (cfg.resolution.includes('x') || cfg.resolution.includes('×')) {
      const parts = cfg.resolution.split(/[x×]/);
      resW = parseInt(parts[0], 10) || 832;
      resH = parseInt(parts[1], 10) || 1216;
    }
  }

  return { width: options.width || resW, height: options.height || resH };
}

function getOpenAICompatibleProviderInfo(provider: string) {
  return OPENAI_COMPATIBLE_IMAGE_PROVIDERS[provider] || OPENAI_COMPATIBLE_IMAGE_PROVIDERS.custom;
}

function normalizeOpenAICompatibleApiUrl(apiUrl: string, provider = 'custom'): string {
  const providerInfo = getOpenAICompatibleProviderInfo(provider);
  const safeUrl = String(apiUrl || providerInfo.defaultApiUrl || '').trim();
  if (!safeUrl) return '';

  if (/\/images\/generations\/?$/i.test(safeUrl)) {
    return safeUrl.replace(/\/+$/, '');
  }

  try {
    const parsedUrl = new URL(safeUrl);
    const pathname = parsedUrl.pathname.replace(/\/+$/, '');
    parsedUrl.search = '';
    parsedUrl.hash = '';

    if (/\/images\/generations$/i.test(pathname)) {
      parsedUrl.pathname = pathname;
      return parsedUrl.toString().replace(/\/+$/, '');
    }

    if (!pathname || pathname === '/') {
      parsedUrl.pathname = parsedUrl.hostname.includes('generativelanguage.googleapis.com')
        ? '/v1beta/openai/images/generations'
        : '/v1/images/generations';
      return parsedUrl.toString().replace(/\/+$/, '');
    }

    parsedUrl.pathname = `${pathname}/images/generations`;
    return parsedUrl.toString().replace(/\/+$/, '');
  } catch {
    const fallbackBase = safeUrl.replace(/\/+$/, '');
    return /\/images\/generations$/i.test(fallbackBase) ? fallbackBase : `${fallbackBase}/images/generations`;
  }
}

function resolveOpenAICompatibleSize(width: number, height: number) {
  const safeWidth = Number(width) || 1024;
  const safeHeight = Number(height) || 1024;

  if (Math.abs(safeWidth - safeHeight) <= 64) {
    return { width: 1024, height: 1024, size: '1024x1024' };
  }
  if (safeWidth > safeHeight) {
    return { width: 1536, height: 1024, size: '1536x1024' };
  }
  return { width: 1024, height: 1536, size: '1024x1536' };
}

function createBlobFromBase64(base64Data: string, mimeType = 'image/png'): Blob {
  const binary = atob(String(base64Data || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export function getGenerationConfigError(cfg: Partial<ImageGenConfig>): string {
  if (cfg.engine === 'comfyui') {
    if (!cfg.comfyUrl) return '请先在文生图设置中配置 ComfyUI 地址';
    if (!cfg.comfyModel) return '请先在文生图设置中配置 ComfyUI 模型';
    return '';
  }
  if (cfg.engine === 'openai_compatible') {
    if (!cfg.openaiCompatibleApiUrl) return '请先在文生图设置中配置其他生图地址';
    if (!cfg.openaiCompatibleApiKey) return '请先在文生图设置中配置其他生图 API Key';
    if (!cfg.openaiCompatibleModel) return '请先在文生图设置中配置其他生图模型';
    return '';
  }
  if (!cfg.apiKey) return '请先在文生图设置中配置 NovelAI API Key';
  return '';
}

// ─── ComfyUI ───

export async function fetchComfyUIData(apiUrl: string): Promise<ComfyUIData> {
  const baseUrl = apiUrl.replace(/\/$/, '');
  const { url, headers } = withProxy(`${baseUrl}/object_info`);
  const res = await nativeFetch(url, { headers });
  if (!res.ok) throw new Error('无法连接到 ComfyUI');
  const data = await res.json();

  return {
    models: data.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [],
    samplers: data.KSampler?.input?.required?.sampler_name?.[0] || [],
    schedulers: data.KSampler?.input?.required?.scheduler?.[0] || [],
    vaes: data.VAELoader?.input?.required?.vae_name?.[0] || [],
    loras: data.LoraLoader?.input?.required?.lora_name?.[0] || [],
    objectInfo: data,
  };
}

function buildDefaultComfyExecutionPayload(prompt: string, options: Record<string, unknown> = {}, imageConfig: Partial<ImageGenConfig> = {}) {
  const { positivePrompt, negativePrompt } = resolveComfyMergedPrompts(prompt, options as Record<string, unknown>, imageConfig);
  const requestedSize = resolveRequestedImageSize(imageConfig, options as Record<string, unknown>);
  const width = (options.width as number) || requestedSize.width;
  const height = (options.height as number) || requestedSize.height;
  const seed = (options.seed as number) || imageConfig.seed || Math.floor(Math.random() * 4294967295);
  const steps = imageConfig.steps || 20;
  const cfgScale = imageConfig.scale || 7;
  const sampler_name = imageConfig.comfySampler || 'euler';
  const scheduler = imageConfig.comfyScheduler || 'normal';
  const model = imageConfig.comfyModel || '';
  const vae = imageConfig.comfyVae || '';

  if (!model) throw new Error('未选择 ComfyUI 模型');

  const workflow: Record<string, Record<string, unknown>> = {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed, steps, cfg: cfgScale, sampler_name, scheduler, denoise: 1,
        model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
      },
    },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: model } },
    '5': { class_type: 'EmptyLatentImage', inputs: { batch_size: 1, width, height } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: positivePrompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: negativePrompt, clip: ['4', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'StoryImage', images: ['8', 0] } },
  };

  let currentModelId = '4';
  let currentClipId: [string, number] = ['4', 1];

  if (vae && vae !== 'baked') {
    workflow['10'] = { class_type: 'VAELoader', inputs: { vae_name: vae } };
    (workflow['8'].inputs as Record<string, unknown>).vae = ['10', 0];
  }

  if (imageConfig.comfyLoras && imageConfig.comfyLoras.length > 0) {
    let loraId = 20;
    imageConfig.comfyLoras.forEach((lora) => {
      if (!lora.name) return;
      workflow[loraId.toString()] = {
        class_type: 'LoraLoader',
        inputs: {
          lora_name: lora.name,
          strength_model: lora.strength_model ?? 1.0,
          strength_clip: lora.strength_clip ?? 1.0,
          model: [currentModelId, 0],
          clip: currentClipId,
        },
      };
      currentModelId = loraId.toString();
      currentClipId = [loraId.toString(), 1];
      loraId += 1;
    });
    (workflow['3'].inputs as Record<string, unknown>).model = [currentModelId, 0];
    (workflow['6'].inputs as Record<string, unknown>).clip = currentClipId;
    (workflow['7'].inputs as Record<string, unknown>).clip = currentClipId;
  }

  return {
    promptPayload: workflow,
    positivePrompt,
    negativePrompt,
    width,
    height,
    seed,
    steps,
    cfgScale,
    sampler_name,
    scheduler,
    model,
    vae,
    resultModelLabel: 'ComfyUI: ' + model,
    resultSamplerLabel: sampler_name,
  };
}

// ─── ComfyUI 自定义工作流 ───

/**
 * 验证工作流中的所有节点是否在本地 ComfyUI 中可用。
 * 需要传入已获取的 objectInfo（通过 fetchComfyUIData）。
 */
export function validateWorkflow(
  workflow: Record<string, Record<string, unknown>>,
  objectInfo: Record<string, unknown>,
): WorkflowValidation {
  const nodeTypes: string[] = [];
  const availableNodes = Object.keys(objectInfo);
  const missing: string[] = [];
  const modelWarnings: string[] = [];
  const fatalErrors: string[] = [];

  for (const [nodeId, node] of Object.entries(workflow)) {
    if (typeof node !== 'object' || !node) continue;
    const classType = typeof node.class_type === 'string' ? node.class_type : '';
    if (!classType) continue;
    nodeTypes.push(classType);

    if (!availableNodes.includes(classType)) {
      missing.push(`节点 ${nodeId}: ${classType}`);
    }
  }

  // 检查是否有输出节点（SaveImage / PreviewImage / VHS_VideoCombine 等）
  const outputNodeTypes = ['SaveImage', 'PreviewImage', 'VHS_VideoCombine', 'SaveImageWebsocket'];
  const hasOutput = nodeTypes.some((t) => outputNodeTypes.includes(t));
  if (!hasOutput) {
    fatalErrors.push('工作流中未找到输出节点（SaveImage / PreviewImage 等）');
  }

  const valid = missing.length === 0 && fatalErrors.length === 0;

  return {
    nodeTypes,
    available: availableNodes,
    missing,
    modelWarnings,
    fatalErrors,
    valid,
  };
}

/** 检测的节点类型 → 建议映射角色 */
const NODE_ROLE_HINTS: Record<string, string[]> = {
  'CLIPTextEncode': ['positive_prompt', 'negative_prompt'],
  'CLIPTextEncodeSDXL': ['positive_prompt', 'negative_prompt'],
  'CLIPTextEncodeFlux': ['positive_prompt'],
  'CLIPTextEncodeHunyuanDiT': ['positive_prompt'],
  'KSampler': ['seed', 'steps', 'cfg', 'sampler', 'scheduler', 'denoise'],
  'KSamplerAdvanced': ['seed', 'steps', 'cfg', 'sampler', 'scheduler', 'denoise'],
  'KSamplerSelect': ['sampler'],
  'EmptyLatentImage': ['width', 'height', 'batch_size'],
  'EmptySD3LatentImage': ['width', 'height', 'batch_size'],
  'EmptyFluxLatentImage': ['width', 'height', 'batch_size'],
  'RandomNoise': ['seed'],
};

/**
 * 自动检测工作流中可以映射参数注入的节点。
 * 返回检测到的节点列表，每个节点包含建议的映射角色。
 */
export function detectWorkflowNodes(
  workflow: Record<string, Record<string, unknown>>,
): DetectedNode[] {
  const detected: DetectedNode[] = [];

  for (const [nodeId, node] of Object.entries(workflow)) {
    if (typeof node !== 'object' || !node) continue;
    const classType = typeof node.class_type === 'string' ? node.class_type : '';
    if (!classType) continue;

    const inputs = node.inputs && typeof node.inputs === 'object'
      ? Object.keys(node.inputs as Record<string, unknown>)
      : [];
    const hints = NODE_ROLE_HINTS[classType] || [];
    const suggestedRole = hints.length > 0 ? hints[0] : null;

    detected.push({ nodeId, classType, inputs, suggestedRole });
  }

  return detected;
}

/**
 * 应用参数映射到工作流 JSON，生成可提交的 payload。
 * 返回深拷贝后的工作流（不修改原始数据）。
 */
export function injectParamsIntoWorkflow(
  workflow: Record<string, Record<string, unknown>>,
  mapping: WorkflowParamMapping,
  params: {
    positivePrompt: string;
    negativePrompt: string;
    width: number;
    height: number;
    seed: number;
    steps: number;
    cfgScale: number;
    sampler?: string;
    scheduler?: string;
    denoise?: number;
    batchSize?: number;
  },
): Record<string, Record<string, unknown>> {
  // 深拷贝
  const cloned: Record<string, Record<string, unknown>> = {};
  for (const [id, node] of Object.entries(workflow)) {
    cloned[id] = { ...node, inputs: node.inputs ? { ...(node.inputs as Record<string, unknown>) } : {} };
  }

  const inject = (point: { nodeId: string; inputKey: string } | undefined, value: unknown) => {
    if (!point || !cloned[point.nodeId]) return;
    const inputs = cloned[point.nodeId].inputs as Record<string, unknown>;
    if (inputs && point.inputKey in inputs) {
      inputs[point.inputKey] = value;
    }
  };

  inject(mapping.positivePrompt, params.positivePrompt);
  inject(mapping.negativePrompt, params.negativePrompt);
  inject(mapping.width, params.width);
  inject(mapping.height, params.height);
  inject(mapping.seed, params.seed);
  inject(mapping.steps, params.steps);
  inject(mapping.cfg, params.cfgScale);
  inject(mapping.batchSize, params.batchSize ?? 1);

  if (params.sampler !== undefined) inject(mapping.sampler, params.sampler);
  if (params.scheduler !== undefined) inject(mapping.scheduler, params.scheduler);
  if (params.denoise !== undefined) inject(mapping.denoise, params.denoise);

  // 自定义注入
  for (const [key, value] of Object.entries(mapping.custom)) {
    const dotIdx = key.indexOf('.');
    if (dotIdx < 0) continue;
    const nodeId = key.slice(0, dotIdx);
    const inputKey = key.slice(dotIdx + 1);
    inject({ nodeId, inputKey }, value);
  }

  return cloned;
}

/**
 * 使用自定义工作流构建 ComfyUI 执行 payload。
 * 内部调用 injectParamsIntoWorkflow 做参数注入。
 */
export function buildCustomWorkflowPayload(
  preset: ComfyWorkflowPreset,
  prompt: string,
  options: Record<string, unknown>,
  imageConfig: Partial<ImageGenConfig>,
) {
  const { positivePrompt, negativePrompt } = resolveComfyMergedPrompts(prompt, options, imageConfig);
  const requestedSize = resolveRequestedImageSize(imageConfig, options);
  const width = (options.width as number) || requestedSize.width;
  const height = (options.height as number) || requestedSize.height;
  const seed = (options.seed as number) || imageConfig.seed || Math.floor(Math.random() * 4294967295);
  const steps = imageConfig.steps || 20;
  const cfgScale = imageConfig.scale || 7;
  const sampler_name = imageConfig.comfySampler || 'euler';
  const scheduler = imageConfig.comfyScheduler || 'normal';
  const model = imageConfig.comfyModel || '';

  const promptPayload = injectParamsIntoWorkflow(preset.workflow, preset.paramMapping, {
    positivePrompt,
    negativePrompt,
    width,
    height,
    seed,
    steps,
    cfgScale,
    sampler: sampler_name,
    scheduler,
    denoise: 1,
    batchSize: 1,
  });

  return {
    promptPayload,
    positivePrompt,
    negativePrompt,
    width,
    height,
    seed,
    steps,
    cfgScale,
    sampler_name,
    scheduler,
    model,
    vae: '',
    resultModelLabel: `ComfyUI [${preset.name}]: ${model}`,
    resultSamplerLabel: sampler_name,
  };
}

/** 判断是否应该使用自定义工作流 */
export function resolveComfyWorkflow(
  config: Partial<ImageGenConfig>,
): ComfyWorkflowPreset | null {
  if (!config.comfyUseCustomWorkflow || !config.comfyActiveWorkflowId) return null;
  return config.comfyWorkflowPresets?.find((p) => p.id === config.comfyActiveWorkflowId) || null;
}

export async function generateComfyUIImage(prompt: string, config: Partial<ImageGenConfig>): Promise<ImageGenResult> {
  const apiUrl = (config.comfyUrl || 'http://localhost:8188').replace(/\/$/, '');

  // 优先使用自定义工作流
  const customWorkflow = resolveComfyWorkflow(config);

  // 统一的执行参数
  let promptPayload: Record<string, Record<string, unknown>>;
  let positivePrompt: string;
  let negativePrompt: string;
  let width: number;
  let height: number;
  let seed: number;
  let steps: number;
  let cfgScale: number;
  let resultModelLabel: string;
  let resultSamplerLabel: string;

  if (customWorkflow) {
    // ── 新管线：拓扑感知注入 + 资源校验，绝不静默回退 ──
    const merged = resolveComfyMergedPrompts(prompt, {}, config);
    const requestedSize = resolveRequestedImageSize(config, {});
    positivePrompt = merged.positivePrompt;
    negativePrompt = merged.negativePrompt;
    width = requestedSize.width;
    height = requestedSize.height;
    seed = config.seed || Math.floor(Math.random() * 4294967295);
    steps = config.steps || 20;
    cfgScale = config.scale || 7;
    resultModelLabel = `ComfyUI [${customWorkflow.name}]: ${config.comfyModel || ''}`;
    resultSamplerLabel = config.comfySampler || 'euler';

    // 获取 object_info 用于资源校验
    const comfyData = await fetchComfyUIData(apiUrl);

    // 拓扑感知运行时注入（从 KSampler 正/负向输入反向回溯到真正的 CLIPTextEncode 节点）
    const injectedPrompt = applyRuntimeValuesToApiPrompt(
      customWorkflow.workflow as unknown as ApiPromptWorkflow,
      {
        positivePrompt,
        negativePrompt,
        width,
        height,
        seed,
        steps,
        cfg: cfgScale,
        sampler_name: config.comfySampler || 'euler',
        scheduler: config.comfyScheduler || 'normal',
        denoise: 1,
        model: config.comfyModel || '',
        vae: config.comfyVae || '',
      },
    );

    // 资源校验与修复（缺失 model/VAE 会抛出明确错误，不再静默回退到默认流）
    const validation = validateAndRepairComfyApiPromptResources(
      injectedPrompt,
      comfyData.objectInfo,
      {
        model: config.comfyModel || '',
        vae: config.comfyVae || '',
        sampler_name: config.comfySampler || 'euler',
        scheduler: config.comfyScheduler || 'normal',
      },
    );

    if (validation.unresolved.length > 0) {
      throw new Error(formatComfyWorkflowResourceValidationError(validation.unresolved));
    }

    if (validation.repaired.length > 0) {
      console.info(
        '[ComfyUI] 工作流资源已自动修复:',
        validation.repaired.map(
          (r) => `${r.nodeId}.${r.inputName}: ${r.from} → ${r.to}`,
        ),
      );
    }

    promptPayload = validation.prompt as unknown as Record<string, Record<string, unknown>>;
  } else {
    // ── 默认内置工作流 ──
    const execution = buildDefaultComfyExecutionPayload(prompt, {}, config);
    promptPayload = execution.promptPayload;
    positivePrompt = execution.positivePrompt;
    negativePrompt = execution.negativePrompt;
    width = execution.width;
    height = execution.height;
    seed = execution.seed;
    steps = execution.steps;
    cfgScale = execution.cfgScale;
    resultModelLabel = execution.resultModelLabel;
    resultSamplerLabel = execution.resultSamplerLabel;
  }

  const { url: promptUrl, headers: promptHeaders } = withProxy(`${apiUrl}/prompt`, {
    'Content-Type': 'application/json',
  });
  const res = await nativeFetch(promptUrl, {
    method: 'POST',
    headers: promptHeaders,
    body: JSON.stringify({ prompt: promptPayload }),
  });

  if (!res.ok) throw new Error(`ComfyUI 请求失败: ${res.statusText}`);

  const { prompt_id } = await res.json();

  return new Promise((resolve, reject) => {
    let attempts = 0;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 15; // 连续失败 15 次（15秒）判定服务端不可用
    let settled = false; // 防止重复 resolve/reject
    const poll = setInterval(async () => {
      if (settled) return;
      try {
        attempts += 1;
        if (attempts > 300) {
          clearInterval(poll);
          settled = true;
          reject(new Error('生成超时（5分钟）'));
          return;
        }

        const { url: historyUrl, headers: historyHeaders } = withProxy(`${apiUrl}/history/${prompt_id}`);
        const historyRes = await nativeFetch(historyUrl, { headers: historyHeaders });
        if (!historyRes.ok) {
          consecutiveErrors++;
          console.warn(`[ComfyUI] history 请求失败 (${historyRes.status}), attempt ${attempts}, 连续错误 ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}`);
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            clearInterval(poll);
            settled = true;
            reject(new Error(`ComfyUI 连续 ${MAX_CONSECUTIVE_ERRORS} 次请求失败，服务端可能已停止`));
          }
          return;
        }

        consecutiveErrors = 0; // 成功则重置连续错误计数
        const history = await historyRes.json();
        if (!history || !history[prompt_id]) return; // 还没完成

        clearInterval(poll);
        settled = true;

        const outputs = history[prompt_id].outputs;
        if (!outputs || typeof outputs !== 'object') {
          reject(new Error('ComfyUI 返回的 outputs 为空'));
          return;
        }

        for (const nodeId in outputs) {
          const nodeOutput = outputs[nodeId];
          if (nodeOutput?.images && nodeOutput.images.length > 0) {
            const image = nodeOutput.images[0];
            console.log(`[ComfyUI] 找到图片: ${image.filename}`);
            const { url: viewUrl, headers: viewHeaders } = withProxy(
              `${apiUrl}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder)}&type=${encodeURIComponent(image.type)}`,
            );
            const imgRes = await nativeFetch(viewUrl, { headers: viewHeaders });
            if (!imgRes.ok) {
              reject(new Error(`图片下载失败 (${imgRes.status})`));
              return;
            }
            const blob = await imgRes.blob();
            resolve({
              blob,
              seed,
              prompt: positivePrompt,
              negativePrompt,
              width,
              height,
              model: resultModelLabel,
              sampler: resultSamplerLabel,
              steps,
              scale: cfgScale,
            });
            return;
          }
        }
        reject(new Error('ComfyUI 输出中未找到图片'));
      } catch (e) {
        clearInterval(poll);
        settled = true;
        reject(e);
      }
    }, 1000);
  });
}

// ─── NovelAI ───

function parseStructuredPrompt(text: string) {
  const extractedText = text
    .replace(/```(?:json|text)?/gi, '')
    .replace(/```/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

  if (!extractedText) return null;

  const sectionRegex = /(scene(?:\s+composition)?|character\s*(\d+)\s*(prompt|uc)|uc|negative(?:\s*prompt)?)\s*[:：]/gi;
  const sectionMatches = Array.from(extractedText.matchAll(sectionRegex));
  if (!sectionMatches.length) return null;

  const result: {
    sceneComposition: string;
    characters: { prompt: string; uc: string; position: { x: number; y: number } | null }[];
    globalUC: string;
  } = { sceneComposition: '', characters: [], globalUC: '' };

  const charPrompts: Record<number, { prompt: string; uc: string; position: { x: number; y: number } | null }> = {};

  const colMap: Record<string, number> = { a: 0.1, b: 0.3, c: 0.5, d: 0.7, e: 0.9, A: 0.1, B: 0.3, C: 0.5, D: 0.7, E: 0.9 };
  const rowMap: Record<string, number> = { '1': 0.1, '2': 0.3, '3': 0.5, '4': 0.7, '5': 0.9 };

  const extractCenters = (content: string) => {
    const match = content.match(/\|centers:\s*([A-Ea-e][1-5])/i);
    if (!match) return { content, pos: null };
    let cleanContent = content.replace(match[0], '').trim();
    cleanContent = cleanContent.replace(/;$/, '').trim();
    const coord = match[1];
    const x = colMap[coord[0]];
    const y = rowMap[coord[1]];
    const pos = x !== undefined && y !== undefined ? { x, y } : null;
    return { content: cleanContent, pos };
  };

  const normalizeSectionContent = (content: string, { negative = false } = {}) => {
    if (!content) return '';
    const cleanedContent = String(content)
      .replace(/^[\s,;；]+/, '')
      .replace(/[;；]+\s*$/, '')
      .replace(/^```|```$/g, '')
      .trim();
    if (!cleanedContent) return '';
    return negative ? normalizeNegativePrompt(cleanedContent) : normalizePromptText(cleanedContent);
  };

  const getSectionContent = (index: number, negative = false) => {
    const currentMatch = sectionMatches[index];
    const nextMatch = sectionMatches[index + 1];
    const contentStart = currentMatch.index! + currentMatch[0].length;
    const contentEnd = nextMatch ? nextMatch.index! : extractedText.length;
    return normalizeSectionContent(extractedText.slice(contentStart, contentEnd), { negative });
  };

  const ensureCharacter = (num: number) => {
    if (!charPrompts[num]) charPrompts[num] = { prompt: '', uc: '', position: null };
    return charPrompts[num];
  };

  sectionMatches.forEach((match, index) => {
    const sectionLabel = String(match[1] || '').toLowerCase();
    const charNum = match[2] ? parseInt(match[2], 10) : 0;
    const charSectionType = String(match[3] || '').toLowerCase();

    if (sectionLabel.startsWith('scene')) {
      const content = getSectionContent(index);
      if (content) result.sceneComposition = mergePromptTags(result.sceneComposition, content);
      return;
    }

    if (sectionLabel.startsWith('character') && charNum) {
      const currentChar = ensureCharacter(charNum);
      if (charSectionType === 'prompt') {
        const { content, pos } = extractCenters(getSectionContent(index));
        currentChar.prompt = mergePromptTags(currentChar.prompt, content);
        if (pos) currentChar.position = pos;
      } else if (charSectionType === 'uc') {
        currentChar.uc = mergePromptTags(currentChar.uc, getSectionContent(index, true));
      }
      return;
    }

    if (/^(uc|negative(?:\s*prompt)?)$/i.test(sectionLabel)) {
      const content = getSectionContent(index, true);
      if (content) result.globalUC = mergePromptTags(result.globalUC, content);
    }
  });

  result.characters = Object.keys(charPrompts)
    .map((num) => parseInt(num, 10))
    .filter((num) => Number.isFinite(num))
    .sort((a, b) => a - b)
    .map((num) => charPrompts[num])
    .filter((char) => char.prompt);

  return result.sceneComposition || result.characters.length || result.globalUC ? result : null;
}

export async function generateNovelAIImage(prompt: string, config: Partial<ImageGenConfig>): Promise<ImageGenResult> {
  const apiKey = config.apiKey;
  if (!apiKey) throw new Error('未配置 NovelAI API Key');

  const rawPromptText = String(prompt ?? '');
  const globalPositivePrompt = normalizePositivePrompt(config?.positivePrompt || '');
  const { positivePrompt, negativePrompt } = resolveMergedPrompts(prompt, {}, config);
  if (!positivePrompt) throw new Error('正面提示词不能为空');

  const model = config.model || 'nai-diffusion-4-5-full';
  const requestedSize = resolveRequestedImageSize(config);
  const width = requestedSize.width;
  const height = requestedSize.height;
  const scale = config.scale ?? 5;
  const sampler = config.sampler || 'k_euler_ancestral';
  const steps = config.steps || 28;
  const seed = config.seed || Math.floor(Math.random() * 4294967295);
  const varietyPlus = config.varietyPlus !== false;
  const cfgRescale = config.cfgRescale ?? 0;
  const qualityToggle = config.qualityToggle !== false;
  const ucPreset = Number.isFinite(Number(config.ucPreset))
    ? Math.min(4, Math.max(0, Math.floor(Number(config.ucPreset))))
    : 4;
  const noiseSchedule = config.noiseSchedule || 'karras';

  const isV4Model = model.includes('v4') || model.includes('4-5') || model.includes('4-full') || model.includes('4-curated') || model.includes('nai-diffusion-4');
  const isV45Model = model.includes('4-5');

  const calculateSkipCfgAboveSigma = (w: number, h: number, isV45: boolean) => {
    const magicConstant = isV45 ? 58 : 19;
    const referencePixelCount = 1011712;
    const pixelCount = w * h;
    const ratio = pixelCount / referencePixelCount;
    return Math.pow(ratio, 0.5) * magicConstant;
  };

  const parsedPrompt = isV4Model ? parseStructuredPrompt(rawPromptText) : null;
  let finalInput = positivePrompt;
  let finalNegativePrompt = negativePrompt;
  let baseCaption = '';
  if (qualityToggle) {
    baseCaption = 'masterpiece, best quality, very aesthetic, absurdres';
  }

  const requestBody: Record<string, unknown> = {
    input: positivePrompt,
    model,
    action: 'generate',
    parameters: {
      params_version: 3,
      width,
      height,
      scale,
      sampler,
      steps,
      seed,
      n_samples: 1,
      skip_cfg_above_sigma: varietyPlus ? calculateSkipCfgAboveSigma(width, height, isV45Model) : null,
      cfg_rescale: cfgRescale,
      qualityToggle,
      ucPreset,
      sm: false,
      sm_dyn: false,
      dynamic_thresholding: false,
      controlnet_strength: 1,
      legacy: false,
      add_original_image: true,
      uncond_scale: 1,
      noise_schedule: noiseSchedule,
      negative_prompt: negativePrompt,
      deliberate_euler_ancestral_bug: false,
      prefer_brownian: true,
    },
  };

  if (isV4Model) {
    if (parsedPrompt) {
      let sceneComp = mergePromptTags(globalPositivePrompt, parsedPrompt.sceneComposition);
      if (baseCaption) sceneComp = mergePromptTags(baseCaption, sceneComp);

      const globalUc = mergePromptTags(parsedPrompt.globalUC, negativePrompt) || negativePrompt;
      finalInput = sceneComp || positivePrompt;
      finalNegativePrompt = globalUc;
      requestBody.input = finalInput;
      (requestBody.parameters as Record<string, unknown>).negative_prompt = finalNegativePrompt;

      const charCaptions: { char_caption: string; centers: { x: number; y: number }[] }[] = [];
      const negCharCaptions: { char_caption: string; centers: { x: number; y: number }[] }[] = [];
      let useCoords = false;

      parsedPrompt.characters.forEach((char) => {
        const centers = char.position
          ? [{ x: char.position.x, y: char.position.y }]
          : [{ x: 0.5, y: 0.5 }];
        charCaptions.push({ char_caption: char.prompt, centers });
        negCharCaptions.push({ char_caption: char.uc || 'background characters', centers: centers.map((p) => ({ ...p })) });
        if (char.position) useCoords = true;
      });

      (requestBody.parameters as Record<string, unknown>).v4_prompt = {
        caption: { base_caption: sceneComp, char_captions: charCaptions },
        use_coords: useCoords,
        use_order: true,
      };
      (requestBody.parameters as Record<string, unknown>).v4_negative_prompt = {
        caption: { base_caption: globalUc, char_captions: negCharCaptions },
      };
    } else {
      let sceneComp = baseCaption ? mergePromptTags(baseCaption, positivePrompt) : positivePrompt;
      finalInput = sceneComp;
      finalNegativePrompt = negativePrompt;
      requestBody.input = sceneComp;
      (requestBody.parameters as Record<string, unknown>).negative_prompt = negativePrompt;
      (requestBody.parameters as Record<string, unknown>).v4_prompt = {
        caption: { base_caption: sceneComp, char_captions: [] },
        use_coords: false,
        use_order: true,
      };
      (requestBody.parameters as Record<string, unknown>).v4_negative_prompt = {
        caption: { base_caption: negativePrompt, char_captions: [] },
      };
    }
  }

  const endpoint = 'https://image.novelai.net/ai/generate-image';
  const { url: naiUrl, headers: naiHeaders } = withProxy(endpoint, {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  });
  const resp = await nativeFetch(naiUrl, {
    method: 'POST',
    headers: naiHeaders,
    body: JSON.stringify(requestBody),
  });

  if (!resp.ok) {
    let errMsg = `NAI API Error (${resp.status})`;
    try {
      const errData = await resp.json();
      errMsg = errData.message || errMsg;
    } catch {
      errMsg += ': ' + (await resp.text().catch(() => resp.statusText));
    }
    throw new Error(errMsg);
  }

  // 响应是 ZIP 文件，需要解压（动态导入 JSZip，~96KB）
  const { default: JSZip } = await import('jszip');
  const arrayBuffer = await resp.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const imageFile = Object.values(zip.files).find(
    (f) => !f.dir && (f.name.endsWith('.png') || f.name.endsWith('.jpg') || f.name.endsWith('.webp')),
  );

  if (!imageFile) throw new Error('ZIP 中未找到图片文件');

  const imageBlob = await imageFile.async('blob');

  return {
    blob: imageBlob,
    seed,
    prompt: finalInput,
    negativePrompt: finalNegativePrompt,
    width,
    height,
    model,
    sampler,
    steps,
    scale,
  };
}

// ─── OpenAI Compatible ───

export async function generateOpenAICompatibleImage(prompt: string, config: Partial<ImageGenConfig>): Promise<ImageGenResult> {
  const provider = config.openaiCompatibleProvider || 'openai';
  const endpoint = normalizeOpenAICompatibleApiUrl(config.openaiCompatibleApiUrl || '', provider);
  const apiKey = String(config.openaiCompatibleApiKey || '').trim();
  const model = String(config.openaiCompatibleModel || '').trim();
  const providerInfo = getOpenAICompatibleProviderInfo(provider);
  const { positivePrompt, negativePrompt } = resolveOpenAICompatibleMergedPrompts(prompt, {}, config);

  if (!endpoint) throw new Error('未配置其他生图地址');
  if (!apiKey) throw new Error('未配置其他生图 API Key');
  if (!model) throw new Error('未配置其他生图模型');
  if (!positivePrompt) throw new Error('正面提示词不能为空');

  const requestedSize = resolveRequestedImageSize(config);
  const { width, height, size } = resolveOpenAICompatibleSize(requestedSize.width, requestedSize.height);

  const requestBody: Record<string, unknown> = {
    model,
    prompt: positivePrompt,
    n: 1,
    size,
    response_format: 'b64_json',
  };

  if (negativePrompt) requestBody.negative_prompt = negativePrompt;

  const { url: oaiUrl, headers: oaiHeaders } = withProxy(endpoint, {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  });
  const resp = await nativeFetch(oaiUrl, {
    method: 'POST',
    headers: oaiHeaders,
    body: JSON.stringify(requestBody),
  });

  const rawText = await resp.text();
  let responseData: Record<string, unknown> = {};

  if (rawText) {
    try {
      responseData = JSON.parse(rawText);
    } catch {
      if (!resp.ok) throw new Error(`其他生图请求失败 (${resp.status}): ${rawText || resp.statusText}`);
      throw new Error('其他生图返回了无法解析的响应');
    }
  }

  if (!resp.ok) {
    const errorMessage =
      (responseData?.error as { message?: string })?.message ||
      (responseData?.message as string) ||
      rawText ||
      `其他生图请求失败 (${resp.status})`;
    throw new Error(errorMessage);
  }

  const data = responseData?.data as unknown[] | undefined;
  const images = responseData?.images as unknown[] | undefined;
  const firstData = Array.isArray(data) ? data[0] : Array.isArray(images) ? images[0] : responseData?.data || responseData?.image || null;

  let imageBlob: Blob | null = null;

  const firstDataObj = firstData as Record<string, unknown> | null;
  if (firstDataObj?.b64_json || responseData?.b64_json) {
    imageBlob = createBlobFromBase64(
      (firstDataObj?.b64_json || responseData?.b64_json) as string,
      (firstDataObj?.mime_type as string) || (responseData?.mime_type as string) || 'image/png',
    );
  } else {
    const imageUrl =
      (firstDataObj?.url as string) ||
      (responseData?.url as string) ||
      (typeof firstData === 'string' && /^https?:\/\//i.test(firstData) ? firstData : '');

    if (imageUrl) {
      const { url: dlUrl, headers: dlHeaders } = withProxy(imageUrl);
      const imageResp = await nativeFetch(dlUrl, { headers: dlHeaders });
      if (!imageResp.ok) throw new Error('其他生图返回的图片地址无法下载');
      imageBlob = await imageResp.blob();
    }
  }

  if (!imageBlob) throw new Error('其他生图未返回可用图片数据');

  return {
    blob: imageBlob,
    seed: null,
    prompt: positivePrompt,
    negativePrompt,
    width,
    height,
    model: `${providerInfo.label}: ${model}`,
    sampler: 'OpenAI Compatible',
    steps: null,
    scale: null,
  };
}

// ─── 路由函数 ───

export async function generateConfiguredImage(prompt: string, config: Partial<ImageGenConfig>): Promise<ImageGenResult> {
  if (config.engine === 'comfyui') return generateComfyUIImage(prompt, config);
  if (config.engine === 'openai_compatible') return generateOpenAICompatibleImage(prompt, config);
  return generateNovelAIImage(prompt, config);
}
