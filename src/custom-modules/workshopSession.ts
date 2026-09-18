import type { CustomModuleAgentWorldContext } from './agentSession';
import type { CustomGameplayModuleDefinition } from './schema';
import { validateCustomGameplayModule } from './validator';

export interface WorkshopTextPart { type: 'text'; text: string }
export interface WorkshopToolPart {
  type: 'tool'; toolCallId: string; name: string; input: unknown; output?: unknown;
  status: 'running' | 'complete' | 'failed';
}
export interface WorkshopMessage {
  id: string; role: 'user' | 'assistant'; parts: Array<WorkshopTextPart | WorkshopToolPart>;
  status: 'complete' | 'running' | 'stopped' | 'failed'; createdAt: number;
}
export interface WorkshopRevision {
  id: string; number: number; module: CustomGameplayModuleDefinition;
  summary: string; createdAt: number; baseRevision: number;
}
export interface WorkshopRun {
  id: string; status: 'running' | 'complete' | 'stopped' | 'failed';
  startedAt: number; finishedAt?: number; error?: string;
}
export interface WorkshopSession {
  sessionVersion: 3; id: string; world: CustomModuleAgentWorldContext; title: string;
  messages: WorkshopMessage[]; revisions: WorkshopRevision[]; currentRevision: number;
  runs: WorkshopRun[]; updatedAt: number; version: number;
}
export interface WorkshopPatch {
  op: 'add' | 'replace' | 'remove'; path: string; value?: unknown;
}

export function workshopId(): string { return crypto.randomUUID(); }
export function cloneWorkshopValue<T>(value: T): T { return structuredClone(value); }

export function createWorkshopSession(world: CustomModuleAgentWorldContext): WorkshopSession {
  return {
    sessionVersion: 3, id: workshopId(), world: cloneWorkshopValue(world), title: '新的玩法',
    messages: [], revisions: [], currentRevision: 0, runs: [], updatedAt: Date.now(), version: 0,
  };
}

export function currentWorkshopDraft(session: WorkshopSession): CustomGameplayModuleDefinition | undefined {
  return session.revisions.find(revision => revision.number === session.currentRevision)?.module;
}

export function commitWorkshopRevision(session: WorkshopSession, input: unknown, baseRevision: number, summary: string): WorkshopSession {
  if (baseRevision !== session.currentRevision) throw new Error(`草稿版本已变化：当前为 ${session.currentRevision}，请重新读取草稿后修改。`);
  const validation = validateCustomGameplayModule(input);
  if (!validation.valid || !validation.normalized) {
    throw new Error(validation.errors.map(issue => `${issue.path.join('.') || 'module'}: ${issue.message}`).join('\n') || '模块校验失败');
  }
  const number = (session.revisions.at(-1)?.number ?? 0) + 1;
  const module = cloneWorkshopValue(validation.normalized);
  const previous = currentWorkshopDraft(session);
  if (previous?.id === module.id) {
    const prior = previous.version.split('.').map(Number);
    const next = module.version.split('.').map(Number);
    const newer = next[0] > prior[0] || (next[0] === prior[0] && (next[1] > prior[1] || (next[1] === prior[1] && next[2] > prior[2])));
    if (!newer) module.version = `${prior[0]}.${prior[1]}.${prior[2] + 1}`;
  }
  return {
    ...session, currentRevision: number,
    revisions: [...session.revisions, {
      id: workshopId(), number, module,
      summary: summary.trim() || '修改草稿', createdAt: Date.now(), baseRevision,
    }],
  };
}

function patchPath(pointer: string): string[] {
  if (!pointer.startsWith('/') || pointer === '/') throw new Error('局部修改必须使用非空 JSON Pointer 路径');
  const segments = pointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (segments.some(part => !part || ['__proto__', 'prototype', 'constructor'].includes(part))) throw new Error('不允许的修改路径');
  if (['id', 'kind', 'schemaVersion'].includes(segments[0])) throw new Error('不能通过局部修改更换模块身份或协议版本');
  return segments;
}

