import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createEmptyDirectorState } from '../../../../director/types';
import { DirectorOffscreenTab } from './DirectorOffscreenTab';
import { DirectorReceiptsTab } from './DirectorReceiptsTab';
import { DirectorDirectivesTab } from './DirectorDirectivesTab';
import { DirectorPlansTab } from './DirectorPlansTab';

test('normal cards show Chinese names and labels while retaining complete reconstruction evidence in details', () => {
  const director = createEmptyDirectorState();
  const intent = '[本档排程重建，非原存档运行日志]【nid：钟楼来客】原著证据：旧文字；本档安排：新文字';
  director.plans.plan_machine = { id:'plan_machine', intent, participants:['NPC_格林','actor_unknown'], dependencies:[], status:'occurred', priority:2, visibility:'reader_only', source:'novel', sourceRef:'machine_source', createdAt:1, updatedAt:1 };
  director.offscreenProposals.event_machine = { proposalId:'proposal_machine', directorRunId:'run_machine', saveId:'save_machine', baseStateVersion:'v_machine', logicalEventKey:'event_machine', kind:'world_event', subjectIds:['NPC_格林','actor_unknown'], prerequisites:[], occurredAt:'钟楼午夜', visibility:'reader_only', description:intent, payload:{original:'原始证据'}, createdAt:1 };
  director.offscreenReceipts.event_machine = {id:'receipt_machine',proposalId:'proposal_machine',logicalEventKey:'event_machine',status:'accepted',consumers:{variables:'done',memory:'pending'}};
  director.receipts = [{id:'outcome_machine',turnId:'msg_0060_asst',directiveId:'directive_machine',createdAt:1,outcomes:[{planId:'plan_machine',outcome:'realized',evidence:'source:plot_machine; reconstruction:directive_machine'}]}];
  const before = JSON.stringify(director);
  const full = renderToStaticMarkup(<><DirectorOffscreenTab director={director} participantNames={{NPC_格林:'正式格林'}}/><DirectorReceiptsTab director={director}/><DirectorPlansTab director={director}/></>);
  const body = full.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g,'');
  for (const text of ['钟楼来客','正式格林','未知人物','世界事件','已接受','仅读者可见','变量处理：已完成','记忆处理：待处理','第60轮','已落实','存档补记']) expect(body).toContain(text);
  for (const token of ['plan_machine','event_machine','directive_machine','source:plot_machine','world_event','reader_only','原著证据']) expect(body).not.toContain(token);
  for (const text of ['核查详情','原著证据','原始证据','source:plot_machine','reconstruction:directive_machine']) expect(full).toContain(text);
  expect(JSON.stringify(director)).toBe(before);
  director.offscreenProposals.event_machine.description='钟楼来客';
  director.offscreenProposals.event_machine.directorRunId='rebuild:v3';
  const updated=renderToStaticMarkup(<DirectorOffscreenTab director={director}/>).replace(/<details\b[^>]*>[\s\S]*?<\/details>/g,'');
  expect(updated).toContain('存档补记');
  expect(updated).not.toContain('排程重建');
});

test('a secondary-only directive is not relabeled as primary and unknown turn IDs stay unnumbered', () => {
  const director = createEmptyDirectorState();
  director.directives.d = {id:'d',directorRunId:'run',saveId:'save',basedOnTurnId:'unknown_turn_60',secondary:[{planId:'p',intent:'守候钟楼',participants:[],priority:1}],createdAt:1};
  const full = renderToStaticMarkup(<DirectorDirectivesTab director={director}/>);
  const body = full.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g,'');
  expect(body).toContain('次要安排');
  expect(body).toContain('基于回合记录');
  expect(body).not.toContain('主要安排');
  expect(body).not.toContain('第60轮');
});
