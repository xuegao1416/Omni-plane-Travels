import { expect, test } from 'bun:test';
import type { WorkflowDefinition } from './workflowSchema';
import { workflowToRuleFile, ruleFileToWorkflow } from './workflowConverters';

const workflowWithCardTarget: WorkflowDefinition = {
  version: 1,
  id: 'wf-e2e',
  name: 'E2E 规则链',
  nodes: [
    { id: 'trigger', typeId: 'triggers.periodic', position: { x: 0, y: 0 }, widgetValues: { interval: 1, offset: 0 } },
    {
      id: 'add-event',
      typeId: 'actions.add_event',
      position: { x: 240, y: 0 },
      widgetValues: { event_id: 'evt-e2e', event_pack_id: 'pack-e2e' },
    },
  ],
  connections: [{ id: 'flow-1', sourceNodeId: 'trigger', sourceSocketKey: 'flow_out', targetNodeId: 'add-event', targetSocketKey: 'flow_in' }],
};

test('rule workflow preserves the explicit card event pack binding', () => {
  const ruleFile = workflowToRuleFile(workflowWithCardTarget);
  expect(ruleFile.periodicRules?.[0]?.actions).toEqual([
    { addEvent: { eventId: 'evt-e2e', eventPackId: 'pack-e2e' } },
  ]);

  const restored = ruleFileToWorkflow(ruleFile, 'wf-e2e');
  expect(restored.nodes.find((node) => node.typeId === 'actions.add_event')?.widgetValues).toMatchObject({
    event_id: 'evt-e2e',
    event_pack_id: 'pack-e2e',
  });
});
