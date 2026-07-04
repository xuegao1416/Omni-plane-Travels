// ComfyUI 工作流编辑器 — 工具函数
import type { WorkflowParamMapping, DetectedNode, ParamInjectPoint } from '@/api/imageGenTypes';

/** 解析 workflow JSON（兼容 ComfyUI 导出的两种格式），失败返回 null */
export function parseWorkflowJson(raw: string): Record<string, Record<string, unknown>> | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed.nodes && Array.isArray(parsed.nodes)) {
      const workflow: Record<string, Record<string, unknown>> = {};
      for (const n of parsed.nodes) { if (n.id != null) workflow[String(n.id)] = n; }
      return workflow;
    }
    return parsed;
  } catch { return null; }
}

/** 根据检测到的节点自动构建参数映射 */
export function buildAutoMapping(nodes: DetectedNode[]): WorkflowParamMapping {
  const autoMapping: WorkflowParamMapping = { custom: {} };
  const usedRoles = new Set<string>();
  for (const node of nodes) {
    if (!node.suggestedRole) continue;
    for (const role of getRoleHints(node.classType)) {
      if (usedRoles.has(role)) continue;
      const inputKey = findInputKey(node, role);
      if (inputKey) {
        setMappingParam(autoMapping, role as keyof WorkflowParamMapping, { nodeId: node.nodeId, inputKey });
        usedRoles.add(role);
        break;
      }
    }
  }
  return autoMapping;
}

export function setMappingParam(
  mapping: WorkflowParamMapping,
  role: keyof WorkflowParamMapping,
  value: ParamInjectPoint | undefined,
): void {
  if (role === 'custom') return;
  // WorkflowParamMapping 的字段名就是 role 名称，可以直接索引
  const m = mapping as unknown as Record<string, ParamInjectPoint | undefined>;
  m[role] = value;
}

export function getMappingParam(
  mapping: WorkflowParamMapping,
  role: keyof WorkflowParamMapping,
): ParamInjectPoint | undefined {
  if (role === 'custom') return undefined;
  const m = mapping as unknown as Record<string, ParamInjectPoint | undefined>;
  return m[role];
}

export function getRoleHints(classType: string): string[] {
  const hints: Record<string, string[]> = {
    'CLIPTextEncode': ['positive_prompt', 'negative_prompt'],
    'CLIPTextEncodeSDXL': ['positive_prompt', 'negative_prompt'],
    'CLIPTextEncodeFlux': ['positive_prompt'],
    'KSampler': ['seed', 'steps', 'cfg', 'sampler', 'scheduler', 'denoise'],
    'KSamplerAdvanced': ['seed', 'steps', 'cfg', 'sampler', 'scheduler', 'denoise'],
    'KSamplerSelect': ['sampler'],
    'EmptyLatentImage': ['width', 'height', 'batch_size'],
    'EmptySD3LatentImage': ['width', 'height', 'batch_size'],
    'EmptyFluxLatentImage': ['width', 'height', 'batch_size'],
    'RandomNoise': ['seed'],
  };
  return hints[classType] || [];
}

export function findInputKey(node: DetectedNode, role: string): string | null {
  const roleKeyMap: Record<string, string[]> = {
    positive_prompt: ['text'],
    negative_prompt: ['text'],
    seed: ['seed', 'noise_seed'],
    steps: ['steps'],
    cfg: ['cfg'],
    sampler: ['sampler_name'],
    scheduler: ['scheduler'],
    width: ['width'],
    height: ['height'],
    batch_size: ['batch_size'],
    denoise: ['denoise'],
  };
  const candidates = roleKeyMap[role] || [];
  for (const c of candidates) {
    if (node.inputs.includes(c)) return c;
  }
  return null;
}
