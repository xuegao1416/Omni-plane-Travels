import { z } from 'zod';
import { requestStructuredCompletion } from '../api/structuredOutput';
import type { ApiConfig } from '../api/types';
import { readDirectorPath } from './align';
import type { DirectorReadContext, DirectorState, PlotPlan } from './types';

const nonempty = z.string().trim().min(1);
const scalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const evidence = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('variable'), ref: nonempty, value: scalar }).strict(),
  z.object({ kind: z.literal('memory'), ref: nonempty, quote: nonempty }).strict(),
  z.object({ kind: z.literal('narrative'), quote: nonempty }).strict(),
]);
export const MAX_DIRECTOR_PLAN_PRIORITY = 70;

export const decisionSchema = z.object({
  conditions: z.array(z.object({ planId: nonempty, ref: nonempty, truth: z.enum(['true', 'false', 'unknown']), evidence: z.array(evidence).max(8) }).strict()).max(80),
  plans: z.array(z.object({ id: nonempty, intent: nonempty, participants: z.array(nonempty).max(12), constraints: z.array(nonempty).max(12), priority: z.number().int().min(0).max(MAX_DIRECTOR_PLAN_PRIORITY), visibility: z.enum(['foreground', 'reader_only', 'secret']), evidence: z.array(evidence).min(1).max(8) }).strict()).max(6),
  offscreen: z.array(z.object({ planId: nonempty, kind: z.enum(['character_moved', 'character_injured', 'world_event']), subjectIds: z.array(nonempty).max(12), description: nonempty, value: z.string() }).strict()).max(6),
}).strict();
export type DirectorDecision = z.infer<typeof decisionSchema>;
type Evidence = z.infer<typeof evidence>;

export function validateDirectorEvidence(item: Evidence, context: DirectorReadContext): string | undefined {
  if (item.kind === 'variable') {
    const value = readDirectorPath(context.variableProjection, item.ref);
    return value !== undefined && JSON.stringify(value) === JSON.stringify(item.value) ? `variable:${item.ref}` : undefined;
  }
  if (item.kind === 'narrative') return context.narrative?.includes(item.quote) ? `narrative:${context.completedTurnId}` : undefined;
  const fact = context.memories.find(memory => memory.id === item.ref);
  return fact?.layer === 'fact' && fact.provenance && fact.text.includes(item.quote) ? `memory:${fact.id}` : undefined;
}

/** Update director-owned plans only. Model suggestions cannot mutate facts or source content. */
export function applyDirectorDecision(state: DirectorState, decision: DirectorDecision, context: DirectorReadContext): void {
  for (const condition of decision.conditions) {
    const dependency = state.plans[condition.planId]?.dependencies.find(dep => dep.kind === 'condition' && dep.ref === condition.ref);
    if (!dependency) continue;
    const ids = condition.evidence.map(item => validateDirectorEvidence(item, context));
    const grounded = ids.length > 0 && ids.every(Boolean);
    dependency.resolution = { truth: grounded ? condition.truth : 'unknown', stateVersion: context.stateVersion, evidenceIds: ids.filter((id): id is string => !!id) };
  }
  for (const candidate of decision.plans) {
    if (candidate.participants.some(id => id !== 'player' && !Object.hasOwn(context.variableProjection.人物档案, id))) continue;
    const grounded = candidate.evidence.map(item => validateDirectorEvidence(item, context));
    if (!grounded.length || grounded.some(id => !id)) continue;
    const id = `actor:${encodeURIComponent(candidate.id)}`;
    // Stable identities preserve prior rejection/completion and cannot overwrite authored nodes.
    if (state.plans[id]) continue;
    const directions = Object.values(state.plans).filter(plan => plan.source === 'authored' || plan.source === 'novel').flatMap(plan => plan.preserveDirection ?? []);
    const now = Date.now();
    const plan: PlotPlan = {
      id, intent: candidate.intent, participants: candidate.participants, constraints: candidate.constraints,
      dependencies: candidate.participants.map(ref => ({ kind: 'entity', ref })),
      priority: candidate.priority, visibility: candidate.visibility, source: 'director', status: 'waiting',
      basis: grounded as string[], preserveDirection: [...new Set(directions)], createdAt: now, updatedAt: now,
    };
    state.plans[id] = plan;
  }
}

