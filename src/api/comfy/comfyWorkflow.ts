// ComfyUI 工作流核心管线
// 提供：格式自动检测、标准 workflow → API prompt 转换、拓扑感知运行时注入、资源校验与修复
// 框架无关，不含任何 React/Vue 依赖

// ─── 类型定义 ───

/** API Prompt 格式节点 */
export interface ApiPromptNode {
  class_type: string;
  inputs: Record<string, unknown>;
}

/** API Prompt 格式工作流（/prompt 端点所需格式） */
export type ApiPromptWorkflow = Record<string, ApiPromptNode>;

/** 标准 workflow 格式节点（ComfyUI UI 导出格式） */
export interface StandardWorkflowNode {
  id: number | string;
  type?: string;
  class_type?: string;
  properties?: Record<string, unknown>;
  inputs?: Array<{ name?: string; link?: number | null }>;
  widgets_values?: unknown[] | Record<string, unknown>;
  [key: string]: unknown;
}

/** 标准 workflow 格式 */
export interface StandardWorkflow {
  nodes: StandardWorkflowNode[];
  links?: unknown[];
  [key: string]: unknown;
}

/** 链接信息 */
interface WorkflowLink {
  id: number;
  originId: string;
  originSlot: number;
  targetId: string;
  targetSlot: number;
  type: unknown;
}

/** 运行时注入参数 */
export interface ComfyRuntimeValues {
  positivePrompt?: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  seed?: number;
  steps?: number;
  cfg?: number;
  sampler_name?: string;
  scheduler?: string;
  denoise?: number;
  model?: string;
  vae?: string;
}

/** 资源校验结果 */
export interface ResourceValidationResult {
  prompt: ApiPromptWorkflow;
  repaired: Array<{
    nodeId: string;
    classType: string;
    inputName: string;
    from: string;
    to: string;
  }>;
  unresolved: Array<{
    nodeId: string;
    classType: string;
    inputName: string;
    assetLabel: string;
    currentValue: string;
    options: string[];
  }>;
}

/** 格式检测结果 */
export interface DetectedPayload {
  format: 'standard_workflow' | 'api_prompt';
  apiPrompt: ApiPromptWorkflow | null;
  workflow: StandardWorkflow | null;
}

/** 工作流摘要 */
export interface ComfyWorkflowSummary {
  format: string;
  formatLabel: string;
  nodeCount: number;
  samplerCount: number;
  topClassTypes: Array<[string, number]>;
  summaryItems: Array<{ label: string; value: string }>;
}

/** 导入的工作流记录 */
export interface ImportedComfyWorkflowRecord {
  primaryFormat: 'standard_workflow' | 'api_prompt';
  primaryData: StandardWorkflow | ApiPromptWorkflow;
  apiPrompt: ApiPromptWorkflow;
  uiWorkflow: StandardWorkflow | null;
  summaryItems: Array<{ label: string; value: string }>;
  meta: {
    source: string;
    fileName: string;
    fileBaseName: string;
    updatedAt: number;
    nodeCount: number;
    samplerCount: number;
    formatLabel: string;
  };
}

// ─── 内部工具函数 ───

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneSerializable<T>(value: T, fallback: T | null = null): T {
  if (value === undefined) return fallback as T;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    console.warn('克隆 ComfyUI 工作流数据失败，将回退到原值');
    return fallback ?? value;
  }
}

function safeTrim(value: unknown, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function parseJsonString(text: string, label = 'JSON'): unknown {
  const normalized = safeTrim(text);
  if (!normalized) {
    throw new Error(`${label} 内容为空`);
  }
  try {
    return JSON.parse(normalized);
  } catch (error) {
    throw new Error(`${label} 解析失败: ${(error as Error).message}`);
  }
}

function normalizeNodeId(value: unknown): string {
  return safeTrim(value);
}

function normalizeNumber(value: unknown, fallback: number | null = null): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isConnectionValue(value: unknown): value is [string, number] {
  return Array.isArray(value) && value.length >= 2 && Boolean(normalizeNodeId(value[0]));
}

function isApiPromptNode(value: unknown): value is ApiPromptNode {
  return (
    isPlainObject(value) &&
    typeof value.class_type === 'string' &&
    isPlainObject(value.inputs)
  );
}

function getWorkflowNodeClassType(node: unknown): string {
  if (!isPlainObject(node)) return '';
  return safeTrim(
    node.type ||
      (node as Record<string, unknown>).class_type ||
      (isPlainObject(node.properties)
        ? node.properties['Node name for S&R'] || node.properties['Node name']
        : '') ||
      '',
  );
}

function getWorkflowNodeSchema(
  objectInfo: Record<string, unknown>,
  classType: string,
): Record<string, unknown> {
  const info = isPlainObject(objectInfo) ? objectInfo : {};
  const nodeInfo = info[classType];
  if (!isPlainObject(nodeInfo)) return {};
  const schema = (nodeInfo as Record<string, unknown>).input;
  return isPlainObject(schema) ? (schema as Record<string, unknown>) : {};
}

function getSchemaEntry(schema: Record<string, unknown>, key: string): unknown {
  if (!isPlainObject(schema)) return null;
  const required = (schema as Record<string, unknown>).required;
  if (isPlainObject(required) && key in required) return required[key];
  const optional = (schema as Record<string, unknown>).optional;
  if (isPlainObject(optional) && key in optional) return optional[key];
  const hidden = (schema as Record<string, unknown>).hidden;
  if (isPlainObject(hidden) && key in hidden) return hidden[key];
  return null;
}

function getOrderedSchemaInputKeys(schema: Record<string, unknown>): string[] {
  const keys: string[] = [];
  const required = (schema as Record<string, unknown>).required;
  if (isPlainObject(required)) {
    keys.push(...Object.keys(required));
  }
  const optional = (schema as Record<string, unknown>).optional;
  if (isPlainObject(optional)) {
    keys.push(...Object.keys(optional));
  }
  return keys;
}

function isLikelyWidgetOnlyValue(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^(fixed|increment|decrement|randomize|keep|enable|disable)$/i.test(value.trim())
  );
}

