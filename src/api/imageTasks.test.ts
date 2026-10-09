import { expect, test } from 'bun:test';
import { ImageTaskQueue } from './imageTasks';
import { DEFAULT_IMAGE_CONFIG, type ImageTask, type ImageGenResult, type ImageGenConfig } from './imageGenTypes';
import type { ImageBlobRecord } from '../storage/imageDb';

const result: ImageGenResult = { blob: new Blob(['paid image'], { type: 'image/png' }), seed: 42,
  prompt: 'effective prompt', negativePrompt: '', width: 512, height: 512, model: 'test', sampler: 'test', steps: 28, scale: 5 };
function fixture(generate: (prompt: string, config: ImageGenConfig, signal: AbortSignal) => Promise<ImageGenResult> = async () => result) {
  const tasks = new Map<string, ImageTask>(), records = new Map<string, ImageBlobRecord>();
  let calls = 0, failWrites = false;
  const queue = new ImageTaskQueue({
    generate: async (...args) => { calls++; return generate(...args); },
    add: task => tasks.set(task.id, task), update: (id, patch) => tasks.set(id, { ...tasks.get(id)!, ...patch }),
    tasks: () => [...tasks.values()],
    save: async record => { if (failWrites) throw new Error('quota'); records.set(record.key, record); },
    read: async key => records.get(key) ?? null, records: async () => [...records.values()],
    retain: record => records.set(record.key, record),
  });
  return { queue, tasks, records, calls: () => calls, fail: (value: boolean) => { failWrites = value; } };
}

test('a paid result survives a failed write and retries storage without another generation', async () => {
  const f = fixture(); f.fail(true);
  await expect(f.queue.generate('source', DEFAULT_IMAGE_CONFIG, { storageKey: 'inline-image', sessionId: 'save-a' })).rejects.toThrow('已生成');
  const task = [...f.tasks.values()][0]!;
  expect(f.records.get(task.id)?.blob).toBe(result.blob);
  f.fail(false);
  const recovered = await f.queue.generate('source', DEFAULT_IMAGE_CONFIG, { storageKey: 'inline-image', sessionId: 'save-a' });
  expect(f.calls()).toBe(1);
  expect(recovered.imageBlobKey).toBe('inline-image');
  expect(f.records.get('inline-image')?.generation?.params.seed).toBe(42);
});

test('a stale target preserves its paid result but never replaces the live delivery key', async () => {
  let release!: (value: ImageGenResult) => void;
  const f = fixture(() => new Promise<ImageGenResult>(resolve => { release = resolve; }));
  let current = true;
  const promise = f.queue.generate('source', DEFAULT_IMAGE_CONFIG, { storageKey: 'portrait-a', isCurrent: () => current });
  await Promise.resolve(); current = false; release(result);
  await expect(promise).rejects.toThrow('目标已改变');
  expect(f.records.size).toBe(1);
  expect(f.records.has('portrait-a')).toBe(false);
});

test('a queued cancelled job never invokes the provider', async () => {
  let release!: (value: ImageGenResult) => void;
  const f = fixture(() => new Promise<ImageGenResult>(resolve => { release = resolve; }));
  const active = f.queue.generate('first', DEFAULT_IMAGE_CONFIG);
  const controller = new AbortController();
  const queued = f.queue.generate('second', DEFAULT_IMAGE_CONFIG, { signal: controller.signal });
  controller.abort();
  await expect(queued).rejects.toThrow('取消');
  release(result); await active;
  expect(f.calls()).toBe(1);
});

test('paid results recover their metadata after task projection reload', async () => {
  const f = fixture();
  const generated = await f.queue.generate('source', DEFAULT_IMAGE_CONFIG, { sessionId: 'save-a', messageId: 'message-a' });
  const metadata = f.records.get(generated.id)!.generation!;
  expect(metadata.sessionId).toBe('save-a');
  expect(metadata.messageId).toBe('message-a');
  f.tasks.clear(); await f.queue.restore();
  expect(f.tasks.get(generated.id)?.params.seed).toBe(42);
  await f.queue.reuse(generated.id, { storageKey: 'portrait-reused', isCurrent: () => true });
  expect(f.records.has('portrait-reused')).toBe(true);
  expect(f.calls()).toBe(1);
});

test('unused negative prompts are not restored into generated image metadata', async () => {
  const f = fixture();
  const task = await f.queue.generate('source', { ...DEFAULT_IMAGE_CONFIG, engine: 'openai_compatible' }, {
    storageKey: 'compatible-image', negativePrompt: 'unsupported negative prompt',
  });
  expect(task.negativePrompt).toBe('');
  expect(f.records.get('compatible-image')?.generation?.negativePrompt).toBe('');
});

test('queued requests use their captured configuration and cancelled paid responses are still saved', async () => {
  let release!: (value: ImageGenResult) => void;
  const configs: ImageGenConfig[] = [];
  const f = fixture(async (_prompt, config) => {
    configs.push(config);
    if (configs.length === 1) return new Promise(resolve => { release = resolve; });
    return result;
  });
  const active = f.queue.generate('first', DEFAULT_IMAGE_CONFIG);
  const cfg = { ...DEFAULT_IMAGE_CONFIG, model: 'selected-at-enqueue' };
  const queued = f.queue.generate('second', cfg);
  cfg.model = 'changed-later';
  release(result); await active; await queued;
  expect(configs[1]!.model).toBe('selected-at-enqueue');

  const controller = new AbortController();
  let finish!: (value: ImageGenResult) => void;
  const late = fixture(() => new Promise(resolve => { finish = resolve; }));
  const promise = late.queue.generate('paid', cfg, { signal: controller.signal, storageKey: 'delivery' });
  controller.abort(); finish(result);
  await expect(promise).rejects.toThrow('已生成');
  expect(late.records.size).toBe(1);
  expect(late.records.has('delivery')).toBe(false);
});
