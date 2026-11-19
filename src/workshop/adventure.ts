/**
 * adventure.ts — 冒险包 → 事件卡包。
 *
 * 冒险包是一串场景（scenes / chapters / steps）。安装时把每个场景编译成一张事件卡：
 * 第一个场景带开场触发器（默认：启用后的第一个回合结束时出现一次），其余场景通过选项的 next 接续，
 * 不会进随机牌堆。没有写选项的场景自动生成“继续”选项接到下一个场景，所以纯线性的 steps 也能直接玩。
 * 场景自己写了 trigger 的（比如“第二章在某个旗标为真时开始”）按自己的触发器出现。
 */
import type { TriggerInput } from '../events/catalog';
import type { Manifest } from '../modules/schema';
import { EVENT_PACK_INDEX_VERSION } from '../modules/eventPackFormat';

export interface AdventureOption {
  label: string;
  next?: string;
  [key: string]: unknown;
}

export interface AdventureScene {
  id: string;
  title?: string;
  text: string;
  options?: AdventureOption[];
  trigger?: TriggerInput;
}

export interface CompiledAdventure {
  packId: string;
  manifest: Manifest;
  files: Record<string, string>;
  sceneCount: number;
  warnings: string[];
}

const OPTION_KEYS = ['label', 'aiNote', 'effects', 'check', 'success', 'failure', 'next', 'requires', 'requiresText'] as const;
const OUTCOME_KEYS = ['effects', 'note', 'aiNote', 'next'] as const;
const DEFAULT_START: TriggerInput = { on: ['turn.ended'], once: true, description: '启用后的第一个回合结束时开始' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function eventId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+/, '').slice(0, 64) || 'scene';
}

/** 冒险包对应的事件包 id（与其他事件包隔开）。 */
export function adventureEventPackId(data: unknown): string {
  const id = isRecord(data) && typeof data.id === 'string' ? data.id : 'adventure';
  return `adventure-${eventId(id)}`.slice(0, 80);
}

export function adventureScenes(data: unknown): AdventureScene[] {
  if (!isRecord(data)) return [];
  const raw = [data.scenes, data.chapters, data.steps].find(Array.isArray) as unknown[] | undefined;
  return (raw ?? []).filter(isRecord).map(scene => scene as unknown as AdventureScene);
}

function pickOutcome(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of OUTCOME_KEYS) if (value[key] !== undefined) out[key] = key === 'next' ? eventId(String(value[key])) : value[key];
  return out;
}

function compileOptions(scene: AdventureScene, following: AdventureScene | undefined): Record<string, unknown>[] {
  const options = Array.isArray(scene.options) && scene.options.length
    ? scene.options
    : [following ? { label: '继续', next: following.id } : { label: '结束这段冒险' }];
  return options.filter(isRecord).map((option) => {
    const out: Record<string, unknown> = {};
    for (const key of OPTION_KEYS) {
      const value = option[key];
      if (value === undefined) continue;
      if (key === 'next') out.next = eventId(String(value));
      else if (key === 'success' || key === 'failure') out[key] = pickOutcome(value);
      else out[key] = value;
    }
    return out;
  });
}

function sceneWorkflow(scene: AdventureScene, id: string, name: string, options: Record<string, unknown>[]) {
  const nodes = [
    { id: 'title', typeId: 'narrative.title', position: { x: 0, y: 0 }, widgetValues: { title: name, style: 'important' } },
    { id: 'text', typeId: 'narrative.text', position: { x: 0, y: 100 }, widgetValues: { text: scene.text } },
    { id: 'choice', typeId: 'choice.static', position: { x: 0, y: 220 }, widgetValues: { options: JSON.stringify(options) } },
  ];
  return {
    version: 1,
    id,
    name,
    nodes,
    connections: [
      { id: 'c1', sourceNodeId: 'title', sourceSocketKey: 'flow_out', targetNodeId: 'text', targetSocketKey: 'flow_in' },
      { id: 'c2', sourceNodeId: 'text', sourceSocketKey: 'flow_out', targetNodeId: 'choice', targetSocketKey: 'flow_in' },
    ],
  };
}

/** 编译冒险包。版本与作者取工坊条目（或本地资产）的元数据。 */
export function compileAdventure(data: unknown, meta: { version: string; author: string; title?: string }): CompiledAdventure {
  const source = isRecord(data) ? data : {};
  const scenes = adventureScenes(source);
  if (scenes.length === 0) throw new Error('冒险包没有任何场景');
  const warnings: string[] = [];
  const ids = scenes.map(scene => eventId(String(scene.id ?? '')));
  const referenced = new Set<string>();
  const compiled = scenes.map((scene, index) => {
    const options = compileOptions(scene, scenes[index + 1]);
    for (const option of options) {
      for (const target of [option.next, (option.success as Record<string, unknown> | undefined)?.next, (option.failure as Record<string, unknown> | undefined)?.next]) {
        if (typeof target !== 'string') continue;
        if (!ids.includes(target)) warnings.push(`场景「${scene.title || scene.id}」的选项指向不存在的场景「${target}」`);
        referenced.add(target);
      }
    }
    return { scene, id: ids[index], name: String(scene.title || `${String(source.name || meta.title || '冒险')} · ${index + 1}`).slice(0, 80), options };
  });

  const packId = adventureEventPackId(source);
  const triggers: Record<string, TriggerInput> = {};
  const kept = compiled.filter((entry, index) => {
    if (index === 0) {
      triggers[entry.id] = isRecord(source.start) ? source.start as TriggerInput : isRecord(entry.scene.trigger) ? entry.scene.trigger : DEFAULT_START;
      return true;
    }
    if (isRecord(entry.scene.trigger)) {
      triggers[entry.id] = entry.scene.trigger;
      return true;
    }
    if (referenced.has(entry.id)) return true;
    warnings.push(`场景「${entry.name}」没有任何选项通向它，也没有自己的触发器，已跳过`);
    return false;
  });

  const manifest: Manifest = {
    id: packId,
    name: String(source.name || meta.title || '冒险').slice(0, 80),
    version: meta.version,
    author: meta.author,
    ...(typeof source.description === 'string' ? { description: source.description.slice(0, 500) } : {}),
    engine: 'opt-event',
    schemaVersion: 1,
    minAppVersion: '3.0.0',
    type: 'card',
    coverColor: '#8f7338',
    icon: 'Map',
    enabledByDefault: false,
    ...(typeof source.worldId === 'string' && source.worldId.trim() ? { worldId: source.worldId.trim() } : {}),
  };
  const files: Record<string, string> = {
    'manifest.json': JSON.stringify(manifest, null, 2),
    'schema/events.json': JSON.stringify({
      version: EVENT_PACK_INDEX_VERSION,
      name: manifest.name,
      events: kept.map(entry => ({ id: entry.id, name: entry.name })),
    }, null, 2),
    'schema/triggers.json': JSON.stringify({ triggers }, null, 2),
  };
  for (const entry of kept) {
    files[`schema/event-${entry.id}.json`] = JSON.stringify(sceneWorkflow(entry.scene, entry.id, entry.name, entry.options), null, 2);
  }
  return { packId, manifest, files, sceneCount: kept.length, warnings };
}
