import { expect, test } from 'bun:test';
import { collectAddEventEvents } from './eventIntegration';
import { executeWorkflowAsEvaluation } from './workflowBridge';
import {
  WORLD_WORKFLOWS,
  normalizeBuiltinCardWorkflow,
} from './worldWorkflows';
import type { CardWorkflowDefinition } from './schema';
import { WORLDS } from '../data/worldLoader';

test('six built-in worlds expose paced workflows bound to their card packs', () => {
  expect(Object.keys(WORLD_WORKFLOWS).sort()).toEqual([
    'border_trade', 'desire_metropolis', 'japanese_school',
    'stranded_island', 'wasteland_apocalypse', 'wuxia_world',
  ]);

  const workflow = WORLD_WORKFLOWS.japanese_school('world:japanese_school:events', [
    { id: 'school_evt', name: '校园事件' },
  ]);
  const runtime = { onceFired: {}, cooldownRemaining: {} };
  const before = executeWorkflowAsEvaluation(workflow, {} as never, 1, [], runtime, 'world:japanese_school:rules', ['add_card']);
  const due = executeWorkflowAsEvaluation(workflow, {} as never, 4, [], runtime, 'world:japanese_school:rules', ['add_card']);

  expect(collectAddEventEvents([before])).toEqual([]);
  expect(collectAddEventEvents([due])).toEqual([
    { eventId: 'school_evt', eventPackId: 'world:japanese_school:events' },
  ]);
});

test('built-in card workflow repair keeps choices and stat effects executable', () => {
  const workflow: CardWorkflowDefinition = {
    version: 1,
    id: 'legacy',
    name: '旧事件',
    nodes: [
      {
        id: 'choices', typeId: 'choice.static', position: { x: 0, y: 0 },
        widgetValues: { options: '[{"label":"A"},{label:"B","aiNote":"继续"}]' },
      },
      {
        id: 'effect', typeId: 'effect.stat', position: { x: 0, y: 100 },
        widgetValues: { statKey: '体力值', delta: -1 },
      },
    ],
    connections: [],
  };

  const repaired = normalizeBuiltinCardWorkflow(workflow);
  expect(JSON.parse(String(repaired.nodes[0].widgetValues?.options))).toHaveLength(2);
  expect(repaired.nodes[1].widgetValues?.statKey).toBe('attrB');
});

test('all 40 shipped cards normalize to valid choices and canonical stat keys', () => {
  let count = 0;
  for (const world of WORLDS) {
    for (const pack of world.eventPacks ?? []) {
      for (const event of pack.events ?? []) {
        const repaired = normalizeBuiltinCardWorkflow(event.workflow!);
        count++;
        for (const node of repaired.nodes) {
          if (node.typeId === 'choice.static') {
            expect(() => JSON.parse(String(node.widgetValues?.options))).not.toThrow();
          }
          if (node.typeId === 'effect.stat') {
            expect(['attrA', 'attrB', 'dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'])
              .toContain(String(node.widgetValues?.statKey));
          }
        }
      }
    }
  }
  expect(count).toBe(40);
});
