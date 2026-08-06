import { describe, expect, test } from 'bun:test';
import { buildCustomModuleViewModel } from './viewRenderer';
import type { ModuleView } from './schema';

const view: ModuleView = {
  slot: 'right-panel',
  title: 'Focus',
  components: [
    { type: 'text', label: '状态', path: 'title' },
    { type: 'number', label: '分数', path: 'score', format: 'integer' },
    { type: 'progress', label: '进度', path: 'score', min: 0, max: 100 },
    { type: 'badge', label: '模式', path: 'enabled' },
    { type: 'list', label: '标签', path: 'tags' },
    {
      type: 'conditional',
      when: { type: 'compare', path: 'enabled', operator: 'eq', value: true },
      children: [{ type: 'text', text: '已启用' }],
    },
    { type: 'button', label: '查看', event: 'open-history' },
  ],
};

describe('custom module declarative view', () => {
  test('binds fixed components to module state and evaluates conditions', () => {
    const model = buildCustomModuleViewModel(view, {
      title: '专注', score: 42.4, enabled: true, tags: ['calm', 'deep'],
    });

    expect(model.map((item) => item.type)).toEqual(['text', 'number', 'progress', 'badge', 'list', 'text', 'button']);
    expect(model[0]).toMatchObject({ type: 'text', label: '状态', value: '专注' });
    expect(model[1]).toMatchObject({ type: 'number', label: '分数', value: 42.4, format: 'integer' });
    expect(model[2]).toMatchObject({ type: 'progress', value: 42.4, min: 0, max: 100 });
    expect(model[4]).toMatchObject({ type: 'list', value: ['calm', 'deep'] });
    expect(model[6]).toMatchObject({ type: 'button', event: 'open-history' });
  });

  test('does not render false condition branches and safely returns empty values', () => {
    const model = buildCustomModuleViewModel(view, { title: '专注', score: 0, enabled: false });
    expect(model.map((item) => item.type)).toEqual(['text', 'number', 'progress', 'badge', 'list', 'button']);
    expect(model[4]).toMatchObject({ type: 'list', value: [] });
  });
});
