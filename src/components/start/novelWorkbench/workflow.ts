import type { NovelAnalysisGoal } from '../../../novel/types';
import { readingRangeLabel,type ReadingRange } from './readingRange';

export const WORKFLOW_STEPS = [
  { tab: 0, title: '上传小说', description: '选择小说，确认正文' },
  { tab: 1, title: '选章拆解', description: '先试 10 章，或自选范围' },
  { tab: 2, title: '人物与设定', description: '看拆解效果，也能继续加章' },
  { tab: 4, title: '创建可玩世界', description: '用当前资料开局' },
] as const;

export interface WorkflowState {
  hasDataset: boolean;
  hasSource: boolean;
  hasSegments: boolean;
  hasMaterial: boolean;
  apiReady: boolean;
  analysisPending: boolean;
  worldReady: boolean;
  hasDirector: boolean;
  goal: NovelAnalysisGoal;
  readingRange?: ReadingRange;
  readingRangeError?: string;
}

export type WorkflowAction = 'import' | 'read' | 'range' | 'settings' | 'analyze' | 'review' | 'prepare' | 'director' | 'create';
export interface WorkflowNext { action: WorkflowAction; label: string; description: string }

export function resumeWorkflow(state: WorkflowState): number {
  if (!state.hasDataset) return 0;
  if (!state.hasMaterial) return state.hasSource ? 1 : 0;
  return state.analysisPending && state.hasSegments ? 1 : 2;
}

/** Derive the visible next action from saved results, never from tutorial progress. */
export function nextWorkflowAction(tab: number, state: WorkflowState): WorkflowNext {
  if (!state.hasDataset) return { action: 'import', label: '选择小说文件', description: '上传 TXT、EPUB，或导入之前保存的 JSON 资料。' };
  if (tab === 0) return state.hasMaterial && !state.hasSource
    ? { action: 'review', label: '下一步：查看已有资料', description: '这是已有拆解成果，可以直接检查内容并创建世界。' }
    : { action: 'read', label: '下一步：选择要拆的章节', description: '确认正文没有乱码后，可以先试拆前 10 章，不必一次拆完整本。' };
  if (tab === 1 || !state.hasMaterial) {
    if (state.readingRangeError && state.hasSource) return { action: 'range', label: '先修正章节范围', description: state.readingRangeError };
    if (!state.hasSource && !state.hasMaterial) return { action: 'import', label: '导入有正文的小说', description: '这份档案没有原文或可用资料，请选择 TXT、EPUB 或完整资料备份。' };
    if (state.hasMaterial && !state.analysisPending) return { action: 'review', label: '下一步：查看人物和设定', description: '读取结果已保存，继续查看实际内容。' };
    if (!state.hasSegments) return { action: 'import', label: '检查正文与处理范围', description: '当前没有可读取的正文分段，请检查章节是否参与分析。' };
    if (!state.apiReady) return { action: 'settings', label: '先配置并保存 AI 连接', description: '填写接口和模型，或复制游戏 API 配置，然后保存。' };
    if (state.readingRange) return { action: 'analyze', label: `${state.hasMaterial ? '继续拆解' : '开始拆解'}${readingRangeLabel(state.readingRange)}`, description: `本次范围 ${state.readingRange.selectedCount} 章${state.readingRange.isPartial ? '，其余章节不会调用 AI' : ''}。点击后产生接口费用；拆出资料后可查看效果或创建世界。` };
    return { action: 'analyze', label: state.hasMaterial ? '继续读取未完成内容' : state.goal === 'background' ? '开始读取人物和世界设定' : '开始读取人物、设定和原作故事', description: state.hasMaterial ? '已有成果会保留，继续处理未完成内容；也可以先查看当前资料。' : '点击后开始调用 AI，产生接口费用。可随时暂停并保存进度。' };
  }
  if (tab === 2 || tab === 3) return { action: 'prepare', label: '用当前资料创建世界', description: state.goal === 'background' ? '不必拆完整本：已有的人物与设定就可以用于自由游玩，也可以先增加章节。' : '不必等全书完成：选一个已拆完的故事段，再整理并保存开局剧情。' };
  if (state.goal === 'full') {
    if (!state.worldReady) return { action: 'read', label: '继续读取所选开场故事', description: '当前起始故事段尚不可用。可以在本页选择已完成的段，或继续读取。' };
    if (state.hasSegments && !state.hasDirector) return state.apiReady
      ? { action: 'director', label: '整理并保存开局剧情', description: '完成本页的剧情整理与版本保存后，就能创建世界。' }
      : { action: 'settings', label: '先配置剧情整理使用的 AI', description: '已有资料已保留，配置并保存 AI 连接后回来整理开局剧情。' };
  }
  return { action: 'create', label: '创建世界，回大厅游玩', description: '创建后回到大厅选择这个世界，填写角色并开始冒险。' };
}
