// 卡片 + 事件包 集成测试：
//   (a) CardRenderer.cardFileToBlocks 按编辑器实际导出形态解析出有序 block
//   (b) 注册含 addEvent 的 rule → evaluateTick → collectAddEventEvents 命中 { eventId, eventPackId }
//   (c) 通过 eventBus 模拟 tick 广播路径，断言订阅者收到 { eventId, eventPackId }
import 'fake-indexeddb/auto';
import { test, expect } from 'bun:test';
import type { CardFile, EventRule } from './schema';
import { cardFileToBlocks } from '../components/event/CardRenderer';
import {
  eventWorldEvolution,
  collectAddEventEvents,
} from './eventIntegration';
import { eventBus, EVENTS } from '../engine/eventBus';

const cardFile: CardFile = {
  version: 1,
  puck: {
    root: { props: {} },
    components: {
      title: [{ id: 'card-aaa', props: { title: '遭遇' } }],
      narrative: [{ id: 'card-bbb', props: { text: '你走进山洞' } }],
      choice: [{ id: 'card-ccc', props: { choices: ['左转', '右转'] } }],
    },
  },
  cards: [
    { id: 'card-aaa', componentId: 'title', title: '遭遇', kind: 'add' },
    { id: 'card-bbb', componentId: 'narrative', title: '', kind: 'add' },
    { id: 'card-ccc', componentId: 'choice', title: '', kind: 'add' },
  ],
};

test('(a) cardFileToBlocks 按 cards 顺序还原 3 块', () => {
  const blocks = cardFileToBlocks(cardFile);
  expect(blocks.length).toBe(3);
  expect(blocks[0]).toMatchObject({ id: 'card-aaa', type: 'title', props: { title: '遭遇' } });
  expect(blocks[1]).toMatchObject({ id: 'card-bbb', type: 'narrative' });
  expect(blocks[1].props.text).toBe('你走进山洞');
  expect(blocks[2].type).toBe('choice');
  expect(blocks[2].props.choices).toEqual(['左转', '右转']);
});

test('(b)(c) 含 addEvent 的 rule → 收集到 { eventId, eventPackId } 并经 eventBus 广播', () => {
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
