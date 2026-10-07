import { expect, test } from 'bun:test';
import { validateDirectorDraft } from './definitionSchema';
import { bindDirectorDefinition, refreshSourceExhaustion } from './sourceAdapter';
import { reconcileDirectorActors } from './actorIdentity';
import { alignDirectorPlans } from './align';
import { commitDirectiveOutcome } from './outcome';
import { decisionSchema, applyDirectorDecision } from './client';
import { createEmptyDirectorState, type PlotPlan, type DirectorReadContext } from './types';
import type { DirectorDefinition } from './definitionTypes';
import { createDefaultGameState } from '../schema/variables';
import { createEmptySimState } from '../simulation/types';
import { compileDirectorDirective } from './runtime';
import { executeAuthoredEffects } from './authoredEffects';

function definition(): DirectorDefinition {
  return { schemaVersion: 1, id: 'd', version: 'v', title: '事件', source: {kind:'author',text:'原稿'}, coreConflict:'冲突', anchors:[], createdAt:1, editedByAuthor:true,
    characters:[{id:'a',name:'甲',aliases:[]}], coverage:{complete:true,gaps:[],boundary:'结束'},
    stages:[{id:'s',title:'阶段',description:'阶段',nodeIds:['n'],failurePolicy:'stop'}],
    nodes:[{id:'n',stageId:'s',title:'事件',intent:'事件',actorIds:['a'],execution:'foreground',conditions:[],dependsOn:[],constraints:[],sourceRefs:['author:0:2'],effects:[{type:'npc.die',actorId:'a'}]}] };
}
const draft = () => { const {schemaVersion,id,version,source,createdAt,editedByAuthor,...rest}=definition(); return rest; };
test('effect declarations reject arbitrary paths and unknown actors while old definitions remain valid',()=>{
  expect(()=>validateDirectorDraft(draft())).not.toThrow();
  const bad=draft(); bad.nodes[0]!.effects=[{type:'npc.die',actorId:'missing'}];
  expect(()=>validateDirectorDraft(bad)).toThrow();
  expect(()=>validateDirectorDraft({...draft(),nodes:[{...draft().nodes[0],effects:[{type:'npc.die',actorId:'a',path:'玩家.生命'}]}]})).toThrow();
  expect(()=>validateDirectorDraft({...draft(),nodes:[{...draft().nodes[0],effects:[{type:'module.rule',moduleId:'m',moduleVersion:'v',ruleId:'r',lifecycle:'arbitrary'}]}]})).toThrow();
  expect(()=>validateDirectorDraft({...draft(),nodes:[{...draft().nodes[0],effects:[{type:'uniqueItem.transfer',moduleId:'m',moduleVersion:'v',itemId:'i',ownerField:'__proto__.owner',expectedOwner:'none',newOwner:'player'}]}]})).toThrow();
  const old=draft(); delete old.nodes[0]!.effects; delete old.stages[0]!.failurePolicy;
  expect(()=>validateDirectorDraft(old)).not.toThrow();
});
test('bound effects are cloned and remap identities without choosing ambiguous names',()=>{
  const source=definition(), d=createEmptyDirectorState(); bindDirectorDefinition(d,source,{roleBinding:{a:'npc1'}});
  expect(d.plans['source:d:v:n']!.authorEffects).toEqual([{type:'npc.die',actorId:'npc1'}]);
  source.nodes[0]!.effects = [{type:'npc.die',actorId:'altered'}]; expect(d.plans['source:d:v:n']!.authorEffects).toEqual([{type:'npc.die',actorId:'npc1'}]);
  const later=createEmptyDirectorState(); bindDirectorDefinition(later,definition());
  reconcileDirectorActors(later,{one:{姓名:'甲'},two:{姓名:'甲'}}); expect(later.plans['source:d:v:n']!.authorEffects).toEqual([{type:'npc.die',actorId:'a'}]);
  reconcileDirectorActors(later,{one:{姓名:'甲'}}); expect(later.plans['source:d:v:n']!.authorEffects).toEqual([{type:'npc.die',actorId:'one'}]);
});
test('a canonical actor id that is also another authored role is resolved only once', () => {
  const source = definition();
  source.characters.push({id:'b',name:'乙',aliases:[]});
  const director = createEmptyDirectorState();
  bindDirectorDefinition(director, source, {roleBinding:{a:'b',b:'npc2'}});
  const state = createDefaultGameState();
  for (const id of ['b','npc2']) state.人物档案[id] = {姓名:id,人物分类:'离场',生存状态:{血量:100,体力值:100},个人信息:{当前位置:'城外',当前状态:'正常'}} as any;
  const plan = director.plans['source:d:v:n']!;
  expect(plan.authorEffects).toEqual([{type:'npc.die',actorId:'b'}]);
  const result = executeAuthoredEffects(state, plan, director, {eventId:'one-remap'});
  expect(result.success).toBe(true);
  expect(result.state.人物档案.b!.战斗状态).toBe('死亡');
  expect(result.state.人物档案.npc2!.生存状态!.血量).toBe(100);
});
test('stop failure keeps later stages pending and source unexhausted',()=>{
  const d=createEmptyDirectorState(); const def=definition(); def.stages.push({id:'s2',title:'后续',description:'后续',nodeIds:['n2']}); def.nodes.push({...def.nodes[0]!,id:'n2',stageId:'s2',effects:undefined}); bindDirectorDefinition(d,def);
  d.plans['source:d:v:n']!.status='invalid'; refreshSourceExhaustion(d);
  expect(d.sourceBinding!.currentStageId).toBeUndefined(); expect(d.sourceBinding!.stages![1]!.status).toBe('pending'); expect(d.sourceBinding!.exhausted).toBe(false);
  d.plans['source:d:v:n2']!.status='ready'; const sim=createEmptySimState(); sim.director=d;
  expect(compileDirectorDirective(sim,'t')).toBeUndefined(); expect(d.plans['source:d:v:n2']!.status).toBe('ready');
});
test('accepted variable effects awaiting memory do not invalidate their own dead actor',()=>{
  const d=createEmptyDirectorState(); bindDirectorDefinition(d,definition()); const p=d.plans['source:d:v:n']!; p.status='ready';
  d.offscreenProposals.k={planId:p.id} as any; d.offscreenReceipts.k={status:'accepted',consumers:{variables:'done',memory:'failed'}} as any;
  const state=createDefaultGameState(); state.人物档案.a={姓名:'甲',战斗状态:'死亡'} as any;
  d.plans.future={...p,id:'future',authorEffects:undefined,dependencies:[{kind:'entity',ref:'a'}]};
  alignDirectorPlans(d,{saveId:'s',worldId:'w',completedTurnId:'t',variableProjection:state,stateVersion:'v',memories:[]});
  expect(p).toMatchObject({status:'directed'}); expect(d.plans.future.status).toBe('invalid');
});
test('realized authored effects require successful settlement before progress',()=>{
  const d=createEmptyDirectorState(); bindDirectorDefinition(d,definition()); const p=d.plans['source:d:v:n']!; p.status='directed'; p.lastDirectiveId='dir';
  const directive={id:'dir',primary:{planId:p.id},secondary:[]} as any; const receipt={id:'r',directiveId:'dir',turnId:'t',outcomes:[{planId:p.id,outcome:'realized',evidence:'甲死了'}]} as any;
  expect(commitDirectiveOutcome(d,directive,receipt,'甲死了',{turnId:'t'})).toBe(false); expect(p.status).toBe('directed'); expect(d.receipts).toHaveLength(0);
});
test('dynamic model plans cannot acquire effect authority even through direct application',()=>{
 const d=createEmptyDirectorState(), state=createDefaultGameState(); const candidate={id:'x',intent:'事件',participants:[],constraints:[],priority:1,visibility:'foreground',evidence:[{kind:'narrative',quote:'事实'}],authorEffects:[{type:'npc.die',actorId:'a'}]};
 expect(()=>decisionSchema.parse({conditions:[],plans:[candidate],offscreen:[]})).toThrow();
 applyDirectorDecision(d,{conditions:[],plans:[candidate],offscreen:[]} as any,{saveId:'s',worldId:'w',stateVersion:'v',variableProjection:state,narrative:'事实',memories:[],completedTurnId:'t'});
 expect(d.plans['actor:x']!.authorEffects).toBeUndefined();
});
