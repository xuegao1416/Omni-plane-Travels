import { z } from 'zod';
import type { DirectorDefinition } from './definitionTypes';

const text = z.string().trim().min(1);
const strings = z.array(text);
const predicate = z.object({ path: text, operator: z.enum(['eq', 'neq', 'exists', 'gt', 'gte', 'lt', 'lte']), value: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]).optional() }).strict();
export const directorDraftSchema = z.object({
  title: text, coreConflict: text, anchors: strings,
  stages: z.array(z.object({ id: text, title: text, description: text, nodeIds: strings.min(1, '阶段至少需要一个事件'), completion: z.object({ mode: z.enum(['all', 'any']), nodeIds: strings.min(1) }).strict().optional() }).strict()).min(1),
  nodes: z.array(z.object({ id: text, stageId: text, title: text, intent: text, actorIds: strings, execution: z.enum(['foreground', 'offscreen', 'either']), conditions: z.array(z.object({ id: text, description: text, predicates: z.array(predicate).optional() }).strict()), dependsOn: strings, constraints: strings, sourceRefs: strings.min(1), referenceOutcome: text.optional() }).strict()).min(1),
  characters: z.array(z.object({ id: text, name: text, aliases: strings }).strict()),
  coverage: z.object({ complete: z.boolean(), gaps: strings, boundary: text }).strict(),
}).strict();
export type DirectorDraft = z.infer<typeof directorDraftSchema>;

export function validateDirectorDraft(value: unknown, allowedSources?: readonly string[]): DirectorDraft {
  const draft = directorDraftSchema.parse(value);
  const unique = (ids: string[], label: string) => { if (new Set(ids).size !== ids.length) throw new Error(`重复${label}`); return new Set(ids); };
  const stages = unique(draft.stages.map(s => s.id), '阶段');
  const nodes = unique(draft.nodes.map(n => n.id), '事件');
  const actors = unique(draft.characters.map(c => c.id), '人物');
  unique(draft.nodes.flatMap(n => n.conditions.map(c => c.id)), '条件');
  const sources = allowedSources && new Set(allowedSources);
  const stageOrder = new Map(draft.stages.map((stage, index) => [stage.id, index]));
  const nodeStages = new Map(draft.nodes.map(node => [node.id, node.stageId]));
  const listed = draft.stages.flatMap(s => s.nodeIds);
  for (const stage of draft.stages) if (stage.completion?.nodeIds.some(id => !stage.nodeIds.includes(id))) throw new Error('阶段完成条件引用了其他阶段事件');
  if (listed.length !== nodes.size || new Set(listed).size !== nodes.size || listed.some(id => !nodes.has(id))) throw new Error('阶段必须恰好覆盖全部事件');
  for (const node of draft.nodes) {
    if (!stages.has(node.stageId) || !draft.stages.find(s => s.id === node.stageId)!.nodeIds.includes(node.id)) throw new Error('阶段引用失效');
    if (node.actorIds.some(id => !actors.has(id)) || node.dependsOn.some(id => !nodes.has(id))) throw new Error('人物或因果引用失效');
    if (node.dependsOn.some(id => stageOrder.get(nodeStages.get(id)!)! > stageOrder.get(node.stageId)!)) throw new Error('前一阶段事件不能依赖尚未开启的后续阶段事件');
    if (sources && node.sourceRefs.some(id => !sources.has(id))) throw new Error('来源引用不存在');
  }
  const visited = new Set<string>(), visiting = new Set<string>();
  const visit = (id: string) => { if (visiting.has(id)) throw new Error('剧情因果存在循环'); if (visited.has(id)) return; visiting.add(id); draft.nodes.find(n => n.id === id)!.dependsOn.forEach(visit); visiting.delete(id); visited.add(id); };
  nodes.forEach(visit);
  return draft;
}

export function validateDirectorDefinition(value: DirectorDefinition): DirectorDefinition {
  const { schemaVersion, id, version, source, createdAt, editedByAuthor, ...draft } = value;
  if (schemaVersion !== 1 || !id || !version || !Number.isFinite(createdAt) || typeof editedByAuthor !== 'boolean' || !source?.text || !['author', 'novel'].includes(source.kind)) throw new Error('无效剧情定义');
  validateDirectorDraft(draft, source.kind === 'author' ? undefined : source.evidenceRefs?.map(r => `novel:${r.chapterId}:${r.startOffset}:${r.endOffset}`));
  if (source.kind === 'author') for (const ref of draft.nodes.flatMap(n => n.sourceRefs)) {
    const match = /^author:(\d+):(\d+)$/.exec(ref);
    if (!match || Number(match[1]) >= Number(match[2]) || Number(match[2]) > source.text.length) throw new Error('作者原稿引用越界');
  }
  return structuredClone(value);
}
