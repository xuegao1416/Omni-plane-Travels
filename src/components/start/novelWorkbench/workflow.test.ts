import { describe, expect, test } from 'bun:test';
import { nextWorkflowAction, resumeWorkflow, type WorkflowState } from './workflow';

const imported: WorkflowState = {
  hasDataset: true, hasSource: true, hasSegments: true, hasMaterial: false,
  apiReady: true, analysisPending: true, worldReady: false, hasDirector: false, goal: 'background',
};

describe('小说拆解台连续操作', () => {
  test('千章小说试拆前十章时，主操作明确显示本次范围', () => {
    const trial = { ...imported, readingRange: { startChapterIndex: 0, endChapterIndex: 9, chapterCount: 3000, selectedCount: 10, isPartial: true } };
    const action = nextWorkflowAction(1, trial);
    expect(action.action).toBe('analyze');
    expect(action.label).toContain('1–10');
    expect(action.description).toContain('10 章');
    expect(action.description).not.toContain('读取全书');
  });
  test('章节范围无效时，主操作要求修正范围，不启动旧任务', () => {
    const invalid = { ...imported, readingRangeError: '结束章不能早于起始章。' };
    expect(nextWorkflowAction(1, invalid).action).toBe('range');
    expect(nextWorkflowAction(1, invalid).description).toContain('结束章');
  });
  test('导入后下一步进入读取，读取页的主操作实际启动 AI', () => {
    expect(nextWorkflowAction(0, imported).action).toBe('read');
    expect(nextWorkflowAction(1, imported).action).toBe('analyze');
  });
  test('未配置 AI 时给出可执行的配置入口', () => {
    expect(nextWorkflowAction(1, { ...imported, apiReady: false }).action).toBe('settings');
  });
  test('资料还未读取时，从查看或创建页也能找到读取动作', () => {
    for (const tab of [2, 3, 4]) expect(nextWorkflowAction(tab, imported).action).toBe('analyze');
  });
  test('已完成的静态成果无需 AI 或原文也能直接创建', () => {
    const staticResult = { ...imported, hasSource: false, hasSegments: false, hasMaterial: true, apiReady: false, analysisPending: false };
    expect(nextWorkflowAction(0, staticResult).action).toBe('review');
    expect(nextWorkflowAction(1, staticResult).action).toBe('review');
    expect(nextWorkflowAction(2, staticResult).action).toBe('prepare');
    expect(nextWorkflowAction(4, staticResult).action).toBe('create');
    expect(resumeWorkflow(staticResult)).toBe(2);
  });
  test('读取中断后回到读取页，完成后回到资料页', () => {
    expect(resumeWorkflow(imported)).toBe(1);
    expect(resumeWorkflow({ ...imported, hasMaterial: true })).toBe(1);
    const ready = { ...imported, hasMaterial: true, analysisPending: false };
    expect(resumeWorkflow(ready)).toBe(2);
    expect(nextWorkflowAction(1, ready).action).toBe('review');
  });
  test('原作玩法按起点、剧情保存、创建的顺序完成', () => {
    const full: WorkflowState = { ...imported, hasMaterial: true, analysisPending: false, goal: 'full' };
    expect(nextWorkflowAction(4, full).action).toBe('read');
    expect(nextWorkflowAction(4, { ...full, worldReady: true }).action).toBe('director');
    expect(nextWorkflowAction(4, { ...full, worldReady: true, apiReady: false }).action).toBe('settings');
    expect(nextWorkflowAction(4, { ...full, worldReady: true, hasDirector: true, apiReady: false }).action).toBe('create');
  });
  test('缺少原文或全部排除的档案可以回到导入修正', () => {
    expect(nextWorkflowAction(1, { ...imported, hasSource: false, hasSegments: false }).action).toBe('import');
    expect(nextWorkflowAction(1, { ...imported, hasSegments: false }).action).toBe('import');
    expect(nextWorkflowAction(4, { ...imported, hasDataset: false }).action).toBe('import');
  });
});
