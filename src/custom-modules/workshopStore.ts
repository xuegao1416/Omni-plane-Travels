import { create } from 'zustand';
import type { ApiConfig } from '../api/types';
import type { CustomModuleAgentWorldContext } from './agentSession';
import { runWorkshopAgent } from './agent';
import { classifyWorkshopError } from './agentTransport';
import { insertWorkshopSession, loadWorkshopSessions, persistWorkshopSession, removeWorkshopSession } from './workshopPersistence';
import {
  commitWorkshopRevision, createWorkshopSession, currentWorkshopDraft, deleteWorkshopMessage,
  restoreWorkshopRevision, truncateWorkshopConversation, workshopId,
  type WorkshopMessage, type WorkshopSession,
} from './workshopSession';

export interface ModuleWorkshopStore {
  world?: CustomModuleAgentWorldContext; sessions: WorkshopSession[]; activeSessionId?: string;
  loading: boolean; busy: boolean; error?: string;
  openWorld: (world: CustomModuleAgentWorldContext) => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  createSession: () => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  send: (text: string, config: ApiConfig) => Promise<void>;
  stop: () => void;
  deleteMessage: (id: string) => Promise<void>;
  editMessage: (id: string, text: string, config: ApiConfig) => Promise<void>;
  regenerate: (id: string, config: ApiConfig) => Promise<void>;
  restoreRevision: (id: string) => Promise<void>;
  importModule: (raw: string) => Promise<void>;
}

function finishRun(session: WorkshopSession, runId: string, status: 'complete' | 'stopped' | 'failed', error?: string): WorkshopSession {
  if (!session.runs.some(run => run.id === runId && run.status === 'running')) return session;
  const messages = session.messages.map((message): WorkshopMessage => !message.id.startsWith(`${runId}:`) || message.status !== 'running' ? message : {
    ...message, status,
    parts: message.parts.map(part => part.type === 'tool' && part.status === 'running'
      ? { ...part, status: 'failed', output: { error: error ?? '执行已停止，未自动重放。' } } : part),
  });
  if (error) messages.push({ id: `${runId}:error`, role: 'assistant', status: 'failed', createdAt: Date.now(), parts: [{ type: 'text', text: error }] });
  return { ...session, messages, runs: session.runs.map(run => run.id === runId ? { ...run, status, finishedAt: Date.now(), ...(error ? { error } : {}) } : run) };
}

