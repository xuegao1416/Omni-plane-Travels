import { requestCompletion } from '../api/client';
import { requestStructuredCompletion } from '../api/structuredOutput';
import { z } from 'zod';
import type { ApiConfig } from '../api/types';
import type { DirectorDirective, DirectorOutcomeItem, DirectorOutcomeReceipt, DirectorState, DirectiveOutcome } from './types';

const allowed = new Set<DirectiveOutcome>(['realized','partially_realized','not_realized','player_rejected','invalidated','deferred']);
const outcomeSchema = z.array(z.object({
  planId: z.string().min(1),
  outcome: z.enum(['realized', 'partially_realized', 'not_realized', 'player_rejected', 'invalidated', 'deferred']),
  evidence: z.string().optional(),
}).strict());

/** Only grounded receipts for this issued directive may advance its plans. */
export function commitDirectiveOutcome(director: DirectorState, directive: DirectorDirective, receipt: DirectorOutcomeReceipt, narrative: string, committed: { turnId: string; stateVersion?: string }): boolean {
  if (receipt.directiveId !== directive.id || receipt.turnId !== committed.turnId
    || receipt.stateVersion !== committed.stateVersion
    || director.receipts.some(previous => previous.id === receipt.id)) return false;
  const issued = new Set([directive.primary, ...directive.secondary].flatMap(item => item ? [item.planId] : []));
  const seen = new Set<string>();
  const outcomes = receipt.outcomes.filter(item => {
    const plan = director.plans[item.planId];
    if (!issued.has(item.planId) || seen.has(item.planId) || !plan || plan.lastDirectiveId !== directive.id || !allowed.has(item.outcome)) return false;
    seen.add(item.planId);
    return true;
  }).map(item => {
    const changesProgress = ['realized', 'partially_realized', 'player_rejected', 'invalidated'].includes(item.outcome);
    return changesProgress && (!item.evidence?.trim() || !narrative.includes(item.evidence))
      ? { planId: item.planId, outcome: 'not_realized' as const }
      : item;
  });
  director.receipts.push({ ...receipt, outcomes });
  outcomes.forEach(item => applyOutcome(director, item, receipt.id));
  return true;
}

function applyOutcome(director: DirectorState, item: DirectorOutcomeItem, receiptId: string) {
  const plan = director.plans[item.planId];
  if (!plan) return;
  if (item.outcome === 'realized') plan.status = 'occurred';
  else if (item.outcome === 'player_rejected' || item.outcome === 'invalidated') plan.status = 'invalid';
  else {
    plan.status = 'ready';
    if (item.outcome === 'partially_realized') plan.priority = Math.max(0, plan.priority - 5);
  }
  plan.lastReceiptId = receiptId;
  plan.updatedAt = Date.now();
}

export async function evaluateDirectiveOutcome(input: {
  director: DirectorState;
  directive: DirectorDirective;
  narrative: string;
  turnId: string;
  stateVersion?: string;
  config: ApiConfig;
  signal?: AbortSignal;
}, request: typeof requestCompletion = requestCompletion): Promise<DirectorOutcomeReceipt> {
  const receiptId = `outcome:${input.turnId}:${input.directive.id}`;
  const committed = input.director.receipts.find(receipt => receipt.id === receiptId);
  if (committed) return committed;
  const all = [input.directive.primary, ...input.directive.secondary].filter(Boolean);
  const prompt = `你是剧情导演的落实审计器。只判断“已经提交的实际正文”是否真正落实了给定导演指导。指导本身不是事实，不得续写剧情，不得为了主线而虚构发生。\n\n指导：${JSON.stringify(all)}\n\n实际正文：\n${input.narrative}\n\n只输出 JSON 数组，每个指导恰好一项 {"planId":"...","outcome":"realized|partially_realized|not_realized|player_rejected|invalidated|deferred","evidence":"正文中的简短原句，不改写"}。`;
  const outcomes = request === requestCompletion
    ? await requestStructuredCompletion({
      config: input.config,
      messages: [{ role: 'user', content: prompt }],
      schema: outcomeSchema,
      schemaName: 'director_outcome',
      temperature: 0,
      signal: input.signal,
      repairAttempts: 1,
    })
    : outcomeSchema.parse(JSON.parse((await request(input.config, [{ role: 'user', content: prompt }], { temperature: 0, signal: input.signal })).text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')));
  if (outcomes.length !== all.length || new Set(outcomes.map(item => item.planId)).size !== all.length || all.some(item => !outcomes.some(outcome => outcome.planId === item!.planId))) throw new Error('落实审查未完整对应本轮指导，请重试');
  const receipt: DirectorOutcomeReceipt = {
    id: receiptId,
    turnId: input.turnId,
    directiveId: input.directive.id,
    stateVersion: input.stateVersion,
    outcomes,
    createdAt: Date.now(),
  };
  commitDirectiveOutcome(input.director, input.directive, receipt, input.narrative, input);
  return receipt;
}
