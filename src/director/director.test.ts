import { expect, test } from 'bun:test';
import { createDefaultGameState } from '../schema/variables';
import { createEmptySimState } from '../simulation/types';
import { evolutionFactVersion } from '../simulation/turnCoordinator';
import { alignDirectorPlans, evaluateDependency } from './align';
import { acceptOffscreenEvent } from './offscreen';
import { compileDirectorDirective, ensureDirectorState, migrateLegacySimulationToDirector } from './runtime';
import { ensureKnowledgeState, projectKnownRosterFromGameState } from './knowledge';
import { bindDirectorDefinition, refreshSourceExhaustion } from './sourceAdapter';
import type { DirectorDefinition } from './definitionTypes';
import { createEmptyDirectorState, type DirectorReadContext, type OffscreenEventProposal, type PlotPlan } from './types';

function npc(name='甲') {
  return {
    姓名:name, 人物分类:'离场', 重要NPC:true, 人物事迹:[],
    个人信息:{ 当前位置:'旧城', 当前状态:'正常', 里性格:'秘密', 当前想法:'秘密想法' },
    关系数据:{ 好感度:0 }, 短期目标:'秘密目标', 长期目标:'长期秘密',
  } as any;
}
function ctx(state=createDefaultGameState()): DirectorReadContext {
  return { saveId:'s',worldId:'w',completedTurnId:'t',stateVersion:evolutionFactVersion(state),variableProjection:state,memories:[] };
}
function plan(id:string, deps:PlotPlan['dependencies']=[]): PlotPlan {
  return { id,intent:id,participants:[],dependencies:deps,status:'waiting',priority:50,visibility:'foreground',source:'director',createdAt:1,updatedAt:1 };
}
function definition(id: string): DirectorDefinition {
  return { schemaVersion: 1, id, version: 'v1', title: '调查', coreConflict: '查明真相', anchors: [], characters: [], source: { kind: 'author', text: '原稿' }, createdAt: 1, editedByAuthor: false,
    coverage: { complete: true, gaps: [], boundary: '调查结束' },
    stages: ['1', '2'].map(id => ({ id, title: id, description: '继续调查', nodeIds: [id], completion: { mode: 'all', nodeIds: [id] } })),
    nodes: ['1', '2'].map(id => ({ id, stageId: id, title: id, intent: '继续调查', actorIds: [], execution: 'foreground', conditions: [], dependsOn: id === '2' ? ['1'] : [], constraints: [], sourceRefs: ['author:0:2'] })),
  };
}

test('director dependency: missing variable is unknown, not false',()=>{
  const d=createEmptyDirectorState(); const c=ctx();
  expect(evaluateDependency({kind:'variable',ref:'世界.不存在',expected:1},d,c)).toBe('unknown');
});

test('director align: unknown dependency keeps plan waiting',()=>{
  const d=createEmptyDirectorState(); d.plans.p=plan('p',[{kind:'memory',ref:'missing'}]);
  alignDirectorPlans(d,ctx()); expect(d.plans.p.status).toBe('waiting'); expect(d.plans.p.dependencies[0].truth).toBe('unknown');
});

test('director align: false variable blocks a plan',()=>{
  const s=createDefaultGameState(); s.玩家.当前目标='A'; const d=createEmptyDirectorState();
  d.plans.p=plan('p',[{kind:'variable',ref:'玩家.当前目标',expected:'B'}]); alignDirectorPlans(d,ctx(s)); expect(d.plans.p.status).toBe('blocked');
});

test('director align: invalid upstream plan permanently invalidates dependent plan',()=>{
  const d=createEmptyDirectorState(); d.plans.a={...plan('a'),status:'invalid'}; d.plans.b=plan('b',[{kind:'plan',ref:'a'}]);
  alignDirectorPlans(d,ctx()); expect(d.plans.b.status).toBe('invalid');
});

test('confirmed character death invalidates its pending action and preserves an alternative route', () => {
  const state = createDefaultGameState();
  state.人物档案.n = { ...npc('沈清'), 战斗状态: '死亡' };
  const d = createEmptyDirectorState();
  d.plans.followup = plan('followup', [{ kind: 'plan', ref: 'meeting' }]);
  d.plans.meeting = plan('meeting', [{ kind: 'entity', ref: 'n' }]);
  d.plans.records = plan('records');
  alignDirectorPlans(d, ctx(state));
  expect(d.plans.meeting.status).toBe('invalid');
  expect(d.plans.followup.status).toBe('invalid');
  expect(d.plans.records.status).toBe('ready');
});

