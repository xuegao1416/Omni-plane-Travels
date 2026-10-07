import type { GameSave } from './db';

export interface SavePersistence { save(capture: GameSave): Promise<void>; create?(capture: GameSave): Promise<void> }
interface PendingSave { capture: GameSave; revision: number; create?: boolean; waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> }
interface ScheduledSave extends PendingSave { timer: ReturnType<typeof setTimeout> }
export class SaveScheduleCancelledError extends Error { constructor() { super('Scheduled save cancelled'); } }
interface SaveQueue { running: boolean; pending?: PendingSave; failed?: { capture: GameSave; revision: number; create?: boolean } }
export interface SaveOutcome { status: 'saved' | 'failed'; saveId: string; revision: number; error?: unknown }

/** Captures immediately; each save has independent serialization and latest-request coalescing. */
export class SaveCoordinator {
  private readonly queues = new Map<string, SaveQueue>();
  private readonly scheduled = new Map<string, ScheduledSave>();
  private readonly revisions = new Map<string, number>();
  private readonly listeners = new Set<(outcome: SaveOutcome) => void>();
  private readonly creating = new Set<string>();
  constructor(private readonly persistence: SavePersistence) {}

  subscribe(listener: (outcome: SaveOutcome) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private nextRevision(id: string): number { const revision = (this.revisions.get(id) ?? 0) + 1; this.revisions.set(id, revision); return revision; }
  private notify(outcome: SaveOutcome): void {
    for (const listener of this.listeners) {
      try { listener({ ...outcome }); }
      catch (error) { console.error('[save] 保存反馈失败:', error); }
    }
  }

  request(save: GameSave): Promise<void> {
    if (this.creating.has(save.id)) return Promise.reject(new Error('旅程正在创建，请等待创建完成。'));
    const capture = structuredClone(save);
    const scheduled = this.scheduled.get(capture.id);
    if (scheduled) {
      clearTimeout(scheduled.timer);
      this.scheduled.delete(capture.id);
    }
    return this.enqueue(capture, this.nextRevision(capture.id), scheduled?.waiters ?? []);
  }

  async create(save: GameSave): Promise<void> {
    const capture = structuredClone(save), queue = this.queues.get(save.id);
    if (this.creating.has(save.id) || queue?.running || queue?.pending || this.scheduled.has(save.id)) throw new Error('此编号已有保存操作，请等待完成。');
    if (!this.persistence.create) throw new Error('存储服务不支持创建旅程。');
    this.creating.add(save.id);
    try { await this.enqueue(capture, this.nextRevision(save.id), [], true); }
    finally { this.creating.delete(save.id); }
  }

  private enqueue(capture: GameSave, revision: number, inheritedWaiters: PendingSave['waiters'], create = false): Promise<void> {
    let queue = this.queues.get(capture.id);
    if (!queue) { queue = { running: false }; this.queues.set(capture.id, queue); }
    const target = queue;
    const promise = new Promise<void>((resolve, reject) => {
      if (target.pending) { target.pending.capture = capture; target.pending.revision = revision; target.pending.waiters.push(...inheritedWaiters, { resolve, reject }); }
      else target.pending = { capture, revision, create, waiters: [...inheritedWaiters, { resolve, reject }] };
    });
    void this.drain(target);
    return promise;
  }

  schedule(save: GameSave, delay = 500): Promise<void> {
    if (this.creating.has(save.id)) return Promise.reject(new Error('旅程正在创建，请等待创建完成。'));
    const capture = structuredClone(save);
    const existing = this.scheduled.get(capture.id);
    if (existing) clearTimeout(existing.timer);
    const waiters = existing?.waiters ?? [];
    const promise = new Promise<void>((resolve, reject) => waiters.push({ resolve, reject }));
    const timer = setTimeout(() => { void this.runScheduled(capture.id).catch(() => {}); }, delay);
    this.scheduled.set(capture.id, { capture, revision: this.nextRevision(capture.id), timer, waiters });
    return promise;
  }

  async flush(save?: GameSave): Promise<void> {
    if (save) {
      const existing = this.scheduled.get(save.id);
      if (existing) existing.capture = structuredClone(save);
    }
    const scheduledIds = [...this.scheduled.keys()];
    await Promise.all([
      ...scheduledIds.map(id => this.runScheduled(id)),
      ...(save && !scheduledIds.includes(save.id) ? [this.request(save)] : []),
    ]);
  }

  cancelScheduled(saveId?: string): void {
    for (const [id, pending] of this.scheduled) {
      if (saveId !== undefined && id !== saveId) continue;
      clearTimeout(pending.timer);
      this.scheduled.delete(id);
      for (const waiter of pending.waiters) waiter.reject(new SaveScheduleCancelledError());
    }
  }

  private async runScheduled(saveId: string): Promise<void> {
    const pending = this.scheduled.get(saveId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.scheduled.delete(saveId);
    try {
      await this.enqueue(pending.capture, pending.revision, []);
      for (const waiter of pending.waiters) waiter.resolve();
    } catch (error) {
      for (const waiter of pending.waiters) waiter.reject(error);
      throw error;
    }
  }

  getFailedCapture(saveId: string): GameSave | undefined {
    const failed = this.queues.get(saveId)?.failed;
    return failed ? structuredClone(failed.capture) : undefined;
  }

  async retryFailed(saveId: string): Promise<void> {
    const queue = this.queues.get(saveId);
    const failed = queue?.failed;
    if (!failed) throw new Error('这份进度已保存，无需重试。');
    if (queue.running || queue.pending || this.scheduled.has(saveId) || this.revisions.get(saveId) !== failed.revision) throw new Error('已有更新进度正在等待保存，请保存当前游戏；旧备份不会覆盖新进度。');
    if (failed.create) await this.create(failed.capture);
    else await this.request(failed.capture);
  }

  private async drain(queue: SaveQueue): Promise<void> {
    if (queue.running) return;
    queue.running = true;
    try {
      while (queue.pending) {
        const pending = queue.pending;
        queue.pending = undefined;
        try {
          if (pending.create) await this.persistence.create!(pending.capture);
          else await this.persistence.save(pending.capture);
          queue.failed = undefined;
          this.notify({ status: 'saved', saveId: pending.capture.id, revision: pending.revision });
          for (const waiter of pending.waiters) waiter.resolve();
        } catch (error) {
          queue.failed = { capture: pending.capture, revision: pending.revision, create: pending.create };
          this.notify({ status: 'failed', saveId: pending.capture.id, revision: pending.revision, error });
          for (const waiter of pending.waiters) waiter.reject(error);
        }
      }
    } finally { queue.running = false; }
  }
}
