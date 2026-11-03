import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkshopModulePanel } from './WorkshopModulePanel';
import { commitWorkshopRevision, createWorkshopSession } from '../../custom-modules/workshopSession';
import type { CustomGameplayModuleV3 } from '../../custom-modules/schema';

const world = { id: 'panel-world', name: '面板世界' };
const draft: CustomGameplayModuleV3 = {
  kind: 'custom-gameplay-module', schemaVersion: 3, id: 'panel-craft', name: '试玩用模块', version: '1.0.0', author: 'test', scope: 'world',
  inputs: {}, capabilities: ['currency', 'inventory', 'survival'],
  items: { ore: { name: '矿石' } },
  state: { made: { type: 'number', default: 0, min: 0 } },
  permissions: { read: [], write: 'own-state-only' },
  logic: { onGameStart: [], onTurnEnd: [], onTick: [], onChoice: [], onButton: [{ id: 'craft', actions: [{ type: 'add', path: 'made', value: 1 }] }] },
};
const session = commitWorkshopRevision(createWorkshopSession(world), draft, 0, '创建');
const revision = session.revisions[0];

test('the module panel asks for a draft before the agent has committed one', () => {
  const html = renderToStaticMarkup(<WorkshopModulePanel worldId={world.id} revisions={[]} disabled={false} onRestore={() => undefined} />);
  expect(html).toContain('在这里看见你的玩法');
  expect(html).not.toContain('mws-panel-tabs');
});

test('the committed draft renders its play surface, resource controls and version history entry', () => {
  const html = renderToStaticMarkup(
    <WorkshopModulePanel worldId={world.id} revision={revision} revisions={[revision]} disabled={false} onRestore={() => undefined} />,
  );
  expect(html).toContain(draft.name);
  expect(html).toContain(`${draft.id} · 1.0.0`);
  for (const tab of ['试玩', '规则', '校验', '版本', '存档', 'JSON']) expect(html).toContain(tab);
  expect(html).toContain('独立试玩');
  expect(html).toContain('试玩资源');
  expect(html).toContain('推进一个回合');
});
