import { expect, test } from 'bun:test';
import { createDefaultGameState, type NPCData } from '../schema/variables';
import { createEmptyDirectorState, type DirectorReadContext, type OffscreenEventProposal } from '../director/types';
import { evolutionFactVersion } from '../simulation/turnCoordinator';
import { acceptOffscreenEvent } from './offscreenAcceptance';

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
