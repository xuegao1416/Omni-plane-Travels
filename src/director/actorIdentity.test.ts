import { expect, test } from 'bun:test';
import { reconcileDirectorActors } from './actorIdentity';
import { createEmptyDirectorState, type PlotPlan } from './types';

test('a later introduced character binds future plans to the variable-owned identity once', () => {
  const director = createEmptyDirectorState();
  director.sourceBinding = { type: 'authored', sourceId: 'd', version: 'v', boundAt: 0, actorNames: { authorZhao: '赵远', player: '沈清' }, actorAliases: { authorZhao: ['小赵'] }, roleBinding: { authorShen: 'player' } };
  director.plans.p = { id: 'p', participants: ['authorZhao'], dependencies: [{ kind: 'entity', ref: 'authorZhao' }], status: 'waiting' } as PlotPlan;
  reconcileDirectorActors(director, {});
  expect(director.plans.p.participants).toEqual(['authorZhao']);
  reconcileDirectorActors(director, { npc7: { 姓名: '小赵' }, duplicate: { 姓名: '沈清' } });
  expect(director.sourceBinding.roleBinding).toEqual({ authorShen: 'player', authorZhao: 'npc7' });
  expect(director.plans.p.participants).toEqual(['npc7']);
  expect(director.plans.p.dependencies[0]!.ref).toBe('npc7');
  reconcileDirectorActors(director, { replacement: { 姓名: '赵远' } });
  expect(director.sourceBinding.roleBinding?.authorZhao).toBe('npc7');
});

test('ambiguous actor matches stay unresolved and historical plan participants remain unchanged', () => {
  const director = createEmptyDirectorState();
  director.sourceBinding = { type: 'authored', sourceId: 'd', version: 'v', boundAt: 0, actorNames: { a: '赵远' } };
  director.plans.old = { participants: ['a'], dependencies: [{ kind: 'entity', ref: 'a' }], status: 'occurred' } as PlotPlan;
  reconcileDirectorActors(director, { one: { 姓名: '赵远' }, two: { 姓名: '赵远' } });
  expect(director.sourceBinding.roleBinding?.a).toBeUndefined();
  reconcileDirectorActors(director, { one: { 姓名: '赵远' } });
  expect(director.sourceBinding.roleBinding?.a).toBe('one');
  expect(director.plans.old.participants).toEqual(['a']);
});

test('two authored roles sharing a name do not capture the same single NPC by order',()=>{
 const d=createEmptyDirectorState(); d.sourceBinding={type:'authored',sourceId:'d',version:'v',boundAt:1,actorNames:{a:'甲',b:'甲'}};
 d.plans.p={id:'p',intent:'行动',participants:['a','b'],dependencies:[],status:'waiting',priority:80,visibility:'foreground',source:'authored',createdAt:1,updatedAt:1};
 reconcileDirectorActors(d,{npc:{姓名:'甲'}});
 expect(d.sourceBinding.roleBinding?.a).toBeUndefined(); expect(d.sourceBinding.roleBinding?.b).toBeUndefined();
});
