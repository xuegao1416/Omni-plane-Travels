import type { DirectorState, PlotPlan } from './types';
import type { DirectorDefinition } from './definitionTypes';
import { validateDirectorDefinition } from './definitionSchema';

/** Called only by new-game initialization with a resolved immutable version. */
export function bindDirectorDefinition(director: DirectorState, definition: DirectorDefinition, options: { startStageId?: string; roleBinding?: Record<string, string> } = {}): DirectorState {
  validateDirectorDefinition(definition);
  if (director.sourceBinding) throw new Error('当前存档已经绑定主线版本');
  const start = options.startStageId ? definition.stages.findIndex(stage => stage.id === options.startStageId) : 0;
  if (start < 0) throw new Error('开局阶段不存在');
  const activeStages = new Set(definition.stages.slice(start).map(stage => stage.id));
  const nodes = definition.nodes.filter(node => activeStages.has(node.stageId));
  const nodeIds = new Set(nodes.map(node => node.id));
  const planId = (id: string) => `source:${definition.id}:${definition.version}:${id}`;
  const now = Date.now();
  for (const node of nodes) {
    const dependencies: PlotPlan['dependencies'] = node.dependsOn.filter(id => nodeIds.has(id)).map(id => ({ kind: 'plan', ref: planId(id) }));
    for (const condition of node.conditions) {
      if (condition.predicates?.length) dependencies.push(...condition.predicates.map(predicate => ({ kind: 'variable' as const, ref: predicate.path, expected: predicate.value, operator: predicate.operator, note: condition.description })));
      else dependencies.push({ kind: 'condition', ref: condition.id, note: condition.description });
    }
    const participants = node.actorIds.map(id => options.roleBinding?.[id] ?? id);
    dependencies.push(...participants.map(ref => ({ kind: 'entity' as const, ref })));
    director.plans[planId(node.id)] = {
      id: planId(node.id), stageId: node.stageId, intent: node.intent, participants, dependencies,
      constraints: [...node.constraints, ...definition.anchors], preserveDirection: [definition.coreConflict],
      status: dependencies.length ? 'waiting' : 'ready', priority: 80,
      visibility: node.execution === 'offscreen' ? 'reader_only' : 'foreground',
      source: definition.source.kind === 'novel' ? 'novel' : 'authored', sourceRef: node.id,
      basis: [...node.sourceRefs], createdAt: now, updatedAt: now,
    };
  }
  director.sourceBinding = { type: definition.source.kind === 'novel' ? 'novel' : 'authored', sourceId: definition.source.datasetId ?? definition.id, definitionId: definition.id, version: definition.version, startStageId: definition.stages[start].id, roleBinding: options.roleBinding, exhausted: nodes.length === 0, boundAt: now };
  director.sourceBinding.stages = definition.stages.slice(start).map(stage => ({ id: stage.id, title: stage.title, mode: stage.completion?.mode ?? 'all', planIds: stage.nodeIds.map(planId), completionPlanIds: (stage.completion?.nodeIds ?? stage.nodeIds).map(planId), status: 'pending' }));
  director.sourceBinding.actorNames = Object.fromEntries(definition.characters.map(actor => [options.roleBinding?.[actor.id] ?? actor.id, actor.name]));
  director.sourceBinding.actorAliases = Object.fromEntries(definition.characters.map(actor => [options.roleBinding?.[actor.id] ?? actor.id, [...actor.aliases]]));
  refreshSourceExhaustion(director);
  return director;
}

export function refreshSourceExhaustion(director: DirectorState): boolean {
  if (!director.sourceBinding) return false;
  const stages = director.sourceBinding.stages;
  if (stages?.length) {
    let active: string | undefined;
    for (const stage of stages) {
      const statuses = stage.completionPlanIds.map(id => director.plans[id]?.status);
      const complete = stage.mode === 'any' ? statuses.includes('occurred') : statuses.length > 0 && statuses.every(status => status === 'occurred');
      const failed = stage.mode === 'any' ? statuses.every(status => status === 'invalid' || status === 'superseded') : statuses.some(status => status === 'invalid' || status === 'superseded');
      stage.status = complete ? 'completed' : failed ? 'failed' : active ? 'pending' : 'active';
      if (stage.status === 'active') active = stage.id;
      if (complete || failed) for (const id of stage.planIds) {
        const plan = director.plans[id];
        if (plan && !['occurred', 'invalid', 'superseded'].includes(plan.status)) plan.status = 'superseded';
      }
    }
    director.sourceBinding.currentStageId = active;
    director.sourceBinding.exhausted = stages.every(stage => stage.status === 'completed' || stage.status === 'failed');
    return director.sourceBinding.exhausted;
  }
  const source = director.sourceBinding.type === 'novel' ? 'novel' : 'authored';
  const plans = Object.values(director.plans).filter(plan => plan.source === source);
  const exhausted = plans.length > 0 && plans.every(plan => ['occurred','invalid','superseded'].includes(plan.status));
  director.sourceBinding.exhausted = exhausted;
  return exhausted;
}