export function createModuleWorkshopStore(runAgent: typeof runWorkshopAgent = runWorkshopAgent) {
  return create<ModuleWorkshopStore>((set, get) => {
    const cache = new Map<string, WorkshopSession>();
    let queue: Promise<unknown> = Promise.resolve();
    let scope = 0;
    let activeRun: { id: string; sessionId: string; controller: AbortController } | undefined;
    const enqueue = <T,>(work: () => Promise<T>): Promise<T> => {
      const pending = queue.then(work);
      queue = pending.catch(() => undefined);
      return pending;
    };
    const show = (session: WorkshopSession) => {
      cache.set(session.id, session);
      if (get().world?.id === session.world.id) set(state => ({ sessions: state.sessions.some(item => item.id === session.id)
        ? state.sessions.map(item => item.id === session.id ? session : item) : [session, ...state.sessions] }));
    };
    const mutate = (id: string, change: (session: WorkshopSession) => WorkshopSession, guard: () => boolean = () => true) => enqueue(async () => {
      if (!guard()) throw new DOMException('执行已停止', 'AbortError');
      const current = cache.get(id);
      if (!current) throw new Error('会话已不存在，请重新打开');
      const next = change(current);
      if (next === current) return current;
      const saved = await persistWorkshopSession(next, current.version, guard);
      show(saved);
      return saved;
    });
    const active = () => {
      const id = get().activeSessionId;
      if (!id || !cache.has(id)) throw new Error('请先选择创作会话');
      return cache.get(id)!;
    };
    const begin = async (text: string | undefined, config: ApiConfig, messageId?: string) => {
      if (get().busy) throw new Error('请先停止当前执行');
      const session = active();
      const ticket = { id: workshopId(), sessionId: session.id, controller: new AbortController() };
      const runScope = scope;
      activeRun = ticket;
      set({ busy: true, error: undefined });
      const isCurrent = () => activeRun === ticket && scope === runScope && get().activeSessionId === ticket.sessionId && !ticket.controller.signal.aborted;
      try {
        await mutate(session.id, current => {
          const next = messageId ? truncateWorkshopConversation(current, messageId) : current;
          const messages: WorkshopMessage[] = text ? [...next.messages, {
            id: workshopId(), role: 'user', parts: [{ type: 'text', text }], status: 'complete', createdAt: Date.now(),
          }] : next.messages;
          if (!messages.some(message => message.role === 'user')) throw new Error('缺少可供重新生成的用户消息，请发送新的要求。');
          return { ...next, messages, title: next.title === '新的玩法' && text ? text.slice(0, 24) : next.title,
            runs: [...next.runs, { id: ticket.id, status: 'running', startedAt: Date.now() }] };
        }, isCurrent);
        await runAgent({
          config, signal: ticket.controller.signal, runId: ticket.id,
          getSession: () => {
            if (!isCurrent()) throw new DOMException('执行已停止', 'AbortError');
            return cache.get(session.id)!;
          },
          updateSession: change => mutate(session.id, change, isCurrent),
        });
        await mutate(session.id, current => finishRun(current, ticket.id, 'complete'), isCurrent);
      } catch (error) {
        if (isCurrent()) {
          const classified = classifyWorkshopError(error);
          const message = config.apiKey ? classified.message.split(config.apiKey).join('[已隐藏]') : classified.message;
          set({ error: message });
          try { await mutate(session.id, current => finishRun(current, ticket.id, 'failed', message), isCurrent); }
          catch (saveError) { set({ error: `${message}\n保存执行状态失败：${saveError instanceof Error ? saveError.message : String(saveError)}` }); }
        }
      } finally {
        if (activeRun === ticket) { activeRun = undefined; set({ busy: false }); }
      }
    };
    return {
      sessions: [], loading: false, busy: false,
      openWorld: async world => {
        get().stop();
        const currentScope = ++scope;
        set({ world, sessions: [], activeSessionId: undefined, loading: true, error: undefined });
        try {
          await queue;
          const sessions = await loadWorkshopSessions(world);
          if (scope !== currentScope) return;
          for (const session of sessions) cache.set(session.id, session);
          set({ sessions, activeSessionId: sessions[0]?.id });
          if (!sessions.length) await get().createSession();
        } catch (error) {
          if (scope === currentScope) set({ error: error instanceof Error ? error.message : String(error) });
        } finally { if (scope === currentScope) set({ loading: false }); }
      },
      selectSession: async id => {
        if (!get().sessions.some(item => item.id === id)) throw new Error('会话已不存在');
        get().stop(); ++scope;
        set({ activeSessionId: id, error: undefined });
        await mutate(id, session => ({ ...session }));
      },
      createSession: async () => {
        const world = get().world;
        if (!world) throw new Error('请先选择世界');
        get().stop();
        const currentScope = ++scope;
        const session = await enqueue(() => insertWorkshopSession(createWorkshopSession(world)));
        cache.set(session.id, session);
        if (scope === currentScope) { show(session); set({ activeSessionId: session.id, loading: false, error: undefined }); }
      },
      renameSession: async (id, title) => {
        const trimmed = title.trim();
        if (!trimmed) throw new Error('会话名称不能为空');
        await mutate(id, session => ({ ...session, title: trimmed.slice(0, 80) }));
      },
      deleteSession: async id => {
        if (get().activeSessionId === id) get().stop();
        await enqueue(async () => {
          const session = cache.get(id);
          if (!session) throw new Error('会话已不存在');
          await removeWorkshopSession(id, session.world.id, session.version);
          cache.delete(id);
          set(state => {
            const sessions = state.sessions.filter(item => item.id !== id);
            return { sessions, activeSessionId: state.activeSessionId === id ? sessions[0]?.id : state.activeSessionId };
          });
        });
        if (!get().sessions.length) await get().createSession();
      },
      send: async (text, config) => { if (text.trim()) await begin(text.trim(), config); },
      stop: () => {
        const ticket = activeRun;
        if (!ticket) return;
        activeRun = undefined; ticket.controller.abort(); set({ busy: false });
        void mutate(ticket.sessionId, session => finishRun(session, ticket.id, 'stopped')).catch(error => {
          if (get().activeSessionId === ticket.sessionId) set({ error: `保存停止状态失败：${error instanceof Error ? error.message : String(error)}` });
        });
      },
      deleteMessage: async id => { get().stop(); await mutate(active().id, session => deleteWorkshopMessage(session, id)); },
      editMessage: async (id, text, config) => {
        if (!text.trim()) throw new Error('消息不能为空');
        if (active().messages.find(message => message.id === id)?.role !== 'user') throw new Error('仅用户消息可编辑重发');
        get().stop(); await begin(text.trim(), config, id);
      },
      regenerate: async (id, config) => {
        if (active().messages.find(message => message.id === id)?.role !== 'assistant') throw new Error('请选择要重新生成的回答');
        get().stop(); await begin(undefined, config, id);
      },
      restoreRevision: async id => { get().stop(); await mutate(active().id, session => restoreWorkshopRevision(session, id)); },
      importModule: async raw => {
        const value: unknown = JSON.parse(raw);
        let session = active();
        const next = commitWorkshopRevision(session, value, session.currentRevision, '导入模块');
        const previous = currentWorkshopDraft(session);
        if (previous && previous.id !== currentWorkshopDraft(next)?.id) {
          await get().createSession(); session = active();
        }
        get().stop();
        await mutate(session.id, current => commitWorkshopRevision(current, value, current.currentRevision, '导入模块'));
      },
    };
  });
}

export const useModuleWorkshopStore = createModuleWorkshopStore();