export function patchWorkshopDraft(session: WorkshopSession, operations: WorkshopPatch[], baseRevision: number, summary: string): WorkshopSession {
  if (baseRevision !== session.currentRevision) throw new Error('草稿版本冲突，请重新读取草稿');
  const original = currentWorkshopDraft(session);
  if (!original) throw new Error('请先创建模块草稿');
  if (!operations.length || operations.length > 100) throw new Error('每次修改需要 1～100 个局部操作');
  const draft = cloneWorkshopValue(original);
  for (const operation of operations) {
    const segments = patchPath(operation.path);
    let target: unknown = draft;
    for (const segment of segments.slice(0, -1)) {
      if (!target || typeof target !== 'object' || !Object.hasOwn(target, segment)) throw new Error(`路径不存在：${operation.path}`);
      target = (target as Record<string, unknown>)[segment];
    }
    if (!target || typeof target !== 'object') throw new Error(`路径不是容器：${operation.path}`);
    const key = segments.at(-1)!;
    if (Array.isArray(target)) {
      const index = key === '-' && operation.op === 'add' ? target.length : /^\d+$/.test(key) ? Number(key) : -1;
      const max = operation.op === 'add' ? target.length : target.length - 1;
      if (index < 0 || index > max) throw new Error(`数组位置无效：${operation.path}`);
      if (operation.op === 'remove') target.splice(index, 1);
      else if (operation.op === 'add') target.splice(index, 0, cloneWorkshopValue(operation.value));
      else target[index] = cloneWorkshopValue(operation.value);
    } else {
      const record = target as Record<string, unknown>;
      if (operation.op !== 'add' && !Object.hasOwn(record, key)) throw new Error(`路径不存在：${operation.path}`);
      if (operation.op === 'remove') delete record[key];
      else record[key] = cloneWorkshopValue(operation.value);
    }
  }
  return commitWorkshopRevision(session, draft, baseRevision, summary);
}

export function deleteWorkshopMessage(session: WorkshopSession, messageId: string): WorkshopSession {
  // Tool call and result are one persisted part, so deletion cannot orphan a result.
  return { ...session, messages: session.messages.filter(message => message.id !== messageId) };
}

export function truncateWorkshopConversation(session: WorkshopSession, messageId: string): WorkshopSession {
  const index = session.messages.findIndex(message => message.id === messageId);
  if (index < 0) throw new Error('消息已不存在');
  return { ...session, messages: session.messages.slice(0, index) };
}

export function restoreWorkshopRevision(session: WorkshopSession, revisionId: string): WorkshopSession {
  const revision = session.revisions.find(item => item.id === revisionId);
  if (!revision) throw new Error('模块版本已不存在');
  return commitWorkshopRevision(session, revision.module, session.currentRevision, `恢复到版本 ${revision.number}`);
}

export function recoverWorkshopSession(session: WorkshopSession): WorkshopSession {
  return {
    ...session,
    messages: session.messages.map(message => message.status !== 'running' ? message : {
      ...message, status: 'stopped', parts: message.parts.map(part => part.type === 'tool' && part.status === 'running'
        ? { ...part, status: 'failed', output: { error: '执行已中断，未自动重放。' } } : part),
    }),
    runs: session.runs.map(run => run.status !== 'running' ? run : { ...run, status: 'stopped', finishedAt: Date.now() }),
  };
}

export function migrateWorkshopSession(value: unknown, world: CustomModuleAgentWorldContext): WorkshopSession | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const legacy = value as Record<string, unknown>;
  if (legacy.sessionVersion !== 2 || (legacy.world as { id?: string } | undefined)?.id !== world.id) return undefined;
  let session = createWorkshopSession(world);
  session.title = '迁移的共创会话';
  if (Array.isArray(legacy.conversation)) {
    session.messages = legacy.conversation.flatMap((message): WorkshopMessage[] => {
      if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') return [];
      return [{ id: workshopId(), role: message.role, parts: [{ type: 'text', text: message.content }], status: 'complete', createdAt: Date.now() }];
    });
  }
  const input = legacy.lastValidDraft ?? legacy.draft;
  if (input) session = commitWorkshopRevision(session, input, 0, '迁移有效草稿');
  return session;
}
