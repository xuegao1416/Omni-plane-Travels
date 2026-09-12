import type { DirectorReadContext, DirectorState, DirectorTruth, PlotPlanDependency } from './types';
import { isNpcDead } from '../utils/npcHelpers';

function same(actual: unknown, expected: unknown): boolean {
  if (expected === undefined) return Boolean(actual);
  return JSON.stringify(actual) === JSON.stringify(expected);
}

export function readDirectorPath(value: unknown, path: string): unknown {
  for (const part of path.split('.')) {
    if (!part || ['__proto__', 'prototype', 'constructor'].includes(part) || !value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function evaluateDependency(dep: PlotPlanDependency, state: DirectorState, ctx: DirectorReadContext): DirectorTruth {
  if (dep.kind === 'condition') return dep.resolution?.stateVersion === ctx.stateVersion ? dep.resolution.truth : 'unknown';
  if (dep.kind === 'plan') {
    const plan = state.plans[dep.ref];
    if (!plan) return 'unknown';
    if (plan.status === 'occurred') return 'true';
    if (plan.status === 'invalid' || plan.status === 'superseded') return 'false';
    return 'unknown';
  }
  if (dep.kind === 'entity') {
    if (dep.ref === 'player') return 'true';
    const npc = ctx.variableProjection.人物档案?.[dep.ref];
    if (npc) return isNpcDead(npc) ? 'false' : 'true';
    return state.sourceBinding?.actorNames && Object.hasOwn(state.sourceBinding.actorNames, dep.ref) ? 'true' : 'unknown';
  }
  if (dep.kind === 'variable') {
    const value = readDirectorPath(ctx.variableProjection, dep.ref);
    if (value === undefined) return 'unknown';
    if (dep.operator === 'exists') return 'true';
    if (dep.operator === 'neq') return same(value, dep.expected) ? 'false' : 'true';
    if (dep.operator && ['gt', 'gte', 'lt', 'lte'].includes(dep.operator)) {
      if (typeof value !== 'number' || typeof dep.expected !== 'number') return 'unknown';
      const passed = dep.operator === 'gt' ? value > dep.expected : dep.operator === 'gte' ? value >= dep.expected : dep.operator === 'lt' ? value < dep.expected : value <= dep.expected;
      return passed ? 'true' : 'false';
    }
    return same(value, dep.expected) ? 'true' : 'false';
  }
  if (dep.kind === 'memory') {
    const memory = ctx.memories.find(item => item.id === dep.ref && item.layer === 'fact' && item.provenance);
    if (!memory) return 'unknown';
    return dep.expected === undefined || same(memory.text, dep.expected) ? 'true' : 'false';
  }
  const receipt = state.offscreenReceipts[dep.ref];
  if (!receipt) return 'unknown';
  if (receipt.status === 'accepted' && receipt.consumers.variables === 'done') return 'true';
  if (receipt.status === 'rejected') return 'false';
  return 'unknown';
}

export function alignDirectorPlans(state: DirectorState, ctx: DirectorReadContext): DirectorState {
  const now = Date.now();
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const align = (id: string) => {
    const plan = state.plans[id];
    if (!plan || visited.has(id) || visiting.has(id) || ['occurred', 'invalid', 'superseded'].includes(plan.status)) return;
    visiting.add(id);
    for (const dependency of plan.dependencies) if (dependency.kind === 'plan') align(dependency.ref);
    const truths = plan.dependencies.map(dep => {
      const truth = evaluateDependency(dep, state, ctx);
      dep.truth = truth;
      return truth;
    });
    const permanentlyBroken = plan.dependencies.some((dep, index) => (dep.kind === 'plan' || dep.kind === 'entity') && truths[index] === 'false');
    if (truths.includes('false')) plan.status = permanentlyBroken ? 'invalid' : 'blocked';
    else if (truths.includes('unknown')) plan.status = 'waiting';
    else plan.status = 'ready';
    plan.updatedAt = now;
    visiting.delete(id);
    visited.add(id);
  };
  Object.keys(state.plans).forEach(align);
  return state;
}
