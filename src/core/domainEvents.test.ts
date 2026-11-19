// 领域事件目录：模块声明自己会发出的事件，玩法宿主只列出已启用模块的；
// 源码里发出的每个事件类型都必须有声明（目录与实现不能脱节）。
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createDefaultGameState } from '../schema/variables';
import { WORLDS } from '../data/worldLoader';
import { BUILTIN_GAMEPLAY_MODULES, createGameplayHost } from './registry';
import { generatorReference } from '../events/generatedBundle';

/** 只在内部流转、不给作者监听的事件。 */
const INTERNAL = new Set(['card.requested']);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function emittedTypes(): Set<string> {
  const root = join(import.meta.dir, '..');
  const files = [...sources(join(root, 'core')), ...sources(join(root, 'domains')), ...sources(join(root, 'events')), join(root, 'gameplay/combatV2.ts')];
  const types = new Set<string>();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/emit\('([a-z]+\.[a-zA-Z.]+)'/g)) types.add(match[1]);
    // 能力模块与战斗结算把事件写成 { type: 'x.y', payload }。
    if (/domains[\\/]abilities[\\/]module\.ts$|combatV2\.ts$/.test(file)) {
      for (const match of text.matchAll(/type: '([a-z]+\.[a-zA-Z.]+)', payload/g)) types.add(match[1]);
    }
  }
  for (const period of ['hour', 'day', 'week', 'month']) types.add(`time.${period}`);
  return types;
}

function declaredTypes(): Set<string> {
  const everything = {
    world: { id: 'all', name: '', description: '', modules: [{ moduleId: 'combat', enabled: true }] },
    talent: { categories: [] }, profession: { professions: [], innateTalents: [] },
  };
  return new Set(BUILTIN_GAMEPLAY_MODULES.flatMap(module => (module.domainEvents?.(everything as never) ?? []).map(spec => spec.type)));
}

describe('领域事件目录', () => {
  test('源码里发出的每个事件类型都有声明', () => {
    const declared = declaredTypes();
    const missing = [...emittedTypes()].filter(type => !INTERNAL.has(type) && !declared.has(type));
    expect(missing).toEqual([]);
  });

  test('宿主只列出已启用模块的事件', () => {
    const trade = WORLDS.find(world => world.id === 'border_trade')!;
    const island = WORLDS.find(world => world.id === 'stranded_island')!;
    const tradeEvents = createGameplayHost(trade, createDefaultGameState()).domainEvents().map(spec => spec.type);
    const islandEvents = createGameplayHost(island, createDefaultGameState()).domainEvents().map(spec => spec.type);
    expect(tradeEvents).toContain('economy.traded');
    expect(tradeEvents).not.toContain('resources.low');
    expect(islandEvents).toContain('resources.low');
    expect(islandEvents).not.toContain('economy.traded');
    for (const events of [tradeEvents, islandEvents]) expect(events).toEqual(expect.arrayContaining(['turn.ended', 'time.day', 'quest.completed', 'events.resolved']));
    expect(new Set(tradeEvents).size).toBe(tradeEvents.length);
  });

  test('事件生成器的参考表用这份目录', () => {
    const reference = generatorReference(WORLDS.find(world => world.id === 'stranded_island')!);
    expect(reference.domainEvents.some(item => item.startsWith('resources.low（物资告急；'))).toBe(true);
    expect(reference.domainEvents.some(item => item.startsWith('economy.'))).toBe(false);
  });
});
