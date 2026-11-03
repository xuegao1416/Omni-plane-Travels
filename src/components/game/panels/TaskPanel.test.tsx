import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createDefaultGameState, type NPCData, type Task } from '../../../schema/variables';
import { initializePlayerKnowledge } from '../../../engine/playerKnowledge';
import { RequirementList } from './TaskPanel';

test('NPC task requirements display the last known relationship instead of offscreen truth', () => {
  let state = createDefaultGameState();
  state.人物档案.n = { 姓名: '证人', 人物分类: '离场', 关系数据: { 好感度: 20 } } as NPCData;
  state = initializePlayerKnowledge(state, { turnId: 'start', eventId: 'start', quote: '已知关系' });
  state.人物档案.n.关系数据.好感度 = 80;
  const task = { NPC需求: [{ NPC名: '证人', 最低好感度: 50 }] } as Task;
  const markup = renderToStaticMarkup(<RequirementList task={task} gameState={state} />);
  expect(markup).toContain('上次获知: 20');
  expect(markup).not.toContain('80');
  expect(markup).not.toContain('lucide-circle-check');
  state.playerKnowledge!.characters = {};
  const unknown = renderToStaticMarkup(<RequirementList task={task} gameState={state} />);
  expect(unknown).toContain('未知');
  expect(unknown).not.toContain('80');
});
