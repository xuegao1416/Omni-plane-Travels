import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DirectorDraftFields } from './DirectorAuthorEditor';
import type { DirectorDraft } from '../../../director/definitionSchema';

function largeDraft(): DirectorDraft {
  const nodes: DirectorDraft['nodes'] = Array.from({ length: 100 }, (_, i) => ({ id: `n${i}`, stageId: 's', title: `事件${i}`, intent: '寻找线索', actorIds: [], execution: 'foreground', conditions: [], dependsOn: [], constraints: [], sourceRefs: [] }));
  return { title: '开局', coreConflict: '调查', anchors: [], coverage: { complete: false, gaps: [], boundary: '调查阶段' }, characters: Array.from({ length: 100 }, (_, i) => ({ id: `a${i}`, name: `人物${i}`, aliases: [] })), stages: [{ id: 's', title: '调查阶段', description: '调查', nodeIds: nodes.map(n => n.id) }], nodes };
}

test('collapsed novel details do not allocate the event and character editing tree', () => {
  const html = renderToStaticMarkup(<DirectorDraftFields draft={largeDraft()} setDraft={() => {}} start="s" onStartChange={() => {}} novel />);
  expect(html).toContain('查看或修改剧情细节');
  expect(html.includes('<textarea')).toBe(false);
  expect(html.includes('type="checkbox"')).toBe(false);
  expect(html.length).toBeLessThan(1000);
});

test('author fields remain available while collapsed stage and character editors stay unmounted', () => {
  const html = renderToStaticMarkup(<DirectorDraftFields draft={largeDraft()} setDraft={() => {}} start="s" onStartChange={() => {}} novel={false} />);
  expect(html).toContain('核心冲突');
  expect(html).toContain('调查阶段');
  expect(html).toContain('参与人物');
  expect(html.includes('type="checkbox"')).toBe(false);
  expect(html.includes('人物姓名')).toBe(false);
});
