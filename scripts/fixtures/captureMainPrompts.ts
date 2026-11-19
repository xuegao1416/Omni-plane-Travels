/**
 * 用假模型在指定代码树上跑一回合，记录发给正文模型的完整请求（system + 历史 + 本轮输入），
 * 生成 src/engine/__fixtures__/mainPrompt.baseline.json，供 mainPrompt.baseline.test.ts 做新旧逐段比对。
 *
 * 基线取自重构起点 10b4eec：
 *   git worktree add /tmp/base 10b4eec && ln -s "$PWD/node_modules" /tmp/base/node_modules
 *   bun scripts/fixtures/captureMainPrompts.ts /tmp/base src/engine/__fixtures__/mainPrompt.baseline.json
 */
import 'fake-indexeddb/auto';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const CAPTURE_INPUT = '我先四处看看周围的情况。';
export const FAKE_NARRATIVE = '<contenttext>你四处看了看。</contenttext><TimeAdvance>{"minutes":10,"reason":"观察","evidence":"十分钟"}</TimeAdvance>';
const FIREWALL_TITLE = '角色认知防火墙（最高优先级）';

type Messages = Array<{ role: string; content: string }>;

export async function captureMainPrompts(tree: string, fixturesDir: string): Promise<Record<string, Messages>> {
  const { STORAGE_KEYS } = await import(join(tree, 'src/config/storageKeys'));
  const values = new Map<string, string>([[STORAGE_KEYS.PIPELINE_VARIABLE_ENABLED, 'false']]);
  const previousStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  globalThis.localStorage = {
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }, clear: () => values.clear(), key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } as Storage;
  const { useMemoryStore } = await import(join(tree, 'src/memory/memoryStore'));
  const memoryEnabled = useMemoryStore.getState().config.enabled;
  useMemoryStore.getState().setConfig({ enabled: false });
  const { useGameEngine } = await import(join(tree, 'src/engine/useGameEngine'));
  const { decodeSaveFile } = await import(join(tree, 'src/storage/saveFileCodec'));
  const { eventBus, EVENTS } = await import(join(tree, 'src/engine/eventBus'));
  const out: Record<string, Messages> = {};
  try {
    for (const name of readdirSync(fixturesDir).filter(file => file.endsWith('.save.zip')).sort()) {
      const raw = await decodeSaveFile(new Blob([await Bun.file(join(fixturesDir, name)).arrayBuffer()])) as { save: Record<string, any> };
      const requests: Messages[] = [];
      globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
        try { requests.push(JSON.parse(String(init?.body ?? '{}')).messages ?? []); } catch { /* 非 JSON 请求忽略 */ }
        return new Response(JSON.stringify({ choices: [{ message: { content: FAKE_NARRATIVE } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as unknown as typeof fetch;
      let engine: any;
      renderToString(createElement(() => {
        engine = useGameEngine({ apiKey: 'test', baseUrl: 'https://example.test', model: 'test', provider: 'custom', stream: false } as never,
          undefined, raw.save.worldId, raw.save.personalInfo ?? null, raw.save.characterHistory ?? '');
        return null;
      }));
      engine.reset();
      engine.loadSave({ ...raw.save, messages: raw.save.messages ?? [] });
      const stop = eventBus.on(EVENTS.MESSAGE_RECEIVED, () => engine.cancel());
      try { await engine.sendMessage(CAPTURE_INPUT); } finally { stop(); }
      const main = requests.find(messages => messages[0]?.role === 'system' && messages[0].content.includes(FIREWALL_TITLE));
      if (!main) throw new Error(`${name}：没有捕获到正文请求`);
      out[name] = main;
    }
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.localStorage = previousStorage;
    useMemoryStore.getState().setConfig({ enabled: memoryEnabled });
  }
  return out;
}

if (import.meta.main) {
  const [tree, output] = process.argv.slice(2);
  if (!tree || !output) throw new Error('用法：bun scripts/fixtures/captureMainPrompts.ts <代码树> <输出 JSON>');
  const root = resolve(import.meta.dir, '../..');
  const result = await captureMainPrompts(resolve(tree), join(root, 'src/__tests__/fixtures/saves/handoff'));
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`已写入 ${output}（${Object.keys(result).length} 个存档）`);
}
