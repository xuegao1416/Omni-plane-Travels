/**
 * 旧格式 → 统一效果语言。
 * 旧 AI 变量事务（GameplayTransaction）、旧规则条件继续可用，执行全部走新内核。
 */
import type { GameplayCondition, GameplayEffect, GameplayTransaction } from '../gameplay/types';
import type { CoreCondition } from './conditions';
import type { JsonRecord, Op } from './ops';

export function gameplayConditionToCore(condition: GameplayCondition): CoreCondition {
  if ('all' in condition) return { all: condition.all.map(gameplayConditionToCore) };
  if ('any' in condition) return { any: condition.any.map(gameplayConditionToCore) };
  if ('not' in condition) return { not: gameplayConditionToCore(condition.not) };
  if ('state' in condition) return { state: { path: condition.state.path, op: condition.state.op, value: condition.state.value } };
  return { event: { type: condition.event.type, where: condition.event.where } };
}

export function gameplayEffectToOp(effect: GameplayEffect): Op | null {
  if ('set' in effect) return { op: 'set', path: effect.set.path, value: effect.set.value };
  if ('add' in effect) {
    return {
      op: 'add',
      path: effect.add.path,
      value: Number(effect.add.delta),
      ...(effect.add.min === undefined ? {} : { min: effect.add.min }),
      ...(effect.add.max === undefined ? {} : { max: effect.add.max }),
      ...(effect.add.create === undefined ? {} : { create: effect.add.create }),
    };
  }
  if ('append' in effect) return { op: 'append', path: effect.append.path, value: effect.append.value, ...(effect.append.limit ? { limit: effect.append.limit } : {}) };
  if ('remove' in effect) return { op: 'remove', path: effect.remove.path };
  if ('emit' in effect) return { op: 'emit', event: effect.emit.type, payload: effect.emit.payload as JsonRecord | undefined };
  if ('schedule' in effect) return { op: 'schedule', event: effect.schedule.event.type, payload: effect.schedule.event.payload as JsonRecord | undefined, afterTurns: effect.schedule.after };
  return null;
}

/** 条件单独返回：调用方先判条件，不满足时整笔事务不执行。 */
export function gameplayTransactionToOps(transaction: GameplayTransaction): { conditions: CoreCondition[]; ops: Op[] } {
  const ops: Op[] = [];
  for (const cost of transaction.costs ?? []) {
    ops.push({ op: 'add', path: cost.path, value: -Math.abs(Number(cost.amount) || 0), strict: true, label: cost.label });
  }
  for (const effect of transaction.effects ?? []) {
    const op = gameplayEffectToOp(effect);
    if (op) ops.push(op);
  }
  for (const reward of transaction.rewards ?? []) {
    for (const effect of reward.effects) {
      const op = gameplayEffectToOp(effect);
      if (op) ops.push(op);
    }
  }
  for (const event of transaction.events ?? []) {
    ops.push({ op: 'emit', event: event.type, payload: event.payload as JsonRecord | undefined });
  }
  return { conditions: (transaction.conditions ?? []).map(gameplayConditionToCore), ops };
}