function isWidgetValueCompatible(
  value: unknown,
  schemaEntry: unknown,
  inputName = '',
): boolean {
  if (value === undefined) return false;
  if (schemaEntry == null) return true;

  const mainType = Array.isArray(schemaEntry) ? schemaEntry[0] : schemaEntry;

  if (Array.isArray(mainType)) {
    if (mainType.length === 0) return true;
    if (mainType.includes(value)) return true;
    const sample = mainType.find((item) => item !== undefined && item !== null);
    if (sample === undefined) return true;
    return typeof value === typeof sample;
  }

  const normalizedType = safeTrim(mainType).toUpperCase();
  if (!normalizedType) return true;

  if (
    [
      'MODEL',
      'CLIP',
      'CONDITIONING',
      'LATENT',
      'VAE',
      'IMAGE',
      'MASK',
      'SAMPLER',
      'SIGMAS',
      'GUIDER',
      'NOISE',
    ].includes(normalizedType)
  ) {
    return false;
  }

  if (normalizedType === 'INT') {
    return typeof value === 'number' && Number.isFinite(value);
  }

  if (normalizedType === 'FLOAT' || normalizedType === 'NUMBER') {
    return typeof value === 'number' && Number.isFinite(value);
  }

  if (normalizedType === 'BOOLEAN') {
    return typeof value === 'boolean';
  }

  if (normalizedType === 'STRING' || normalizedType === 'TEXT') {
    return typeof value === 'string';
  }

  if (inputName === 'seed' && isLikelyWidgetOnlyValue(value)) {
    return false;
  }

  return true;
}

function buildWorkflowLinkMap(links: unknown[] = []): Map<number, WorkflowLink> {
  const map = new Map<number, WorkflowLink>();
  if (!Array.isArray(links)) return map;

  links.forEach((entry) => {
    if (Array.isArray(entry) && entry.length >= 5) {
      const linkId = normalizeNumber(entry[0], null);
      if (linkId == null) return;
      map.set(linkId, {
        id: linkId,
        originId: normalizeNodeId(entry[1]),
        originSlot: normalizeNumber(entry[2], 0) ?? 0,
        targetId: normalizeNodeId(entry[3]),
        targetSlot: normalizeNumber(entry[4], 0) ?? 0,
        type: entry[5],
      });
      return;
    }

    if (isPlainObject(entry)) {
      const linkId = normalizeNumber(entry.id, null);
      if (linkId == null) return;
      map.set(linkId, {
        id: linkId,
        originId: normalizeNodeId(entry.origin_id ?? entry.originId ?? entry.from_node),
        originSlot: normalizeNumber(entry.origin_slot ?? entry.originSlot ?? entry.from_slot, 0) ?? 0,
        targetId: normalizeNodeId(entry.target_id ?? entry.targetId ?? entry.to_node),
        targetSlot: normalizeNumber(entry.target_slot ?? entry.targetSlot ?? entry.to_slot, 0) ?? 0,
        type: entry.type,
      });
    }
  });

  return map;
}

function mapWidgetValuesToInputs(
  node: StandardWorkflowNode,
  classType: string,
  objectInfo: Record<string, unknown>,
  linkedInputNames: Set<string>,
): Record<string, unknown> {
  const schema = getWorkflowNodeSchema(objectInfo, classType);
  const orderedKeys = getOrderedSchemaInputKeys(schema).filter((key) => !linkedInputNames.has(key));

  if (!orderedKeys.length) {
    return {};
  }

  const widgetsValues = node?.widgets_values;

  if (isPlainObject(widgetsValues)) {
    const mapped: Record<string, unknown> = {};
    Object.entries(widgetsValues).forEach(([key, value]) => {
      if (!linkedInputNames.has(key)) {
        mapped[key] = cloneSerializable(value, value);
      }
    });
    return mapped;
  }

  if (!Array.isArray(widgetsValues) || widgetsValues.length === 0) {
    return {};
  }

  const mapped: Record<string, unknown> = {};
  let valueIndex = 0;

  orderedKeys.forEach((key) => {
    const schemaEntry = getSchemaEntry(schema, key);

    while (valueIndex < widgetsValues.length) {
      const currentValue = widgetsValues[valueIndex];
      if (isWidgetValueCompatible(currentValue, schemaEntry, key)) {
        mapped[key] = cloneSerializable(currentValue, currentValue);
        valueIndex += 1;
        return;
      }
      valueIndex += 1;
    }
  });

  return mapped;
}