export const DIRECTOR_INSTRUCTIONS = `你是互动小说的剧情导演。你只提出未来指导和可受理的幕后事件，不生成、重写正式正文，不写记忆，不计算数值。
以已提交正文、权威变量和带来源的事实为依据。计划、预期、推测、传闻不能当成发生事实，置信度不等于证据。
主线节点是作者固定版本。不得修改它们的意图、人物命运或结局，不得补写原稿耗尽后的主线。保持核心方向，允许玩家拒绝、失败和选择其他路径；不得通过后台自动解决玩家尚未处理的核心冲突。
你同时负责人物行动与主线因果安排。针对当前阶段与玩家当前输入，检查 kind=condition 的自由文字前提。每项 true/false 都要引用对应变量路径与当前标量值、记忆id与原文或已提交正文原句。无法确认就 unknown。不能用玩家刚说要做的事证明已完成。
新增 plans 仅用于有事实依据的人物/世界发展和接回当前主线的机会，不是另起独立剧情支线；稳定id用于同一事件跨轮去重。原稿已耗尽仍可有日常世界变化，但不能替作者续写主线。
plans.priority 必须是 0 到 70 的整数；这是导演动态计划的优先级隔离带，不得超过 70。
offscreen 是本回合时间范围内可真实发生的离场人物事件；只能引用已存在且前提成立的计划（本次新增用 actor:加id）。不能伤害/移动在场者、死者或玩家，不能偷偷达成当前主线目标；没有合理发展就空数组。只输出关系/位置/伤势的语义，不输出生命/好感/资源增减。
返回严格JSON，无Markdown：{"conditions":[{"planId":"...","ref":"条件id","truth":"true|false|unknown","evidence":[{"kind":"variable","ref":"变量路径","value":"实际值"}]}],"plans":[{"id":"稳定事件id","intent":"未来意图","participants":["规范人物id"],"constraints":[],"priority":50,"visibility":"foreground|reader_only|secret","evidence":[{"kind":"memory","ref":"记忆id","quote":"原句"}]}],"offscreen":[{"planId":"已存在计划id","kind":"character_moved|character_injured|world_event","subjectIds":["规范人物id"],"description":"实际幕后事件","value":"新地点或伤势描述；世界事件为空"}]}。
第三种证据格式为 {"kind":"narrative","quote":"已提交正文原句"}。完全没有依据时三个数组均为空。`;

export async function requestDirectorDecision(state: DirectorState, context: DirectorReadContext, worldDescription: string, config: ApiConfig, signal?: AbortSignal): Promise<DirectorDecision> {
  const plans = Object.values(state.plans).filter(plan => !['occurred', 'invalid', 'superseded'].includes(plan.status) && (!plan.stageId || plan.stageId === state.sourceBinding?.currentStageId)).slice(0, 40);
  const input = { worldDescription, source: state.sourceBinding, plans, playerInput: context.playerInput,
    committedNarrative: context.narrative, memories: context.memories.slice(-60),
    variables: { 世界: context.variableProjection.世界, 玩家: context.variableProjection.玩家,
      人物档案: Object.fromEntries(Object.entries(context.variableProjection.人物档案).map(([id, npc]) => [id, { 姓名: npc.姓名, 人物分类: npc.人物分类, 个人信息: npc.个人信息, 短期目标: npc.短期目标, 长期目标: npc.长期目标, 内心想法: npc.内心想法 }])) } };
  return requestStructuredCompletion({
    config,
    messages: [{ role: 'system', content: DIRECTOR_INSTRUCTIONS }, { role: 'user', content: JSON.stringify(input) }],
    schema: decisionSchema,
    schemaName: 'director_decision',
    temperature: 0.3,
    maxTokens: 6000,
    signal,
    repairAttempts: 1,
  });
}
