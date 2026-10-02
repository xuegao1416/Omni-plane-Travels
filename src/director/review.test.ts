import { expect, test } from 'bun:test';
import { DirectorReviewController, type DirectorReviewInput } from './review';
import { createDefaultGameState, type NPCData } from '../schema/variables';
import { createEmptySimState } from '../simulation/types';
import { ensureDirectorState } from './runtime';
import type { DirectorDecision } from './client';
import { StructuredOutputValidationError } from '../api/structuredOutput';
import type { ApiConfig } from '../api/types';
import type { WorldDef } from '../data/worlds-schema';

const emptyDecision = (): DirectorDecision => ({ conditions: [], plans: [], offscreen: [] });
function fixture() {
  let state = createDefaultGameState();
  state.人物档案.n = { 姓名: '甲', 人物分类: '离场', 个人信息: { 当前位置: '旧城', 当前状态: '正常' } } as NPCData;
  let currentSave = 's';
  const host = { state: createEmptySimState(), saveState: () => {} };
  const input: DirectorReviewInput = { engine: host, world: { id: 'w', name: '世界', description: '旅行' } as WorldDef, config: {} as ApiConfig,
    saveId: 's', turnId: 't', round: 1, narrative: '雨下了一整天。', getState: () => state, commitState: next => { state = next; },
    currentSaveId: () => currentSave, currentWorldId: () => 'w', latestTurnId: () => 't', onCommitted: () => {}, onMainlineBusy: () => {}, onBackgroundBusy: () => {},
  };
  return { input, host, changeSave: () => { currentSave = 'other'; } };
}

test('a planning response arriving after a save switch cannot write its plans', async () => {
  const f = fixture();
  let release!: (decision: DirectorDecision) => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const controller = new DirectorReviewController(async () => { started(); return new Promise(resolve => { release = resolve; }); });
  const running = controller.run(f.input);
  await entered;
  f.changeSave();
  release({ ...emptyDecision(), plans: [{ id: 'rain', intent: '道路涨水', participants: [], constraints: [], priority: 30, visibility: 'reader_only', evidence: [{ kind: 'narrative', quote: '雨下了一整天' }] }] });
  await running;
  expect(f.host.state.director?.plans['actor:rain']).toBeUndefined();
});

test('memory failure retries only the missing consumer after committed variable changes', async () => {
  const f = fixture();
  ensureDirectorState(f.host.state).plans.move = { id: 'move', intent: '转移到新城', participants: ['n'], dependencies: [], status: 'ready', priority: 30, source: 'director', visibility: 'reader_only', createdAt: 1, updatedAt: 1 };
  let failMemory = true;
  let storedEvents = 0;
  const storedTexts: string[] = [];
  let decisionCalls = 0;
  f.input.getOffscreenMemoryPort = () => ({ hasOffscreenFact: () => storedEvents > 0, appendAcceptedEvent: event => { if (failMemory) throw new Error('disk unavailable'); storedEvents++; storedTexts.push(event.text); } });
  const controller = new DirectorReviewController(async () => ({ ...emptyDecision(), offscreen: [{ planId: 'move', kind: 'character_moved', subjectIds: ['n'], description: ++decisionCalls === 1 ? '甲到了新城' : '甲到了另一座城', value: decisionCalls === 1 ? '新城' : '另一座城' }] }));
  await controller.run(f.input);
  const first = f.input.getState();
  expect(first.人物档案.n.个人信息.当前位置).toBe('新城');
  expect(f.host.state.director?.offscreenReceipts['move:character_moved'].consumers).toEqual({ variables: 'done', memory: 'failed' });
  const persistedState = JSON.stringify(first);
  failMemory = false;
  await controller.run(f.input, { backgroundOnly: true });
  expect(JSON.stringify(f.input.getState())).toBe(persistedState);
  expect(storedEvents).toBe(1);
  expect(storedTexts).toEqual(['甲到了新城']);
  expect(f.host.state.director?.offscreenProposals['move:character_moved'].payload.location).toBe('新城');
  expect(f.host.state.director?.plans.move.status).toBe('occurred');
});

test('failed review persists its committed turn for recovery and clears it only after success', async () => {
  const f = fixture();
  const failing = new DirectorReviewController(async () => { throw new Error('API 429'); });
  await failing.run(f.input);
  expect(f.host.state.director?.pendingReview).toEqual({ saveId: 's', worldId: 'w', turnId: 't', round: 1, writesCommitted: true });
  const restored = new DirectorReviewController(async () => emptyDecision());
  await restored.run(f.input);
  expect(f.host.state.director?.pendingReview).toBeUndefined();
  await failing.run({ ...f.input, canReview: () => false });
  expect(f.host.state.director?.pendingReview?.writesCommitted).toBe(false);
});