function replaceTemplateTokens(text: string, context: Record<string, unknown>): string {
  return String(text).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
    if (!(key in context)) return match;
    const value = context[key];
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

function replaceTemplateDeep(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    return replaceTemplateTokens(value, context);
  }

  if (Array.isArray(value)) {
    return value.map((item) => replaceTemplateDeep(item, context));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceTemplateDeep(item, context)]),
    );
  }

  return value;
}

function walkPromptGraph(
  apiPrompt: ApiPromptWorkflow,
  startNodeId: string,
  visitor: (node: ApiPromptNode, nodeId: string, depth: number) => void,
  visited: Set<string> = new Set(),
  depth = 0,
): void {
  const normalizedId = normalizeNodeId(startNodeId);
  if (!normalizedId || visited.has(normalizedId) || depth > 24) return;

  const node = apiPrompt?.[normalizedId];
  if (!isPlainObject(node)) return;

  visited.add(normalizedId);
  visitor(node as ApiPromptNode, normalizedId, depth);

  const nodeInputs = isPlainObject(node.inputs) ? (node.inputs as Record<string, unknown>) : {};
  Object.values(nodeInputs).forEach((inputValue) => {
    if (!isConnectionValue(inputValue)) return;
    walkPromptGraph(apiPrompt, inputValue[0], visitor, visited, depth + 1);
  });
}

const PROMPT_INPUT_SKIP_KEY_RE =
  /(?:filename|prefix|suffix|path|folder|directory|ext|extension|mode|type|format|device|ckpt|checkpoint|vae|lora|sampler|scheduler|seed|steps|cfg|denoise|width|height|batch|image|model|clip|latent|conditioning|strength|weight|ratio|resolution|quality|style|preset)$/i;
const GENERIC_PROMPT_INPUT_KEY_RE =
  /(?:^|_)(?:text|prompt|main_prompt|input_prompt|prompt_text|prompt_input|tags|tag|tag_label|caption)(?:$|_)/i;
const POSITIVE_PROMPT_INPUT_KEY_RE =
  /(?:^|_)(?:positive|pos|positive_prompt|positive_tags|positive_text)(?:$|_)/i;
const NEGATIVE_PROMPT_INPUT_KEY_RE =
  /(?:^|_)(?:negative|neg|uc|uncond|forbidden|exclude|bad_tags|negative_prompt|negative_tags|negative_text)(?:$|_)/i;
const PROMPT_PLACEHOLDER_RE = /\{\{\s*(?:prompt|positivePrompt|negativePrompt|negative)\s*\}\}/i;

function collectEditablePromptInputs(
  nodeInputs: Record<string, unknown> = {},
): Array<[string, unknown]> {
  return Object.entries(nodeInputs).filter(([key, value]) => {
    if (typeof value !== 'string') return false;
    if (PROMPT_PLACEHOLDER_RE.test(value)) return true;
    return !PROMPT_INPUT_SKIP_KEY_RE.test(String(key || ''));
  });
}

function isLikelyPromptCarrierNode(node: ApiPromptNode): boolean {
  const classType = safeTrim(node?.class_type);
  return /textencode|prompt|conditioning/i.test(classType);
}

function collectExplicitPromptTargets(
  nodeInputs: Record<string, unknown>,
  mode: 'positive' | 'negative' = 'positive',
  options: { allowGeneric?: boolean } = {},
): Array<[string, string]> {
  const editableInputs = collectEditablePromptInputs(nodeInputs);
  if (!editableInputs.length) return [];

  const allowGeneric = options.allowGeneric !== false;
  const matcher = mode === 'negative' ? NEGATIVE_PROMPT_INPUT_KEY_RE : POSITIVE_PROMPT_INPUT_KEY_RE;

  return editableInputs.filter(([key, value]) => {
    const inputKey = String(key || '');
    if (typeof value !== 'string') return false;
    if (PROMPT_PLACEHOLDER_RE.test(value)) return true;
    if (matcher.test(inputKey)) return true;
    if (allowGeneric && !NEGATIVE_PROMPT_INPUT_KEY_RE.test(inputKey) && GENERIC_PROMPT_INPUT_KEY_RE.test(inputKey)) {
      return true;
    }
    return false;
  }) as Array<[string, string]>;
}

