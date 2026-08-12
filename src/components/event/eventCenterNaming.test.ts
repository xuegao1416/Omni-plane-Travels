import { readFileSync } from 'node:fs';
import { test, expect } from 'bun:test';

const eventsScreenSource = readFileSync(new URL('./EventsScreen.tsx', import.meta.url), 'utf8');
const eventCenterSource = readFileSync(new URL('./EventCenter.tsx', import.meta.url), 'utf8');

test('事件中心不再展示历史模块自定义占位入口', () => {
  expect(eventsScreenSource).not.toContain('模块自定义');
  expect(eventsScreenSource).not.toContain('ModuleCustomPlaceholder');
  expect(eventsScreenSource).not.toContain('敬请期待');
});

test('事件中心的新规则入口使用工作流命名', () => {
  expect(eventCenterSource).toContain('新建工作流');
  expect(eventCenterSource).toContain('工作流');
});
