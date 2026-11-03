import type { SimulationState } from '../simulation/types';
import { createEmptyDirectorState, type DirectorDirective, type DirectorDirectiveItem, type PlotPlan } from './types';

function stableId(prefix: string, value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return `${prefix}_${(h >>> 0).toString(36)}`;
}

export function ensureDirectorState(sim: SimulationState) {
  if (!sim.director) sim.director = createEmptyDirectorState();
  sim.director.offscreenReceipts ??= {};
  sim.director.offscreenProposals ??= {};
  sim.director.plans ??= {};
  sim.director.directives ??= {};
  sim.director.receipts ??= [];
  return sim.director;
}

export function migrateLegacySimulationToDirector(sim: SimulationState) {
  const director = ensureDirectorState(sim);
  if (director.legacyMigrated) return director;
  const now = Date.now();
  for (const event of Object.values(sim.events ?? {})) {
    const id = stableId('legacy_event', event.id || event.title);
    director.plans[id] ??= {
      id,
      intent: `${event.title}${event.description ? `：${event.description}` : ''}`,
      participants: event.affectedNpcIds ?? [],
      dependencies: [],
      status: event.factStatus === 'confirmed' ? 'occurred' : 'superseded',
      priority: Math.max(0, Math.min(100, Number(event.severity || 5) * 10)),
      visibility: event.readerOnly ? 'reader_only' : 'foreground',
      source: 'legacy',
      sourceRef: event.id,
      createdAt: now,
      updatedAt: now,
    };
  }
  for (const [npcId, storyline] of Object.entries(sim.storylines ?? {})) {
    for (const beat of storyline.beats ?? []) {
      const id = stableId('legacy_beat', `${npcId}:${beat.id}`);
      director.plans[id] ??= {
        id,
        intent: `${beat.title}${beat.narrative ? `：${beat.narrative}` : ''}`,
        participants: [npcId],
        dependencies: [{ kind: 'entity', ref: npcId }],
        status: beat.factStatus === 'confirmed' ? 'occurred' : 'superseded',
        priority: 50,
        visibility: beat.readerOnly ? 'reader_only' : 'secret',
        source: 'legacy',
        sourceRef: beat.id,
        createdAt: now,
        updatedAt: now,
      };
    }
  }
  director.legacyMigrated = true;
  return director;
}

function directiveItem(plan: PlotPlan): DirectorDirectiveItem {
  return {
    planId: plan.id,
    intent: plan.intent,
    participants: plan.participants,
    priority: plan.priority,
    constraints: plan.constraints,
    prerequisites: plan.dependencies.map(dep => `${dep.kind}:${dep.ref}=${dep.truth ?? 'unknown'}`),
    deferIf: plan.dependencies.filter(dep => dep.truth === 'unknown').map(dep => `${dep.kind}:${dep.ref} 仍未知`),
    forbiddenKnowledge: plan.visibility === 'foreground' ? [] : ['不得让玩家角色凭空知道幕后信息'],
  };
}

export function compileDirectorDirective(sim: SimulationState, basedOnTurnId: string, stateVersion?: string, saveId = 'runtime', issuedForTurnId?: string): DirectorDirective | undefined {
  const director = ensureDirectorState(sim);
  const ready = Object.values(director.plans).filter(plan => plan.status === 'ready' && plan.visibility === 'foreground' && (!plan.stageId || plan.stageId === director.sourceBinding?.currentStageId)).sort((a, b) => b.priority - a.priority).slice(0, 3);
  if (!ready.length) return undefined;
  const runId = stableId('director_run', `${saveId}:${basedOnTurnId}:${stateVersion}:${issuedForTurnId}:${ready.map(p => p.id).join(',')}`);
  const directive: DirectorDirective = {
    id: stableId('directive', `${runId}:${ready.map(p => p.id).join(',')}`),
    directorRunId: runId,
    saveId,
    issuedForTurnId,
    basedOnTurnId,
    basedOnStateVersion: stateVersion,
    primary: directiveItem(ready[0]),
    secondary: ready.slice(1).map(directiveItem),
    createdAt: Date.now(),
  };
  director.directives[directive.id] = directive;
  director.lastCompiledTurnId = basedOnTurnId;
  director.lastRunAt = Date.now();
  for (const plan of ready) {
    plan.status = 'directed';
    plan.lastDirectiveId = directive.id;
    plan.updatedAt = Date.now();
  }
  return directive;
}

export function getLatestDirectorDirective(sim: SimulationState): DirectorDirective | undefined {
  const director = ensureDirectorState(sim);
  return Object.values(director.directives).sort((a, b) => b.createdAt - a.createdAt)[0];
}

export function formatDirectorDirective(directive?: DirectorDirective): string {
  if (!directive?.primary) return '';
  const lines = ['【剧情导演指导｜未来意图，不是已发生事实】'];
  const render = (label: string, item: DirectorDirectiveItem) => {
    lines.push(`${label}：${item.intent}`);
    if (item.participants.length) lines.push(`参与者：${item.participants.join('、')}`);
    if (item.constraints?.length) lines.push(`约束：${item.constraints.join('；')}`);
    if (item.deferIf?.length) lines.push(`暂缓条件：${item.deferIf.join('；')}`);
    if (item.forbiddenKnowledge?.length) lines.push(`知识边界：${item.forbiddenKnowledge.join('；')}`);
  };
  render('主要推进', directive.primary);
  directive.secondary.forEach((item, index) => render(`次要推进${index + 1}`, item));
  lines.push('必须服从玩家当前行动、权威变量和已提交事实；如果本轮没有自然机会，不要强行实现。');
  return lines.join('\n');
}