function updateBranchPromptInputs(
  node: ApiPromptNode,
  promptText: string,
  mode: 'positive' | 'negative' = 'positive',
): boolean {
  const nodeInputs = isPlainObject(node?.inputs) ? (node.inputs as Record<string, unknown>) : null;
  if (!nodeInputs) return false;

  let targets = collectExplicitPromptTargets(nodeInputs, mode, { allowGeneric: true });

  if (!targets.length && isLikelyPromptCarrierNode(node)) {
    targets = collectEditablePromptInputs(nodeInputs) as Array<[string, string]>;
  }

  if (!targets.length) return false;

  targets.forEach(([key]) => {
    nodeInputs[key] = promptText;
  });
  return true;
}

function updateTextInputsInBranch(
  apiPrompt: ApiPromptWorkflow,
  startNodeId: string,
  textValue: string,
  mode: 'positive' | 'negative' = 'positive',
): void {
  const safeText = safeTrim(textValue);
  if (!safeText) return;

  walkPromptGraph(apiPrompt, startNodeId, (node) => {
    if (!isPlainObject(node.inputs)) return;
    updateBranchPromptInputs(node, safeText, mode);
  });
}

function applyDirectPromptInputs(apiPrompt: ApiPromptWorkflow, runtime: ComfyRuntimeValues = {}): void {
  const positivePrompt = safeTrim(runtime.positivePrompt);
  const negativePrompt = safeTrim(runtime.negativePrompt);

  Object.values(apiPrompt).forEach((node) => {
    if (!isApiPromptNode(node) || !isPlainObject(node.inputs)) return;
    const inputs = node.inputs as Record<string, unknown>;

    if (positivePrompt) {
      const positiveTargets = collectExplicitPromptTargets(inputs, 'positive', { allowGeneric: false });
      positiveTargets.forEach(([key]) => {
        inputs[key] = positivePrompt;
      });
    }

    if (negativePrompt) {
      const negativeTargets = collectExplicitPromptTargets(inputs, 'negative', { allowGeneric: false });
      negativeTargets.forEach(([key]) => {
        inputs[key] = negativePrompt;
      });
    }
  });
}

function applyConnectedPromptInputs(apiPrompt: ApiPromptWorkflow, runtime: ComfyRuntimeValues = {}): void {
  const positivePrompt = safeTrim(runtime.positivePrompt);
  const negativePrompt = safeTrim(runtime.negativePrompt);

  Object.values(apiPrompt).forEach((node) => {
    if (!isApiPromptNode(node) || !isPlainObject(node.inputs)) return;
    const inputs = node.inputs as Record<string, unknown>;

    Object.entries(inputs).forEach(([key, value]) => {
      if (!isConnectionValue(value)) return;
      const inputKey = String(key || '');

      if (
        positivePrompt &&
        POSITIVE_PROMPT_INPUT_KEY_RE.test(inputKey) &&
        !NEGATIVE_PROMPT_INPUT_KEY_RE.test(inputKey)
      ) {
        updateTextInputsInBranch(apiPrompt, value[0], positivePrompt, 'positive');
      }

      if (negativePrompt && NEGATIVE_PROMPT_INPUT_KEY_RE.test(inputKey)) {
        updateTextInputsInBranch(apiPrompt, value[0], negativePrompt, 'negative');
      }
    });
  });
}

function collectReachableBranchNodeIds(
  apiPrompt: ApiPromptWorkflow,
  mode: 'positive' | 'negative' = 'positive',
): Set<string> {
  const branchNodeIds = new Set<string>();
  const matcher = mode === 'negative' ? NEGATIVE_PROMPT_INPUT_KEY_RE : POSITIVE_PROMPT_INPUT_KEY_RE;

  Object.values(apiPrompt).forEach((node) => {
    if (!isApiPromptNode(node) || !isPlainObject(node.inputs)) return;
    const inputs = node.inputs as Record<string, unknown>;

    Object.entries(inputs).forEach(([key, value]) => {
      if (!isConnectionValue(value)) return;
      const inputKey = String(key || '');
      if (!matcher.test(inputKey)) return;
      if (mode === 'positive' && NEGATIVE_PROMPT_INPUT_KEY_RE.test(inputKey)) return;

      walkPromptGraph(
        apiPrompt,
        value[0],
        (_, nodeId) => {
          branchNodeIds.add(nodeId);
        },
      );
    });
  });

  return branchNodeIds;
}

function applyReachablePromptFallbacks(apiPrompt: ApiPromptWorkflow, runtime: ComfyRuntimeValues = {}): void {
  const positivePrompt = safeTrim(runtime.positivePrompt);
  const negativePrompt = safeTrim(runtime.negativePrompt);

  if (positivePrompt) {
    collectReachableBranchNodeIds(apiPrompt, 'positive').forEach((nodeId) => {
      const node = apiPrompt?.[nodeId];
      if (!isApiPromptNode(node) || !isLikelyPromptCarrierNode(node)) return;
      const inputs = node.inputs as Record<string, unknown>;
      if (typeof inputs?.text === 'string') {
        inputs.text = positivePrompt;
        return;
      }
      updateBranchPromptInputs(node, positivePrompt, 'positive');
    });
  }

  if (negativePrompt) {
    collectReachableBranchNodeIds(apiPrompt, 'negative').forEach((nodeId) => {
      const node = apiPrompt?.[nodeId];
      if (!isApiPromptNode(node) || !isLikelyPromptCarrierNode(node)) return;
      const inputs = node.inputs as Record<string, unknown>;
      if (typeof inputs?.text === 'string') {
        inputs.text = negativePrompt;
        return;
      }
      updateBranchPromptInputs(node, negativePrompt, 'negative');
    });
  }
}