test('a degraded planning protocol is reported while existing plans still compile', async () => {
  const f = fixture();
  const notices: string[] = [];
  ensureDirectorState(f.host.state).plans.move = { id: 'move', intent: '转移到新城', participants: [], dependencies: [], status: 'ready', priority: 30, source: 'director', visibility: 'foreground', createdAt: 1, updatedAt: 1 };
  const controller = new DirectorReviewController(async () => {
    throw new StructuredOutputValidationError('director_decision 连续 2 次未通过结构校验', '{"plans":[]}', ['plans.0.priority: Too big: expected number to be <=70']);
  });
  const directive = await controller.prepareForTurn({
    engine: f.host, world: { id: 'w', name: '世界', description: '旅行' } as WorldDef, config: {} as ApiConfig,
    context: { saveId: 's', worldId: 'w', completedTurnId: 't', stateVersion: 'v', variableProjection: f.input.getState(), narrative: '雨下了一整天。', memories: [] },
    turnId: 't2', isCurrent: () => true, onDegraded: message => notices.push(message),
  });
  expect(notices.some(message => message.includes('已沿用既有计划'))).toBe(true);
  expect(directive?.primary?.planId).toBe('move');
});

test('foreground effect failure leaves issued plan and owner facts unchanged', async () => {
  const f = fixture();
  const d = ensureDirectorState(f.host.state);
  d.sourceBinding = {type:'authored',sourceId:'d',definitionId:'d',version:'v',boundAt:1};
  const id='source:d:v:n';
  d.plans[id]={id,sourceRef:'n',intent:'甲死亡',participants:['missing'],dependencies:[],status:'directed',priority:80,source:'authored',visibility:'foreground',createdAt:1,updatedAt:1,lastDirectiveId:'dir',authorEffects:[{type:'npc.die',actorId:'missing'}]};
  d.directives.dir={id:'dir',directorRunId:'run',saveId:'s',basedOnTurnId:'previous',issuedForTurnId:'t',primary:{planId:id,intent:'甲死亡',participants:['missing'],priority:80},secondary:[],createdAt:1};
  const before=JSON.stringify(f.input.getState()); const errors:string[]=[]; f.input.onBackgroundError=error=>{if(error)errors.push(error);};
  f.input.narrative='甲死亡。';
  const controller=new DirectorReviewController(async()=>emptyDecision(),async input=>({id:'receipt',turnId:'t',directiveId:'dir',stateVersion:input.stateVersion,outcomes:[{planId:id,outcome:'realized',evidence:'甲死亡'}],createdAt:1}));
  await controller.run(f.input,{sourceAndOutcomeOnly:true});
  expect(f.host.state.director!.plans[id]!.status).toBe('directed'); expect(f.host.state.director!.receipts).toHaveLength(0); expect(JSON.stringify(f.input.getState())).toBe(before); expect(errors.some(e=>e.includes('作者效果未结算'))).toBe(true);
});

test('accepted authored death retries original memory without resubmitting or invalidating death', async () => {
 const f=fixture(); const d=ensureDirectorState(f.host.state); const id='source:d:v:death';
 d.sourceBinding={type:'authored',sourceId:'d',definitionId:'d',version:'v',boundAt:1};
 d.plans[id]={id,sourceRef:'death',intent:'甲死亡',participants:['n'],dependencies:[{kind:'entity',ref:'n'}],status:'ready',priority:80,source:'authored',visibility:'reader_only',createdAt:1,updatedAt:1,authorEffects:[{type:'npc.die',actorId:'n'}]};
 let fail=true; const texts:string[]=[]; f.input.getOffscreenMemoryPort=()=>({hasOffscreenFact:()=>texts.length>0,appendAcceptedEvent:event=>{if(fail)throw new Error('memory offline');texts.push(event.text);}});
 let calls=0; const controller=new DirectorReviewController(async()=>({...emptyDecision(),offscreen:[{planId:id,kind:'world_event',subjectIds:['n'],description:++calls===1?'甲死亡':'替换事件',value:''}]}));
 await controller.run(f.input); expect(f.input.getState().人物档案.n!.战斗状态).toBe('死亡'); expect(f.host.state.director!.plans[id]!.status).not.toBe('invalid'); const before=JSON.stringify(f.input.getState());
 fail=false; await controller.run(f.input,{backgroundOnly:true}); expect(texts).toEqual(['甲死亡']);expect(JSON.stringify(f.input.getState())).toBe(before); expect(f.host.state.director!.plans[id]!.status).toBe('occurred');
});

