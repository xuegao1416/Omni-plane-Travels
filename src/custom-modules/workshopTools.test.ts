import { describe, expect, test } from 'bun:test';
import { commitWorkshopRevision, createWorkshopSession, type WorkshopSession } from './workshopSession';
import { decodeWorkshopToolInput, executeWorkshopTool } from './workshopTools';
import type { CustomGameplayModuleV3 } from './schema';

const world = { id: 'tools-world', name: '工具世界', survivalResourceIds: ['energy'] };

const forgeModule: CustomGameplayModuleV3 = {
  kind: 'custom-gameplay-module', schemaVersion: 3, id: 'tools-forge', name: '锻造台', version: '1.0.0', author: 'test', scope: 'world',
  inputs: {}, capabilities: ['currency', 'inventory', 'survival'],
  items: { ore: { name: '矿石' }, sword: { name: '铁剑', category: '武器' } },
  state: { crafted: { type: 'number', default: 0, min: 0 } },
  permissions: { read: [], write: 'own-state-only' },
  logic: { onGameStart: [], onTurnEnd: [], onTick: [], onChoice: [], onButton: [{ id: 'forge', actions: [
    { type: 'currency.consume', amount: 10 }, { type: 'currency.consume', amount: 15 },
    { type: 'item.consume', itemId: 'ore', amount: 2 }, { type: 'item.grant', itemId: 'sword', amount: 1 },
    { type: 'survival.consume', resourceId: 'energy', amount: 3 }, { type: 'add', path: 'crafted', value: 1 },
  ] }] },
};

/** Mirrors the agent path: wire JSON arguments are decoded before the tool runs. */
const wire = (name: 'createDraft' | 'patchDraft' | 'simulate', raw: unknown) => decodeWorkshopToolInput(name, raw);
const simulateInput = (raw: unknown) => wire('simulate', raw);
const forgeTest = (overrides: Record<string, unknown> = {}) => simulateInput({
  lifecycle: 'onButton', buttonEvent: 'forge', currency: 30,
  itemAmounts: [{ itemId: 'ore', amount: 3 }], survivalAmounts: [{ resourceId: 'energy', amount: 10 }],
  ...overrides,
});
function sessionWithDraft(): WorkshopSession {
  return commitWorkshopRevision(createWorkshopSession(world), forgeModule, 0, '创建锻造台');
}
type SimulateOutput = {
  applied: number; warnings: string[];
  before: { currency: number; items: Record<string, { 数量: number }>; survival: Record<string, { 数量: number }> };
  after: { currency: number; items: Record<string, { 数量: number }>; survival: Record<string, { 数量: number }>; state: Record<string, number> };
};

describe('workshop tools', () => {
  test('simulate settles currency, items, survival and own state on an isolated copy', () => {
    const session = sessionWithDraft();
    const result = executeWorkshopTool(session, 'simulate', forgeTest(), 'run:sim');
    const output = result.output as unknown as SimulateOutput;
    expect(result.session).toBe(session);
    expect(output.applied).toBeGreaterThan(0);
    expect(output.warnings).toEqual([]);
    expect(output.before).toMatchObject({ currency: 30 });
    expect(output.after.currency).toBe(5);
    expect(output.after.items['矿石'].数量).toBe(1);
    expect(output.after.items['铁剑']).toMatchObject({ 数量: 1, 类型: '武器' });
    expect(output.after.survival.energy.数量).toBe(7);
    expect(output.after.state.crafted).toBe(1);
  });

  test('simulate reports an unpayable rule without any partial settlement', () => {
    const output = executeWorkshopTool(sessionWithDraft(), 'simulate', forgeTest({ currency: 20 }), 'run:poor').output as unknown as SimulateOutput;
    expect(output.applied).toBe(0);
    expect(output.after.currency).toBe(20);
    expect(output.after.items['矿石'].数量).toBe(3);
    expect(output.after.items['铁剑'].数量).toBe(0);
    expect(output.after.survival.energy.数量).toBe(10);
    expect(output.after.state.crafted).toBe(0);
  });

  test('simulate needs an existing draft and decodes list arguments into maps', () => {
    expect(() => executeWorkshopTool(createWorkshopSession(world), 'simulate', forgeTest(), 'run:none')).toThrow('草稿');
    expect(simulateInput({ lifecycle: 'onTick' })).toEqual({ lifecycle: 'onTick' });
    expect(simulateInput({ lifecycle: 'onTick', itemAmounts: [{ itemId: 'ore', amount: 2 }] })).toEqual({ lifecycle: 'onTick', items: { ore: 2 } });
  });

  test('readDraft and patchDraft move the revision forward while a stale base is refused', () => {
    const session = sessionWithDraft();
    expect(executeWorkshopTool(session, 'readDraft', {}, 'run:read').output).toEqual({ revision: 1, module: session.revisions[0].module });
    expect(() => executeWorkshopTool(session, 'patchDraft', wire('patchDraft', {
      baseRevision: 0, summary: '改名', operations: [{ op: 'replace', path: '/name', valueJson: '"新名字"' }],
    }), 'run:stale')).toThrow('版本');
    const patched = executeWorkshopTool(session, 'patchDraft', wire('patchDraft', {
      baseRevision: 1, summary: '改名', operations: [{ op: 'replace', path: '/name', valueJson: '"新名字"' }],
    }), 'run:patch');
    expect(patched.output.revision).toBe(2);
    expect(session.currentRevision).toBe(1);
  });

  test('createDraft refuses a second module and an invalid definition keeps revision zero', () => {
    const session = sessionWithDraft();
    expect(() => executeWorkshopTool(session, 'createDraft', { baseRevision: 1, summary: '重复', module: forgeModule }, 'run:dup')).toThrow('已有模块');
    const empty = createWorkshopSession(world);
    const undeclared = { ...forgeModule, items: {} };
    expect(() => executeWorkshopTool(empty, 'createDraft', { baseRevision: 0, summary: '错误', module: undeclared }, 'run:bad')).toThrow();
    expect(empty.revisions).toHaveLength(0);
    expect(executeWorkshopTool(sessionWithDraft(), 'validateDraft', {}, 'run:valid').output).toMatchObject({ valid: true, revision: 1 });
  });

  test('capabilities ships the authoring schema as text so gateways cannot see $ref data', () => {
    const output = executeWorkshopTool(sessionWithDraft(), 'capabilities', {}, 'run:caps').output;
    expect(output.world).toEqual(world);
    expect(typeof output.moduleSchemaJson).toBe('string');
    expect(JSON.parse(output.moduleSchemaJson as string)).toMatchObject({ type: 'object' });
    expect(decodeWorkshopToolInput('capabilities', {})).toEqual({});
  });

  test('decodes the createDraft and patchDraft JSON arguments without losing operation shape', () => {
    expect(wire('createDraft', { baseRevision: 0, summary: '创建', moduleJson: JSON.stringify(forgeModule) })).toEqual({
      baseRevision: 0, summary: '创建', module: forgeModule,
    });
    expect(wire('patchDraft', { baseRevision: 1, summary: '删除', operations: [{ op: 'remove', path: '/description' }] })).toEqual({
      baseRevision: 1, summary: '删除', operations: [{ op: 'remove', path: '/description' }],
    });
    expect(wire('patchDraft', { baseRevision: 1, summary: '追加', operations: [{ op: 'add', path: '/state/crafted/min', valueJson: '0' }] })).toEqual({
      baseRevision: 1, summary: '追加', operations: [{ op: 'add', path: '/state/crafted/min', value: 0 }],
    });
  });
});
