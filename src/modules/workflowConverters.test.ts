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

test('visual workflow preserves a typed semantic combat request', () => {
  const workflow: WorkflowDefinition = {
    version: 1,
    id: 'wf-combat',
    name: '结构化战斗工作流',
    nodes: [
      { id: 'trigger', typeId: 'triggers.periodic', position: { x: 0, y: 0 }, widgetValues: { interval: 1 } },
      {
        id: 'combat', typeId: 'actions.request_combat', position: { x: 240, y: 0 },
        widgetValues: {
          proposal_id: 'workflow-encounter', context: '敌人已经发动袭击', threat_band: 'dangerous',
          allies_json: [], enemies_json: [{ id: 'enemy', identity: '敌人', temporary: false }], neutrals_json: [],
        },
      },
    ],
    connections: [{ id: 'flow', sourceNodeId: 'trigger', sourceSocketKey: 'flow_out', targetNodeId: 'combat', targetSocketKey: 'flow_in' }],
  };
  const ruleFile = workflowToRuleFile(workflow);
  const action = ruleFile.periodicRules?.[0]?.actions?.[0];
  expect(action).toMatchObject({ requestCombat: { source: 'event-workflow', proposal: { id: 'workflow-encounter', threatBand: 'dangerous' } } });
  const restored = ruleFileToWorkflow(ruleFile, 'wf-combat-restored');
  expect(restored.nodes.find(node => node.typeId === 'actions.request_combat')?.widgetValues).toMatchObject({ proposal_id: 'workflow-encounter', threat_band: 'dangerous' });
});