function updateSizeInputsInBranch(
  apiPrompt: ApiPromptWorkflow,
  startNodeId: string,
  width: number,
  height: number,
): void {
  if (!Number.isFinite(Number(width)) || !Number.isFinite(Number(height))) return;

  walkPromptGraph(apiPrompt, startNodeId, (node) => {
    if (!isPlainObject(node.inputs)) return;
    const inputs = node.inputs as Record<string, unknown>;
    if (typeof inputs.width === 'number' || typeof inputs.width === 'string') {
      inputs.width = Number(width);
    }
    if (typeof inputs.height === 'number' || typeof inputs.height === 'string') {
      inputs.height = Number(height);
    }
  });
}

function updateSamplerRuntimeInputs(node: ApiPromptNode, runtime: ComfyRuntimeValues = {}): void {
  if (!isPlainObject(node.inputs)) return;
  const inputs = node.inputs as Record<string, unknown>;

  if ('seed' in inputs && Number.isFinite(Number(runtime.seed))) {
    inputs.seed = Number(runtime.seed);
  }
  if ('steps' in inputs && Number.isFinite(Number(runtime.steps))) {
    inputs.steps = Number(runtime.steps);
  }
  if ('cfg' in inputs && Number.isFinite(Number(runtime.cfg))) {
    inputs.cfg = Number(runtime.cfg);
  }
  if ('sampler_name' in inputs && safeTrim(runtime.sampler_name)) {
    inputs.sampler_name = safeTrim(runtime.sampler_name);
  }
  if ('scheduler' in inputs && safeTrim(runtime.scheduler)) {
    inputs.scheduler = safeTrim(runtime.scheduler);
  }
  if ('denoise' in inputs && Number.isFinite(Number(runtime.denoise))) {
    inputs.denoise = Number(runtime.denoise);
  }
}

function countNodeClasses(apiPrompt: ApiPromptWorkflow = {}): Array<[string, number]> {
  const counter = new Map<string, number>();
  Object.values(apiPrompt).forEach((node) => {
    if (!isApiPromptNode(node)) return;
    const classType = safeTrim(node.class_type, '未知节点');
    counter.set(classType, (counter.get(classType) || 0) + 1);
  });
  return Array.from(counter.entries()).sort((a, b) => b[1] - a[1]);
}

