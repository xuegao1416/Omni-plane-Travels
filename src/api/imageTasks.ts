import type { ImageCategory, ImageGenConfig, ImageGenResult, ImageTask } from './imageGenTypes';
import type { ImageBlobRecord, ImageGenerationMetadata } from '../storage/imageDb';

export interface ImageTaskOptions {
  category?: ImageCategory;
  characterName?: string;
  negativePrompt?: string;
  persist?: boolean;
  storageKey?: string;
  signal?: AbortSignal;
  sessionId?: string;
  worldId?: string;
  messageId?: string;
  npcId?: string;
  isCurrent?: () => boolean;
}
interface Dependencies {
  generate(prompt: string, config: ImageGenConfig, signal: AbortSignal): Promise<ImageGenResult>;
  add(task: ImageTask): void;
  update(id: string, patch: Partial<ImageTask>): void;
  tasks(): ImageTask[];
  save(record: ImageBlobRecord, isCurrent?: () => boolean): Promise<unknown>;
  retain(record: ImageBlobRecord): void;
  read(key: string): Promise<ImageBlobRecord | null>;
  records(): Promise<ImageBlobRecord[]>;
}
interface Job {
  task: ImageTask;
  prompt: string;
  config: ImageGenConfig;
  options: ImageTaskOptions;
  controller: AbortController;
  status?: (status: string) => void;
  resolve(task: ImageTask): void;
  reject(error: unknown): void;
  cleanup(): void;
}

/** One request queue; the existing image store owns tasks and imageDb owns paid bytes. */
export class ImageTaskQueue {
  private queue: Job[] = [];
  private active?: Job;
  private recoveries = new Map<string, Promise<ImageTask>>();
  constructor(private readonly deps: Dependencies) {}

  recoverable(prompt: string, options: ImageTaskOptions): ImageTask | undefined {
    if (!options.storageKey) return;
    return this.deps.tasks().findLast(task => task.deliveryKey === options.storageKey
      && task.sourcePrompt === prompt && task.sessionId === options.sessionId && task.hasResult && task.status !== 'completed');
  }

