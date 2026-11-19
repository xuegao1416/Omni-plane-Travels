/**
 * 变量提取的意图格式（新格式）。每条意图一个扁平对象：一个动词键 + 值 + because（正文依据）。
 *
 *   {"set":"玩家.当前目标","value":"去口岸","because":"他说要去口岸"}
 *   {"add":"player.stats.hp","delta":-12,"because":"被狼咬伤"}
 *   {"append":"人物档案.li.人物事迹","value":"在码头救下落水的孩子","because":"…"}
 *   {"remove":"玩家.任务系统.活跃任务.寻人","because":"…"}
 *   {"command":"resources.consume","args":{"id":"water","amount":1},"because":"煮了一壶水"}
 *
 * 本地逐条按玩法宿主的变量表（含别名）与 AI 命令白名单校验：不合格的意图丢弃并给出原因，
 * 合格的转成一笔 GameplayTransaction 交给原来的结算路径。全部不合格时整笔拒绝，
 * 原因交给提取重试（附上本次输出与逐条原因）。旧的 GameplayTransaction 格式照样接受。
 */
import type { FactRegistry } from '../core/facts';

export const INTENT_VERBS = ['set', 'add', 'append', 'remove', 'command'] as const;
type Verb = typeof INTENT_VERBS[number];

/** 意图格式允许的顶层字段（另外几项元数据由提取流程先行剥离）。 */
export const INTENT_PAYLOAD_KEYS = new Set(['intents', 'id', 'label', 'source']);

const FORBIDDEN_FIELDS = new Set(['before', 'after']);
const DANGEROUS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_INTENTS = 60;
const MAX_COMMANDS = 12;

export interface IntentConversion {
  /** 合格意图转成的事务；一条都不合格时为空。 */
  transaction?: Record<string, unknown>;
  /** 被丢弃的意图及原因（「第 n 条：…」）。 */
  rejected: string[];
  accepted: number;
}

export interface IntentContext {
  facts: FactRegistry;
  /** 本世界允许 AI 调用的命令。 */
  commands: ReadonlySet<string>;
  /** 世界/玩家/人物档案下的原始路径是否允许（沿用旧格式的规则）。 */
  rawPathAllowed(path: string): boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasForbidden(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== 'object' || depth > 12) return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => FORBIDDEN_FIELDS.has(key) || hasForbidden(child, depth + 1));
}

export function isIntentPayload(value: unknown): value is Record<string, unknown> & { intents: unknown[] } {
  return isRecord(value) && Array.isArray(value.intents);
}

function pathIssue(path: unknown, context: IntentContext): string | undefined {
  if (typeof path !== 'string' || !path.trim()) return '缺少变量路径';
  const normalized = path.trim();
  const parts = normalized.split('.');
  if (parts.some(part => !part || DANGEROUS.has(part) || FORBIDDEN_FIELDS.has(part))) return `路径「${normalized}」不合法`;
  const resolved = context.facts.resolve(normalized);
  if (resolved?.spec) {
    if (!context.facts.canWrite(normalized, 'ai')) return `「${context.facts.label(normalized)}」由本地规则结算，不能直接写`;
    return undefined;
  }
  return context.rawPathAllowed(normalized) ? undefined : `路径「${normalized}」不存在或不允许写（只能写世界、玩家、人物档案下的路径或模块说明里给出的变量）`;
}

/** 把意图转成事务；不合格的逐条给出原因。 */
export function intentsToTransaction(payload: Record<string, unknown> & { intents: unknown[] }, context: IntentContext): IntentConversion {
  const rejected: string[] = [];
  const effects: Array<Record<string, unknown>> = [];
  const commands: Array<{ command: string; args: Record<string, unknown> }> = [];
  const reasons: string[] = [];
  const extra = Object.keys(payload).filter(key => !INTENT_PAYLOAD_KEYS.has(key));
  if (extra.length) rejected.push(`顶层字段 ${extra.join('、')} 不属于意图格式，已忽略`);
  if (payload.intents.length > MAX_INTENTS) rejected.push(`意图超过 ${MAX_INTENTS} 条，只处理前 ${MAX_INTENTS} 条`);

  payload.intents.slice(0, MAX_INTENTS).forEach((raw, index) => {
    const reject = (message: string) => rejected.push(`第 ${index + 1} 条：${message}`);
    if (!isRecord(raw)) return reject('意图必须是对象');
    const verbs = INTENT_VERBS.filter(verb => verb in raw) as Verb[];
    if (verbs.length !== 1) return reject(`需要且只能有一个动词（${INTENT_VERBS.join(' / ')}），现在是 ${verbs.join('、') || '无'}`);
    const verb = verbs[0];
    if (hasForbidden(raw)) return reject('禁止使用 before/after 字段');
    if (typeof raw.because === 'string' && raw.because.trim()) reasons.push(raw.because.trim());

    if (verb === 'command') {
      const command = raw.command;
      if (typeof command !== 'string' || !context.commands.has(command)) return reject(`命令「${String(command)}」在本世界不可用（可用：${[...context.commands].join('、') || '无'}）`);
      if (raw.args !== undefined && !isRecord(raw.args)) return reject('args 必须是对象');
      if (commands.length >= MAX_COMMANDS) return reject(`一轮最多 ${MAX_COMMANDS} 条命令`);
      commands.push({ command, args: isRecord(raw.args) ? raw.args : {} });
      return;
    }
    const path = raw[verb];
    const issue = pathIssue(path, context);
    if (issue) return reject(issue);
    const target = String(path).trim();
    if (verb === 'set') {
      if (!('value' in raw)) return reject('set 需要 value');
      effects.push({ set: { path: target, value: raw.value } });
    } else if (verb === 'add') {
      const delta = Number(raw.delta);
      if (!Number.isFinite(delta)) return reject('add 需要数字 delta');
      effects.push({ add: { path: target, delta } });
    } else if (verb === 'append') {
      if (!('value' in raw)) return reject('append 需要 value');
      effects.push({ append: { path: target, value: raw.value } });
    } else {
      effects.push({ remove: { path: target } });
    }
  });

  const accepted = effects.length + commands.length;
  if (!accepted) return { rejected, accepted };
  const why = reasons.slice(0, 3).join('；');
  const label = typeof payload.label === 'string' && payload.label.trim() ? payload.label.trim() : `变量裁定${why ? `：${why.length > 60 ? `${why.slice(0, 60)}…` : why}` : ''}`;
  return {
    transaction: {
      ...(typeof payload.id === 'string' && payload.id ? { id: payload.id } : {}),
      source: 'ai', label,
      ...(effects.length ? { effects } : {}),
      ...(commands.length ? { commands } : {}),
    },
    rejected,
    accepted,
  };
}
