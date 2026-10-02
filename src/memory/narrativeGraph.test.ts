import { describe, expect, test } from 'bun:test';
import { buildMemoryRuntimeGraphPayload as graph } from './narrativeGraph';
import type { NarrativeEventCard, NarrativeEntityCard, NarrativeThread, NarrativeMutation, SummarySaveRecord, NarrativeStateSlot, VectorFact, SceneAnchor } from './types';

describe('记忆图谱展示', () => {
  test('旧排程事件显示正式标题，保留来源文字和标识且不修改输入', () => {
    const raw = '[本档排程重建，非原存档运行日志] 【wake：圣森醒来】原著证据：用户口述起点；本档安排：待触发';
    const event = { id: 'event_wake', title: raw, summary: raw, excerpt: raw, importance: 3, status: 'hot', entityRefs: ['NPC_格林', 'entity_1'], locationRefs: [], threadRefs: [], timeLabels: [], playerKnown: false, visibility: 'secret', evidence: [raw] } as unknown as NarrativeEventCard;
    const entities = [{ id: 'entity_1', name: '爱丽丝' }] as NarrativeEntityCard[];
    const before = JSON.stringify({ event, entities });
    const result = graph({ tabKey: 'events', events: [event], entities });
    expect(result.definition).toContain('圣森醒来');
    expect(result.definition).toContain('格林');
    expect(result.definition).toContain('爱丽丝');
    expect(result.definition).not.toContain('本档排程重建');
    expect(result.definition).not.toContain('原著证据');
    expect(result.definition).not.toContain('NPC_格林');
    expect(JSON.stringify(result.nodeDetails)).toContain(raw);
    expect(JSON.stringify(result.nodeDetails)).toContain('热点');
    expect(JSON.stringify({ event, entities })).toBe(before);
  });

  test('普通用户文字不套用排程格式清理', () => {
    const event = { title: '读到【章节：雪】原文', summary: '本档安排是用户自定义文字', excerpt: '原著证据也是原句', importance: 1, status: 'warm' } as NarrativeEventCard;
    expect(graph({ tabKey: 'events', events: [event] }).definition).toContain('读到');
    expect(JSON.stringify(graph({ tabKey: 'events', events: [event] }).nodeDetails)).toContain(event.summary);
  });

  test('已知状态显示中文，未知状态保留核查而不映射成功', () => {
    const threads = [{ title: '追踪', status: 'suspended' }, { title: '未来状态', status: 'future' }] as NarrativeThread[];
    const result = graph({ tabKey: 'threads', threads });
    expect(result.definition).toContain('暂停');
    expect(result.definition).toContain('future');
    const summary = { status: 'future', applyResult: { otherCharacterCount: 0, playerCount: 0, itemCount: 0 } } as unknown as SummarySaveRecord;
    expect(JSON.stringify(graph({ tabKey: 'summary', summaryHistory: [summary] }).nodeDetails)).toContain('future');
  });

  test('未知变更使用中文泛称并保留原类型', () => {
    const result = graph({ tabKey: 'mutations', mutations: [{ type: 'future_mutation', appliedCount: 1 }] as NarrativeMutation[] });
    expect(result.definition).toContain('其他变更');
    expect(result.definition).not.toContain('future_mutation');
    expect(JSON.stringify(result.nodeDetails)).toContain('future_mutation');
  });

  test('场景对象名称优先，未知机器标识和普通英文姓名保留正确可核查信息', () => {
    const sceneAnchor = { presentEntities: ['entity_1', 'entity_2', 'Alice', 'NPC_格林'] } as SceneAnchor;
    const result = graph({ tabKey: 'scene', sceneAnchor, entities: [{ id: 'entity_1', name: '爱丽丝' }] as NarrativeEntityCard[] });
    expect(result.definition).toContain('爱丽丝');
    expect(result.definition).toContain('未命名对象');
    expect(result.definition).toContain('Alice');
    expect(result.definition).not.toContain('"entity_2"');
    expect(JSON.stringify(result.nodeDetails)).toContain('entity_2');
  });

  test('状态范围、向量状态期限和检索模式显示中文', () => {
    const state = { id: 's1', scopeType: 'npc', scopeId: 'NPC_格林', status: 'expired', slotType: '位置' } as NarrativeStateSlot;
    const stateResult = graph({ tabKey: 'states', states: [state] });
    expect(stateResult.definition).toContain('角色');
    expect(stateResult.definition).toContain('已过期');
    expect(JSON.stringify(stateResult.nodeDetails)).toContain('NPC_格林');
    const vector = { title: '线索', primaryType: 'clue', importance: 1, timeScope: 'mid', state: 'unknown' } as VectorFact;
    expect(JSON.stringify(graph({ tabKey: 'vector', vectorMemories: [vector] }).nodeDetails)).toContain('中期');
    expect(JSON.stringify(graph({ tabKey: 'vector', vectorMemories: [vector] }).nodeDetails)).toContain('未知');
    const summaryResult = graph({ tabKey: 'summary', lastRetrievePlan: { plannedAt: 0, candidates: [{ title: '圣森线索', source: 'hot_event' }], selectedTitles: [], selectedModes: ['summary', 'excerpt', 'full'], strategy: 'custom' } });
    expect(summaryResult.definition).toContain('热点事件');
    expect(JSON.stringify(summaryResult.nodeDetails)).toContain('摘要, 摘录, 完整内容');
  });
});