  generate(prompt: string, config: ImageGenConfig, options: ImageTaskOptions = {}, status?: (status: string) => void): Promise<ImageTask> {
    const reusable = this.recoverable(prompt, options);
    if (reusable) return this.reuse(reusable.id, options);
    const captured = structuredClone(config), now = Date.now();
    if (options.negativePrompt !== undefined) captured.negativePrompt = options.negativePrompt;
    const task: ImageTask = { id: `si-${crypto.randomUUID()}`, status: 'queued', prompt,
      negativePrompt: options.negativePrompt ?? '', imageUrl: '', imageBlobKey: null, createdAt: now, updatedAt: now,
      params: {}, errorMessage: '', category: options.category ?? 'story', characterName: options.characterName ?? '',
      sourcePrompt: prompt, deliveryKey: options.storageKey, sessionId: options.sessionId, worldId: options.worldId,
      messageId: options.messageId, npcId: options.npcId };
    this.deps.add(task);
    status?.('queued');
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const abort = () => {
        controller.abort();
        const index = this.queue.findIndex(job => job.task.id === task.id);
        if (index >= 0) {
          const [job] = this.queue.splice(index, 1); job.cleanup();
          this.patch(task.id, { status: 'failed', errorMessage: '生图已取消' });
          reject(new Error('生图已取消'));
        }
      };
      const job: Job = { task, prompt, config: captured, options: { ...options }, controller, status, resolve, reject,
        cleanup: () => options.signal?.removeEventListener('abort', abort) };
      this.queue.push(job);
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      this.process();
    });
  }

  private process(): void {
    if (this.active) return;
    const job = this.queue.shift(); if (!job) return;
    this.active = job;
    this.patch(job.task.id, { status: 'generating' }); job.status?.('generating');
    void this.run(job).then(job.resolve, job.reject).finally(() => {
      job.cleanup(); this.active = undefined; this.process();
    });
  }
  private patch(id: string, patch: Partial<ImageTask>): void { this.deps.update(id, { ...patch, updatedAt: Date.now() }); }
  private current(options: ImageTaskOptions): boolean { return !options.signal?.aborted && (!options.isCurrent || options.isCurrent()); }
  private check(options: ImageTaskOptions): void {
    if (options.signal?.aborted) throw new Error('生图已取消；已完成图片会保留');
    if (!this.current(options)) throw new Error('画像目标已改变；已完成图片保留在本地图片中');
  }
  private async run(job: Job): Promise<ImageTask> {
    const options = { ...job.options, signal: job.controller.signal };
    let paid = false;
    try {
      this.check(options);
      const result = await this.deps.generate(job.prompt, job.config, job.controller.signal);
      paid = true;
      const params = { seed: result.seed, width: result.width, height: result.height, model: result.model,
        sampler: result.sampler, steps: result.steps, scale: result.scale };
      const task = { ...job.task, prompt: result.prompt || job.task.prompt, negativePrompt: result.negativePrompt ?? job.task.negativePrompt, params };
      const generation: ImageGenerationMetadata = { id: task.id, prompt: task.prompt, negativePrompt: task.negativePrompt,
        category: task.category, characterName: task.characterName, params, createdAt: task.createdAt,
        deliveryKey: task.deliveryKey, sourcePrompt: task.sourcePrompt, sessionId: task.sessionId,
        worldId: task.worldId, messageId: task.messageId, npcId: task.npcId };
      const record = { key: task.id, blob: result.blob, size: result.blob.size, mimeType: result.blob.type || 'image/png',
        createdAt: task.createdAt, npcName: task.characterName || undefined, generation };
      this.deps.retain(record);
      this.patch(task.id, { ...task, status: 'generating', hasResult: true });
      // Save the paid source first, even if its originating view or journey has disappeared.
      await this.deps.save(record);
      this.patch(task.id, { imageBlobKey: task.id });
      this.check(options);
      return await this.reuse(task.id, options);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const message = paid ? `图片已生成并保留；${reason}。重试将保存已有图片，不再次生成。` : reason;
      this.patch(job.task.id, { status: 'failed', errorMessage: message });
      throw new Error(message);
    }
  }

  reuse(id: string, options: ImageTaskOptions = {}): Promise<ImageTask> {
    const task = this.deps.tasks().find(task => task.id === id);
    if (!task?.hasResult) return Promise.reject(new Error('该任务没有可恢复的生成图片'));
    const effective = { ...options, storageKey: options.storageKey ?? task.deliveryKey };
    const recoveryKey = JSON.stringify([id, effective.storageKey, effective.sessionId]);
    const running = this.recoveries.get(recoveryKey);
    if (running) return running.then(result => { this.check(effective); return result; });
    const operation = (async () => {
      this.check(effective);
      const record = await this.deps.read(id);
      if (!record) throw new Error('已生成图片无法读取，请保留当前页面并导出备份');
      await this.deps.save(record);
      this.check(effective);
      const deliveryKey = effective.storageKey ?? id;
      if (deliveryKey !== id) {
        await this.deps.save({ ...record, key: deliveryKey,
          generation: { ...record.generation!, deliveryKey } }, () => this.current(effective));
      }
      this.check(effective);
      this.patch(id, { status: 'completed', imageBlobKey: deliveryKey, errorMessage: '' });
      return this.deps.tasks().find(task => task.id === id)!;
    })().catch(error => {
      this.patch(id, { status: 'failed', errorMessage: `图片已生成，恢复未完成：${error instanceof Error ? error.message : String(error)}` });
      throw error;
    }).finally(() => { this.recoveries.delete(recoveryKey); });
    this.recoveries.set(recoveryKey, operation);
    return operation;
  }

  async restore(): Promise<void> {
    const records = await this.deps.records();
    for (const record of records) {
      const generation = record.generation;
      if (!generation || generation.id !== record.key || this.deps.tasks().some(task => task.id === record.key)) continue;
      const delivery = generation.deliveryKey ? await this.deps.read(generation.deliveryKey) : undefined;
      const delivered = !generation.deliveryKey || delivery?.generation?.id === generation.id;
      this.deps.add({ ...generation, status: delivered ? 'completed' : 'failed',
        imageUrl: '', imageBlobKey: delivered ? generation.deliveryKey ?? record.key : record.key,
        updatedAt: record.createdAt, hasResult: true, errorMessage: delivered ? '' : '图片已生成，可恢复使用，无需重新生成' });
    }
  }
}
