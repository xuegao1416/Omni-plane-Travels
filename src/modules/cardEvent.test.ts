// 事件包集成测试：
//   注册含 addEvent 的 rule → evaluateTick → collectAddEventEvents 命中 { eventId, eventPackId }
//   通过 eventBus 模拟 tick 广播路径，断言订阅者收到 { eventId, eventPackId }
import 'fake-indexeddb/auto';
import { test, expect } from 'bun:test';
import type { EventRule } from './schema';
import {
  eventWorldEvolution,
  collectAddEventEvents,
  collectCombatEncounterRequests,
} from './eventIntegration';
import { eventBus, EVENTS } from '../engine/eventBus';

test('含 addEvent 的 rule → 收集到 { eventId, eventPackId } 并经 eventBus 广播', () => {
  eventWorldEvolution.clear();

  const rules: EventRule[] = [
    {
      id: 'r1',
      when: { all: [] },
      then: [{ addEvent: { eventId: 'card-ccc' } }],
    },
  ];
  eventWorldEvolution.registerPack({
    eventPackId: 'card-mod-x',
    rules,
    permissions: ['add_card'],
    runtime: { onceFired: {}, cooldownRemaining: {} },
  });

  const { results } = eventWorldEvolution.evaluateTick({}, 1, []);
  const events = collectAddEventEvents(results);
  expect(events.length).toBe(1);
  expect(events[0]).toEqual({ eventId: 'card-ccc', eventPackId: 'card-mod-x' });

  // 模拟 engine.ts 的广播路径：订阅者收到 { eventId, eventPackId }
  const received: Array<{ eventId: string; eventPackId: string }> = [];
  const off = eventBus.on(EVENTS.EVENT_CARD, (e: { eventId: string; eventPackId: string }) => {
    received.push(e);
  });
  for (const ev of events) eventBus.emit(EVENTS.EVENT_CARD, ev);
  off();

  expect(received.length).toBe(1);
  expect(received[0]).toEqual({ eventId: 'card-ccc', eventPackId: 'card-mod-x' });

  // 无 mod 时 no-op：clean 后 evaluate 不产出任何 addEvent
  eventWorldEvolution.clear();
  const { results: r2 } = eventWorldEvolution.evaluateTick({}, 2, []);
  expect(collectAddEventEvents(r2).length).toBe(0);

  eventWorldEvolution.clear();
});

test('事件工作流以类型化动作发出战斗遭遇请求', () => {
  eventWorldEvolution.clear();
  const request = {
    schemaVersion: 2 as const,
    source: 'event-workflow' as const,
    proposal: {
      schemaVersion: 2 as const,
      id: 'rule-combat', context: '敌对行动已经发生', threatBand: 'matched' as const,
      allies: [], enemies: [{ id: 'enemy', identity: '敌人', temporary: true }], neutrals: [],
    },
  };
  eventWorldEvolution.registerPack({
    eventPackId: 'combat-rule-pack',
    rules: [{ id: 'combat-rule', when: { all: [] }, then: [{ requestCombat: request }] }],
    permissions: ['emit_world_event'],
    runtime: { onceFired: {}, cooldownRemaining: {} },
  });
  const { results } = eventWorldEvolution.evaluateTick({}, 1, []);
  expect(collectCombatEncounterRequests(results)).toEqual([request]);
  eventWorldEvolution.clear();
});