test('director compile: emits one primary plus at most two secondary plans',()=>{
  const sim=createEmptySimState(); const d=ensureDirectorState(sim);
  for(let i=0;i<5;i++) d.plans[`p${i}`]={...plan(`p${i}`),status:'ready',priority:100-i};
  const directive=compileDirectorDirective(sim,'turn'); expect(directive?.primary?.planId).toBe('p0'); expect(directive?.secondary).toHaveLength(2);
  expect(Object.values(d.plans).filter(p=>p.status==='directed')).toHaveLength(3);
});

test('director compile: directive creation does not mutate authoritative game facts',()=>{
  const state=createDefaultGameState(); state.玩家.当前目标='原目标'; const before=JSON.stringify(state); const sim=createEmptySimState();
  ensureDirectorState(sim).plans.p={...plan('p'),status:'ready'}; compileDirectorDirective(sim,'turn'); expect(JSON.stringify(state)).toBe(before);
});

test('offscreen acceptance: committed movement changes truth but not player-known projection',()=>{
  const state=createDefaultGameState(); state.人物档案.n=npc(); ensureKnowledgeState(state); const d=createEmptyDirectorState(); const version=evolutionFactVersion(state);
  const proposal:OffscreenEventProposal={ proposalId:'p',directorRunId:'r',saveId:'s',baseStateVersion:version,logicalEventKey:'move:n',kind:'character_moved',subjectIds:['n'],prerequisites:[{kind:'entity',ref:'n',truth:'true'}],occurredAt:'day2',visibility:'secret',description:'去了新城',payload:{location:'新城'},createdAt:1 };
  d.plans.move={...plan('move'),status:'ready',visibility:'secret',participants:['n']};
  Object.assign(proposal,{planId:'move',worldId:'w',basedOnTurnId:'t',occurredAt:state.世界.时间系统.当前时间});
  const result=acceptOffscreenEvent(proposal,state,d,version,ctx(state)); expect(result.receipt.status).toBe('accepted'); expect(result.state.人物档案.n.个人信息.当前位置).toBe('新城');
  expect(projectKnownRosterFromGameState(result.state).n?.个人信息?.当前位置).toBe('旧城');
});

test('offscreen acceptance: stale base state version is rejected',()=>{
  const state=createDefaultGameState(); state.人物档案.n=npc(); const d=createEmptyDirectorState();
  const proposal:OffscreenEventProposal={ proposalId:'p',directorRunId:'r',saveId:'s',baseStateVersion:'old',logicalEventKey:'move:n',kind:'character_moved',subjectIds:['n'],prerequisites:[{kind:'entity',ref:'n',truth:'true'}],occurredAt:'day2',visibility:'secret',description:'去了新城',payload:{location:'新城'},createdAt:1 };
  Object.assign(proposal,{worldId:'w',basedOnTurnId:'t'});
  const result=acceptOffscreenEvent(proposal,state,d,'new',ctx(state)); expect(result.receipt.status).toBe('rejected'); expect(result.receipt.reason).toBe('base_state_version_mismatch'); expect(result.state.人物档案.n.个人信息.当前位置).toBe('旧城');
});

test('known projection: readers never initialize knowledge from fresh truth',()=>{
  const state=createDefaultGameState(); state.人物档案.n=npc();
  expect(projectKnownRosterFromGameState(state)).toEqual({});
  expect(state.playerKnowledge).toBeUndefined();
});

test('legacy migration: confirmed facts become occurred while candidates stay unrealized',()=>{
  const sim=createEmptySimState(); sim.events.e={ id:'e',title:'事件',description:'x',level:'civilian',region:'',severity:3,status:'active',factStatus:'confirmed',readerOnly:true,childEventIds:[],affectedNpcIds:[],affectedFactions:[],playerHooks:[],createdAtTime:'',createdAtTick:0,batchId:'b',lastUpdatedTick:0 };
  sim.events.c={...sim.events.e,id:'c',factStatus:'candidate'}; const d=migrateLegacySimulationToDirector(sim);
  const migrated=Object.values(d.plans); expect(migrated.some(p=>p.sourceRef==='e'&&p.status==='occurred')).toBe(true); expect(migrated.some(p=>p.sourceRef==='c'&&p.status!=='occurred')).toBe(true);
});

test('authored source binding is fixed to the save and refuses a second source',()=>{
  const d=createEmptyDirectorState(); bindDirectorDefinition(d,definition('a'));
  expect(d.sourceBinding?.sourceId).toBe('a'); expect(()=>bindDirectorDefinition(d,definition('b'))).toThrow();
});

test('source exhaustion only flips after every bound source plan is terminal',()=>{
  const d=createEmptyDirectorState(); bindDirectorDefinition(d,definition('a'));
  expect(refreshSourceExhaustion(d)).toBe(false); for(const p of Object.values(d.plans)) p.status='occurred'; expect(refreshSourceExhaustion(d)).toBe(true); expect(d.sourceBinding?.exhausted).toBe(true);
});
