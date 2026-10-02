import type { DirectorState, DirectorTruth, DirectiveOutcome, DirectorVisibility, OffscreenEventKind, PlotPlanStatus, PlotPlanDependency, OffscreenEventReceipt, PlotPlan } from '../../../../director/types';

// Display only: persisted keys and provenance remain untouched in verification details.
const planLabels = { waiting:'等待前提', ready:'可调度', directed:'已下达指令', occurred:'已发生', blocked:'受阻', invalid:'已失效', superseded:'已被替代' } satisfies Record<PlotPlanStatus, string>;
const outcomeLabels = { realized:'已落实', partially_realized:'部分落实', not_realized:'未落实', player_rejected:'玩家拒绝', invalidated:'已失效', deferred:'已暂缓' } satisfies Record<DirectiveOutcome, string>;
const visibilityLabels = { foreground:'前台可见', reader_only:'仅读者可见', secret:'后台保密' } satisfies Record<DirectorVisibility, string>;
const eventLabels = { character_injured:'人物受伤', character_moved:'人物移动', relationship_changed:'人物关系变化', knowledge_changed:'认知变化', faction_relation_changed:'势力关系变化', world_event:'世界事件' } satisfies Record<OffscreenEventKind, string>;
const truthLabels = { true:'已确认', false:'不满足', unknown:'待确认' } satisfies Record<DirectorTruth, string>;
const dependencyLabels = { variable:'变量条件', memory:'记忆依据', plan:'前置计划', entity:'人物或实体', event:'事件依据', condition:'其他条件' } satisfies Record<PlotPlanDependency['kind'], string>;
const receiptLabels = { accepted:'已接受', rejected:'已拒绝', pending:'待处理' } satisfies Record<OffscreenEventReceipt['status'], string>;
const consumerLabels = { pending:'待处理', done:'已完成', failed:'失败' } satisfies Record<OffscreenEventReceipt['consumers']['memory'], string>;
const sourceLabels = { director:'导演安排', novel:'小说主线', authored:'原创主线', legacy:'历史迁移' } satisfies Record<PlotPlan['source'], string>;
const labels: Record<string, string> = { ...planLabels, ...outcomeLabels, ...visibilityLabels, ...eventLabels, ...truthLabels, ...dependencyLabels, ...receiptLabels, ...consumerLabels, ...sourceLabels, all:'全部', free_world:'自由世界', authored_story:'固定主线', authored_story_exhausted:'原稿已结束' };
export function directorLabel(value: string | undefined): string { return value ? labels[value] ?? '未知状态' : '待确认'; }
const stageLabels = { pending:'尚未开始', active:'当前阶段', completed:'已落实', failed:'未达成' } satisfies Record<NonNullable<NonNullable<DirectorState['sourceBinding']>['stages']>[number]['status'], string>;
export function stageLabel(value: string): string { return (stageLabels as Record<string, string>)[value] ?? '未知状态'; }

import { directorTitle } from '../../../../utils/directorDisplayText';
export { directorTitle, isReconstructed, isSupplementaryRecord, turnTitle } from '../../../../utils/directorDisplayText';
export type ParticipantNames = Record<string, string>;
export function participantName(id: string, names: ParticipantNames = {}, director?: DirectorState): string {
  if (id === 'player') return '玩家';
  const source = director?.sourceBinding;
  const actor = Object.entries(source?.roleBinding ?? {}).find(([, bound]) => bound === id)?.[0];
  const known = names[id] || source?.actorNames?.[id] || (actor ? source?.actorNames?.[actor] : undefined);
  if (known && known !== id) return known;
  const prefixed = id.match(/^NPC_([\p{Script=Han}·・]+)$/u);
  return prefixed?.[1] || '未知人物';
}
export function planTitle(director: DirectorState | undefined, id: string): string { return directorTitle(director?.plans[id]?.intent, '关联计划'); }