function sanitizeFileBaseName(fileName = '', fallback = 'comfyui_workflow'): string {
  const base = safeTrim(fileName, fallback).replace(/\.[^.]+$/, '');
  return base.replace(/[\\/:*?"<>|]/g, '_') || fallback;
}

function getSchemaValueOptions(schemaEntry: unknown): string[] | null {
  if (!Array.isArray(schemaEntry) || schemaEntry.length === 0) return null;
  const mainType = schemaEntry[0];
  if (!Array.isArray(mainType) || mainType.length === 0) return null;
  return mainType.every((item) => typeof item === 'string') ? mainType : null;
}

function getWorkflowAssetLabel(inputName = ''): string {
  const key = safeTrim(inputName);
  if (key === 'ckpt_name') return 'Checkpoint 模型';
  if (key === 'vae_name') return 'VAE';
  if (key === 'control_net_name') return 'ControlNet';
  if (key === 'lora_name') return 'Lora';
  if (key === 'sampler_name') return '采样器';
  if (key === 'scheduler') return '调度器';
  if (key === 'model_name') return '模型资源';
  return key || '资源';
}

function resolveWorkflowEnumFallback(
  inputName: string,
  options: string[],
  runtime: ComfyRuntimeValues,
): string {
  const safeOptions = Array.isArray(options) ? options : [];
  if (!safeOptions.length) return '';

  let candidate = '';

  if (inputName === 'ckpt_name') {
    candidate = safeTrim(runtime.model);
  } else if (inputName === 'vae_name') {
    candidate = runtime.vae === 'baked' ? '' : safeTrim(runtime.vae);
  } else if (inputName === 'sampler_name') {
    candidate = safeTrim(runtime.sampler_name);
  } else if (inputName === 'scheduler') {
    candidate = safeTrim(runtime.scheduler);
  }

  if (candidate && safeOptions.includes(candidate)) {
    return candidate;
  }

  if (
    !candidate &&
    safeOptions.length === 1 &&
    ['ckpt_name', 'vae_name', 'sampler_name', 'scheduler'].includes(inputName)
  ) {
    return safeOptions[0];
  }

  return '';
}

// ─── 公开导出函数 ───

/** 校验并修复 API Prompt 中引用的资源（model/VAE/Lora 等） */
export function validateAndRepairComfyApiPromptResources(
  apiPrompt: ApiPromptWorkflow,
  objectInfo: Record<string, unknown> = {},
  runtime: ComfyRuntimeValues = {},
): ResourceValidationResult {
  const nextPrompt = cloneSerializable(apiPrompt, apiPrompt);

  if (!isApiPromptWorkflow(nextPrompt)) {
    throw new Error('API Prompt 格式无效，无法校验工作流资源');
  }

  if (!isPlainObject(objectInfo) || Object.keys(objectInfo).length === 0) {
    return {
      prompt: nextPrompt,
      repaired: [],
      unresolved: [],
    };
  }

  const repaired: ResourceValidationResult['repaired'] = [];
  const unresolved: ResourceValidationResult['unresolved'] = [];

  Object.entries(nextPrompt).forEach(([nodeId, node]) => {
    if (!isApiPromptNode(node) || !isPlainObject(node.inputs)) return;
    const inputs = node.inputs as Record<string, unknown>;

    const classType = safeTrim(node.class_type, '未知节点');
    const schema = getWorkflowNodeSchema(objectInfo, classType);

    Object.entries(inputs).forEach(([inputName, inputValue]) => {
      if (typeof inputValue !== 'string') return;

      const schemaEntry = getSchemaEntry(schema, inputName);
      const options = getSchemaValueOptions(schemaEntry);
      if (!Array.isArray(options)) return;
      if (options.includes(inputValue)) return;

      const fallbackValue = resolveWorkflowEnumFallback(inputName, options, runtime);
      if (fallbackValue) {
        inputs[inputName] = fallbackValue;
        repaired.push({
          nodeId,
          classType,
          inputName,
          from: inputValue,
          to: fallbackValue,
        });
        return;
      }

      unresolved.push({
        nodeId,
        classType,
        inputName,
        assetLabel: getWorkflowAssetLabel(inputName),
        currentValue: inputValue,
        options,
      });
    });
  });

  return {
    prompt: nextPrompt,
    repaired,
    unresolved,
  };
}

/** 格式化资源校验错误为用户可读的文本 */
export function formatComfyWorkflowResourceValidationError(
  unresolved: ResourceValidationResult['unresolved'] = [],
): string {
  if (!Array.isArray(unresolved) || unresolved.length === 0) {
    return '';
  }

  const lines = unresolved.map((item) => {
    const optionsText = Array.isArray(item.options)
      ? item.options.length
        ? `当前可用：${item.options.slice(0, 6).join('、')}${item.options.length > 6 ? ' 等' : ''}`
        : '当前节点没有任何可用项'
      : '当前实例未返回可用列表';

    return `- 节点 ${item.nodeId}（${item.classType}）的 ${item.assetLabel} 当前值"${item.currentValue}"不可用；${optionsText}`;
  });

  return `当前导入工作流引用了本机 ComfyUI 中不存在或不可用的资源：\n${lines.join('\n')}\n请在 ComfyUI 中安装对应资源，或在工作流编辑器里切换为当前实例可用的模型、VAE、ControlNet、放大模型后再应用。`;
}

/** 解析 ComfyUI 工作流 JSON 字符串 */
export function parseComfyWorkflowJson(text: string, label = 'ComfyUI 工作流 JSON'): unknown {
  return parseJsonString(text, label);
}

/** 判断是否为 API Prompt 格式工作流 */
export function isApiPromptWorkflow(value: unknown): value is ApiPromptWorkflow {
  if (!isPlainObject(value)) return false;
  const nodeIds = Object.keys(value);
  if (!nodeIds.length) return false;
  return nodeIds.every((nodeId) => isApiPromptNode(value[nodeId]));
}

/** 判断是否为标准 workflow 格式 */
export function isStandardWorkflow(value: unknown): value is StandardWorkflow {
  return isPlainObject(value) && Array.isArray((value as Record<string, unknown>).nodes);
}

/** 自动检测 ComfyUI 工作流格式（API prompt / 标准 workflow） */
export function detectComfyWorkflowPayload(rawValue: unknown): DetectedPayload {
  const value = typeof rawValue === 'string' ? parseJsonString(rawValue, 'ComfyUI 工作流 JSON') : rawValue;

  if (!isPlainObject(value)) {
    throw new Error('导入内容不是有效的 ComfyUI 工作流对象');
  }

  const promptCandidate = (value as Record<string, unknown>).prompt;
  const workflowCandidate = (value as Record<string, unknown>).workflow;

  const apiPrompt = isApiPromptWorkflow(promptCandidate)
    ? cloneSerializable(promptCandidate, promptCandidate)
    : isApiPromptWorkflow(value)
      ? cloneSerializable(value, value)
      : null;

  const uiWorkflow = isStandardWorkflow(workflowCandidate)
    ? cloneSerializable(workflowCandidate, workflowCandidate)
    : isStandardWorkflow(value)
      ? cloneSerializable(value, value)
      : null;

  if (!apiPrompt && !uiWorkflow) {
    throw new Error('未识别到可用的 ComfyUI API Prompt 或标准工作流 JSON');
  }

  return {
    format: uiWorkflow ? 'standard_workflow' : 'api_prompt',
    apiPrompt,
    workflow: uiWorkflow,
  };
}

/** 将标准 workflow 格式转换为 API prompt 格式（依赖 /object_info schema） */
export function convertStandardWorkflowToApiPrompt(
  workflow: StandardWorkflow,
  objectInfo: Record<string, unknown> = {},
): ApiPromptWorkflow {
  if (!isStandardWorkflow(workflow)) {
    throw new Error('标准工作流格式无效');
  }

  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  if (!nodes.length) {
    throw new Error('标准工作流中没有可转换的节点');
  }

  const linkMap = buildWorkflowLinkMap(workflow.links || []);
  const prompt: ApiPromptWorkflow = {};

  nodes.forEach((node) => {
    const nodeId = normalizeNodeId(node?.id);
    const classType = getWorkflowNodeClassType(node);

    if (!nodeId || !classType) {
      return;
    }

    const inputs: Record<string, unknown> = {};
    const linkedInputNames = new Set<string>();

    if (Array.isArray(node.inputs)) {
      node.inputs.forEach((input) => {
        const inputName = safeTrim(input?.name);
        const linkId = normalizeNumber(input?.link, null);
        if (!inputName || linkId == null) return;
        const linkInfo = linkMap.get(linkId);
        if (!linkInfo || !linkInfo.originId) return;
        inputs[inputName] = [linkInfo.originId, linkInfo.originSlot ?? 0];
        linkedInputNames.add(inputName);
      });
    }

    const widgetMappedInputs = mapWidgetValuesToInputs(node, classType, objectInfo, linkedInputNames);
    Object.entries(widgetMappedInputs).forEach(([key, value]) => {
      if (!(key in inputs)) {
        inputs[key] = value;
      }
    });

    prompt[nodeId] = {
      class_type: classType,
      inputs,
    };
  });

  if (!isApiPromptWorkflow(prompt)) {
    throw new Error('标准工作流转换失败，未生成有效的 API Prompt');
  }

  return prompt;
}

/** 将运行时参数（提示词/尺寸/seed 等）拓扑感知注入到 API prompt */
export function applyRuntimeValuesToApiPrompt(
  apiPrompt: ApiPromptWorkflow,
  runtime: ComfyRuntimeValues = {},
): ApiPromptWorkflow {
  if (!isApiPromptWorkflow(apiPrompt)) {
    throw new Error('API Prompt 格式无效，无法执行运行时注入');
  }

  const templateContext: Record<string, unknown> = {
    prompt: runtime.positivePrompt ?? '',
    positivePrompt: runtime.positivePrompt ?? '',
    negativePrompt: runtime.negativePrompt ?? '',
    width: runtime.width ?? '',
    height: runtime.height ?? '',
    seed: runtime.seed ?? '',
    steps: runtime.steps ?? '',
    cfg: runtime.cfg ?? '',
    scale: runtime.cfg ?? '',
    sampler: runtime.sampler_name ?? '',
    sampler_name: runtime.sampler_name ?? '',
    scheduler: runtime.scheduler ?? '',
    model: runtime.model ?? '',
    vae: runtime.vae ?? '',
  };

  const nextPrompt = replaceTemplateDeep(
    cloneSerializable(apiPrompt, apiPrompt),
    templateContext,
  ) as ApiPromptWorkflow;

  Object.values(nextPrompt).forEach((node) => {
    if (!isApiPromptNode(node)) return;
    updateSamplerRuntimeInputs(node, runtime);

    if (isPlainObject(node.inputs)) {
      const inputs = node.inputs as Record<string, unknown>;
      if (typeof inputs.width === 'string' && /^\d+$/.test(inputs.width)) {
        inputs.width = Number(inputs.width);
      }
      if (typeof inputs.height === 'string' && /^\d+$/.test(inputs.height)) {
        inputs.height = Number(inputs.height);
      }
      if (typeof inputs.seed === 'string' && /^\d+$/.test(inputs.seed)) {
        inputs.seed = Number(inputs.seed);
      }
      if (typeof inputs.steps === 'string' && /^\d+$/.test(inputs.steps)) {
        inputs.steps = Number(inputs.steps);
      }
      if (typeof inputs.cfg === 'string' && Number.isFinite(Number(inputs.cfg))) {
        inputs.cfg = Number(inputs.cfg);
      }
    }
  });

  applyConnectedPromptInputs(nextPrompt, runtime);
  applyDirectPromptInputs(nextPrompt, runtime);
  applyReachablePromptFallbacks(nextPrompt, runtime);

  Object.values(nextPrompt).forEach((node) => {
    if (!isApiPromptNode(node)) return;
    const inputs = isPlainObject(node.inputs) ? (node.inputs as Record<string, unknown>) : {};

    if (
      isConnectionValue(inputs.latent_image) &&
      Number.isFinite(Number(runtime.width)) &&
      Number.isFinite(Number(runtime.height))
    ) {
      updateSizeInputsInBranch(nextPrompt, inputs.latent_image[0], runtime.width!, runtime.height!);
    }
  });

  return nextPrompt;
}

/** 生成工作流摘要信息（格式、节点数、采样节点数、主要节点类型） */
export function summarizeComfyWorkflow(workflowLike: unknown): ComfyWorkflowSummary {
  let detected: DetectedPayload | null = null;

  try {
    detected = detectComfyWorkflowPayload(workflowLike);
  } catch {
    if (isApiPromptWorkflow(workflowLike)) {
      detected = {
        format: 'api_prompt',
        apiPrompt: workflowLike,
        workflow: null,
      };
    } else if (isStandardWorkflow(workflowLike)) {
      detected = {
        format: 'standard_workflow',
        apiPrompt: null,
        workflow: workflowLike,
      };
    } else {
      return {
        format: 'unknown',
        formatLabel: '未知格式',
        nodeCount: 0,
        samplerCount: 0,
        topClassTypes: [],
        summaryItems: [],
      };
    }
  }

  const nodeCount =
    detected.workflow?.nodes?.length ?? Object.keys(detected.apiPrompt || {}).length;
  const classCounter = countNodeClasses(detected.apiPrompt || {});
  const samplerCount = classCounter
    .filter(([classType]) => /sampler/i.test(classType))
    .reduce((sum, [, count]) => sum + count, 0);

  const formatLabel =
    detected.format === 'standard_workflow' ? '标准工作流 JSON' : 'API Prompt JSON';

  const topClassTypes = classCounter.slice(0, 6);
  const summaryItems: Array<{ label: string; value: string }> = [
    { label: '格式', value: formatLabel },
    { label: '节点数', value: String(nodeCount) },
    { label: '采样节点', value: String(samplerCount) },
  ];

  if (topClassTypes.length) {
    summaryItems.push({
      label: '主要节点',
      value: topClassTypes.map(([classType, count]) => `${classType} ×${count}`).join('，'),
    });
  }

  return {
    format: detected.format,
    formatLabel,
    nodeCount,
    samplerCount,
    topClassTypes,
    summaryItems,
  };
}

/** 导入工作流并生成完整记录（自动检测格式、转换、生成摘要） */
export function createImportedComfyWorkflowRecord(
  rawValue: unknown,
  options: { objectInfo?: Record<string, unknown>; fileName?: string; source?: string } = {},
): ImportedComfyWorkflowRecord {
  const { objectInfo = {}, fileName = '', source = 'json' } = options;
  const detected = detectComfyWorkflowPayload(rawValue);

  let apiPrompt: ApiPromptWorkflow | null = detected.apiPrompt
    ? cloneSerializable(detected.apiPrompt, detected.apiPrompt)
    : null;
  const uiWorkflow: StandardWorkflow | null = detected.workflow
    ? cloneSerializable(detected.workflow, detected.workflow)
    : null;

  if (!apiPrompt && uiWorkflow) {
    if (!isPlainObject(objectInfo) || Object.keys(objectInfo).length === 0) {
      throw new Error('导入标准工作流前，请先连接 ComfyUI 读取节点定义');
    }
    apiPrompt = convertStandardWorkflowToApiPrompt(uiWorkflow, objectInfo);
  }

  if (!apiPrompt || !isApiPromptWorkflow(apiPrompt)) {
    throw new Error('未生成可执行的 ComfyUI API Prompt');
  }

  const primaryFormat: 'standard_workflow' | 'api_prompt' = uiWorkflow
    ? 'standard_workflow'
    : 'api_prompt';
  const primaryData = (uiWorkflow || apiPrompt) as StandardWorkflow | ApiPromptWorkflow;
  const summary = summarizeComfyWorkflow({
    workflow: uiWorkflow,
    prompt: apiPrompt,
  });

  return {
    primaryFormat,
    primaryData,
    apiPrompt,
    uiWorkflow,
    summaryItems: summary.summaryItems,
    meta: {
      source: safeTrim(source, 'json'),
      fileName: safeTrim(fileName),
      fileBaseName: sanitizeFileBaseName(fileName, 'comfyui_workflow'),
      updatedAt: Date.now(),
      nodeCount: summary.nodeCount,
      samplerCount: summary.samplerCount,
      formatLabel: summary.formatLabel,
    },
  };
}

/** 生成工作流导出文件名 */
export function getComfyWorkflowExportFileName(
  name = 'comfyui_workflow',
  extension = 'json',
): string {
  const baseName = sanitizeFileBaseName(name, 'comfyui_workflow');
  const safeExtension = safeTrim(extension, 'json').replace(/^\./, '');
  return `${baseName}.${safeExtension}`;
}