test('foreground grounded realization settles through the owner once and updates review facts', async () => {
 const f=fixture(); const d=ensureDirectorState(f.host.state); const id='source:d:v:move';
 d.sourceBinding={type:'authored',sourceId:'d',definitionId:'d',version:'v',boundAt:1};
 d.plans[id]={id,sourceRef:'move',intent:'甲迁移',participants:['n'],dependencies:[],status:'directed',priority:80,source:'authored',visibility:'foreground',createdAt:1,updatedAt:1,lastDirectiveId:'dir',authorEffects:[{type:'npc.move',actorId:'n',location:'新城'}]};
 d.directives.dir={id:'dir',directorRunId:'run',saveId:'s',basedOnTurnId:'old',issuedForTurnId:'t',primary:{planId:id,intent:'甲迁移',participants:['n'],priority:80},secondary:[],createdAt:1};
 f.input.narrative='甲迁移到新城。'; let commits=0; const commit=f.input.commitState; f.input.commitState=state=>{commits++;commit(state);};
 const controller=new DirectorReviewController(async()=>emptyDecision(),async input=>({id:'receipt',turnId:'t',directiveId:'dir',stateVersion:input.stateVersion,outcomes:[{planId:id,outcome:'realized',evidence:'甲迁移到新城'}],createdAt:1}));
 await controller.run(f.input,{sourceAndOutcomeOnly:true});
 expect(f.input.getState().人物档案.n!.个人信息.当前位置).toBe('新城'); expect(f.host.state.director!.plans[id]!.status).toBe('occurred'); expect(commits).toBe(1);
 await controller.run(f.input,{sourceAndOutcomeOnly:true}); expect(commits).toBe(1);
});

test('save switch while foreground outcome awaits prevents effect commits', async () => {
 const f=fixture(); const d=ensureDirectorState(f.host.state),id='source:d:v:move';d.sourceBinding={type:'authored',sourceId:'d',definitionId:'d',version:'v',boundAt:1};
 d.plans[id]={id,sourceRef:'move',intent:'迁移',participants:['n'],dependencies:[],status:'directed',priority:80,source:'authored',visibility:'foreground',createdAt:1,updatedAt:1,lastDirectiveId:'dir',authorEffects:[{type:'npc.move',actorId:'n',location:'新城'}]};
 d.directives.dir={id:'dir',directorRunId:'run',saveId:'s',basedOnTurnId:'old',issuedForTurnId:'t',primary:{planId:id,intent:'迁移',participants:['n'],priority:80},secondary:[],createdAt:1};
 const controller=new DirectorReviewController(async()=>emptyDecision(),async input=>{f.changeSave();return{id:'receipt',turnId:'t',directiveId:'dir',stateVersion:input.stateVersion,outcomes:[{planId:id,outcome:'realized',evidence:'雨下了一整天'}],createdAt:1};});
 await controller.run(f.input,{sourceAndOutcomeOnly:true});expect(f.input.getState().人物档案.n!.个人信息.当前位置).toBe('旧城');expect(f.host.state.director!.plans[id]!.status).toBe('directed');
});

test('foreground owner commit still notifies once when later planning fails', async () => {
  const f = fixture();
  const d = ensureDirectorState(f.host.state), id = 'source:d:v:move';
  d.sourceBinding = { type: 'authored', sourceId: 'd', definitionId: 'd', version: 'v', boundAt: 1 };
  d.plans[id] = { id, sourceRef: 'move', intent: '甲迁移', participants: ['n'], dependencies: [], status: 'directed', priority: 80, source: 'authored', visibility: 'foreground', createdAt: 1, updatedAt: 1, lastDirectiveId: 'dir', authorEffects: [{ type: 'npc.move', actorId: 'n', location: '新城' }] };
  d.directives.dir = { id: 'dir', directorRunId: 'run', saveId: 's', basedOnTurnId: 'old', issuedForTurnId: 't', primary: { planId: id, intent: '甲迁移', participants: ['n'], priority: 80 }, secondary: [], createdAt: 1 };
  f.input.narrative = '甲迁移到新城。';
  let notifications = 0; f.input.onCommitted = () => { notifications++; };
  const controller = new DirectorReviewController(async () => { throw new Error('planning unavailable'); }, async input => ({ id: 'receipt', turnId: 't', directiveId: 'dir', stateVersion: input.stateVersion, outcomes: [{ planId: id, outcome: 'realized', evidence: '甲迁移到新城' }], createdAt: 1 }));
  await controller.run(f.input);
  expect(f.input.getState().人物档案.n!.个人信息.当前位置).toBe('新城');
  expect(f.host.state.director!.plans[id]!.status).toBe('occurred');
  expect(notifications).toBe(1);
});
