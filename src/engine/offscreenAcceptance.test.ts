import { expect, test } from 'bun:test';
import { createDefaultGameState, type NPCData } from '../schema/variables';
import { createEmptyDirectorState, type DirectorReadContext, type OffscreenEventProposal } from '../director/types';
import { evolutionFactVersion } from '../simulation/turnCoordinator';
import { acceptOffscreenEvent } from './offscreenAcceptance';
import { authoredFixture } from '../director/authoredEffects.test';

function fixture() {
  const state = createDefaultGameState();
  state.人物档案.n = { 姓名: '甲', 人物分类: '离场', 个人信息: { 当前状态: '正常', 当前位置: '旧城' } } as NPCData;
  const director = createEmptyDirectorState();
  director.plans.p = { id: 'p', intent: '迁往新城', participants: ['n'], dependencies: [], status: 'ready', priority: 40, source: 'director', visibility: 'secret', createdAt: 1, updatedAt: 1 };
  const version = evolutionFactVersion(state);
  const context: DirectorReadContext = { saveId: 's', worldId: 'w', completedTurnId: 't', stateVersion: version, variableProjection: state, memories: [] };
  const proposal: OffscreenEventProposal = { planId: 'p', worldId: 'w', basedOnTurnId: 't', proposalId: 'p1', directorRunId: 'r', saveId: 's', baseStateVersion: version, logicalEventKey: 'move', kind: 'character_moved', subjectIds: ['n'], prerequisites: [], occurredAt: state.世界.时间系统.当前时间, visibility: 'secret', description: '甲到了新城', payload: { location: '新城' }, createdAt: 1 };
  return { state, director, version, context, proposal };
}

test('authoritative read checks reject fake true preconditions, wrong scope and present actors', () => {
  const f = fixture();
  f.proposal.prerequisites = [{ kind: 'variable', ref: '世界.不存在', truth: 'true' }];
  expect(acceptOffscreenEvent(f.proposal, f.state, f.director, f.version, f.context).receipt.reason).toBe('prerequisite_not_true');
  f.proposal.prerequisites = [];
  expect(acceptOffscreenEvent(f.proposal, f.state, f.director, f.version, { ...f.context, saveId: 'other' }).receipt.reason).toBe('scope_mismatch');
  f.state.人物档案.n.人物分类 = '在场';
  f.version = evolutionFactVersion(f.state); f.proposal.baseStateVersion = f.version;
  expect(acceptOffscreenEvent(f.proposal, f.state, f.director, f.version, f.context).receipt.reason).toBe('subject_present_or_dead');
});

test('accepted variable receipts retry without a second transaction and numeric relationship deltas reject', () => {
  const f = fixture();
  const result = acceptOffscreenEvent(f.proposal, f.state, f.director, f.version, f.context);
  expect(result.receipt.status).toBe('accepted');
  f.director.offscreenReceipts.move = result.receipt;
  const retried = acceptOffscreenEvent(f.proposal, result.state, f.director, evolutionFactVersion(result.state), f.context);
  expect(retried.state).toBe(result.state);
  expect(retried.receipt).toBe(result.receipt);
  const numeric = { ...f.proposal, logicalEventKey: 'relation', kind: 'relationship_changed' as const, payload: { delta: 50, targetId: 'player' } };
  expect(acceptOffscreenEvent(numeric, f.state, f.director, f.version, f.context).receipt.reason).toBe('unsupported_event_kind');
});

test('author world event atomically commits death and gate, ignores payload and retries accepted death', () => {
  const f = authoredFixture([{ type: 'npc.die', actorId: 'n' }, { type: 'module.rule', moduleId: 'gate', moduleVersion: '1.0.0', lifecycle: 'onChoice', ruleId: 'open' }]);
  const version = evolutionFactVersion(f.state);
  const context: DirectorReadContext = { saveId: 's', worldId: 'w', completedTurnId: 't', stateVersion: version, variableProjection: f.state, memories: [] };
  f.plan.dependencies = [{ kind: 'entity', ref: 'n' }];
  const proposal: OffscreenEventProposal = { planId: f.plan.id, worldId: 'w', basedOnTurnId: 't', proposalId: 'death1', directorRunId: 'r', saveId: 's', baseStateVersion: version, logicalEventKey: 'death', kind: 'world_event', subjectIds: ['n'], prerequisites: [], occurredAt: f.state.世界.时间系统.当前时间, visibility: 'reader_only', description: '甲死亡并开门', payload: { path: '玩家.生存状态.血量', value: 0 }, createdAt: 1 };
  const result = acceptOffscreenEvent(proposal, f.state, f.director, version, context);
  expect(result.receipt.status).toBe('accepted');
  expect(result.state.人物档案.n.战斗状态).toBe('死亡');
  expect(result.state.玩家.生存状态.血量).toBe(100);
  f.director.offscreenReceipts.death = result.receipt;
  const retried = acceptOffscreenEvent(proposal, result.state, f.director, evolutionFactVersion(result.state), context);
  expect(retried.receipt).toBe(result.receipt);
  expect(retried.state).toBe(result.state);
});

test('authored consequences cannot be skipped by movement or injury proposal kinds', () => {
  for (const kind of ['character_moved', 'character_injured'] as const) {
    const f = authoredFixture([{ type: 'npc.die', actorId: 'n' }, { type: 'module.rule', moduleId: 'gate', moduleVersion: '1.0.0', lifecycle: 'onChoice', ruleId: 'open' }]);
    const version = evolutionFactVersion(f.state);
    const context: DirectorReadContext = { saveId: 's', worldId: 'w', completedTurnId: 't', stateVersion: version, variableProjection: f.state, memories: [] };
    const proposal: OffscreenEventProposal = { planId: f.plan.id, worldId: 'w', basedOnTurnId: 't', proposalId: 'misclassified', directorRunId: 'r', saveId: 's', baseStateVersion: version, logicalEventKey: kind, kind, subjectIds: ['n'], prerequisites: [], occurredAt: f.state.世界.时间系统.当前时间, visibility: 'reader_only', description: '甲改变状态', payload: { location: '新城', status: '轻伤' }, createdAt: 1 };
    const result = acceptOffscreenEvent(proposal, f.state, f.director, version, context);
    expect(result.receipt.status).toBe('rejected');
    expect(result.receipt.reason).toBe('authored_effects_require_world_event');
    expect(result.state).toBe(f.state);
  }
});

test('owner rejects future-stage proposals even when the plan is already ready', () => {
  const f = fixture();
  f.director.sourceBinding = { type: 'authored', sourceId: 'book', version: '1', boundAt: 1, currentStageId: 'current' };
  f.director.plans.p!.stageId = 'future';
  const result = acceptOffscreenEvent(f.proposal, f.state, f.director, f.version, f.context);
  expect(result.receipt.reason).toBe('plan_stage_not_active');
  expect(result.state).toBe(f.state);
});
