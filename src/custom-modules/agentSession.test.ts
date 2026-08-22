import { describe, expect, test } from 'bun:test';
import {
  applyCustomModuleAgentTurn,
  createCustomModuleAgentSession,
  createEmptyCustomModuleDesignBrief,
  restoreCustomModuleAgentSessionForWorld,
} from './agentSession';
import type { CustomGameplayModule } from './schema';

const world = { id: 'world-a', name: 'World A' };
const moduleDefinition = {
  kind: 'custom-gameplay-module', schemaVersion: 1, id: 'session-draft', name: 'Session Draft',
  version: '1.0.0', author: 'test', scope: 'world', state: { count: { type: 'number', default: 0 } },
  logic: { onGameStart: [], onTurnEnd: [], onTick: [], onChoice: [] },
  permissions: { read: [], write: 'own-state-only' },
} satisfies CustomGameplayModule;

describe('custom module agent session', () => {
  test('starts in discovery with a structured brief', () => {
    const session = createCustomModuleAgentSession(world);
    expect(session.phase).toBe('discovery');
    expect(session.brief).toEqual(createEmptyCustomModuleDesignBrief());
    expect(session.revision).toBe(0);
    expect(session.conversation).toEqual([]);
  });

  test('keeps scalar context while treating each envelope list as the complete current brief', () => {
    const session = createCustomModuleAgentSession(world);
    const first = applyCustomModuleAgentTurn(session, {
      message: '了解目标', phase: 'designing',
      brief: { ...createEmptyCustomModuleDesignBrief(), goal: '记录声望', triggers: ['onTurnEnd'] },
      module: null,
    }).session;
    const second = applyCustomModuleAgentTurn(first, {
      message: '还需要一个面板', phase: 'designing',
      brief: {
        ...createEmptyCustomModuleDesignBrief(), presentation: 'visible',
        triggers: ['onTurnEnd'], outputs: ['right-panel'],
      },
      module: null,
    }).session;
    expect(second.brief.goal).toBe('记录声望');
    expect(second.brief.triggers).toEqual(['onTurnEnd']);
    expect(second.brief.presentation).toBe('visible');
  });

  test('replaces an obsolete trigger with the next complete brief', () => {
    const session = createCustomModuleAgentSession(world);
    const first = applyCustomModuleAgentTurn(session, {
      message: 'use ticks', phase: 'designing',
      brief: { ...createEmptyCustomModuleDesignBrief(), goal: 'track progress', triggers: ['onTick'] },
      module: null,
    }).session;
    const second = applyCustomModuleAgentTurn(first, {
      message: 'use turns instead', phase: 'designing',
      brief: { ...createEmptyCustomModuleDesignBrief(), goal: 'track progress', triggers: ['onTurnEnd'] },
      module: null,
    }).session;

    expect(second.brief.triggers).toEqual(['onTurnEnd']);
  });

  test('increments revisions only for valid drafts and preserves the last valid draft on failure', () => {
    const initial = createCustomModuleAgentSession(world);
    const ready = applyCustomModuleAgentTurn(initial, {
      message: '草案', phase: 'draft_ready', brief: createEmptyCustomModuleDesignBrief(), module: moduleDefinition,
    });
    expect(ready.accepted).toBe(true);
    expect(ready.session.revision).toBe(1);
    const failed = applyCustomModuleAgentTurn(ready.session, {
      message: '坏草案', phase: 'draft_ready', brief: createEmptyCustomModuleDesignBrief(),
      module: { ...moduleDefinition, logic: { ...moduleDefinition.logic, onTick: [{ actions: [{ type: 'set', path: 'missing', value: 1 }] }] } } as never,
    });
    expect(failed.accepted).toBe(false);
    expect(failed.session.revision).toBe(1);
    expect(failed.session.lastValidDraft?.id).toBe('session-draft');
  });

  test('restores the full structured session for the same world and refreshes its capabilities', () => {
    const saved = applyCustomModuleAgentTurn(createCustomModuleAgentSession(world), {
      message: '草案', phase: 'draft_ready', brief: { ...createEmptyCustomModuleDesignBrief(), goal: '记录声望' }, module: moduleDefinition,
    }).session;
    saved.conversation = [{ role: 'user', content: '记录声望' }, { role: 'assistant', content: '草案完成' }];
    const restored = restoreCustomModuleAgentSessionForWorld(saved, {
      ...world,
      description: '更新后的世界说明',
      availability: { stat: true, survival: false, business: false, currency: true },
    });
    expect(restored.brief.goal).toBe('记录声望');
    expect(restored.lastValidDraft?.id).toBe('session-draft');
    expect(restored.conversation).toHaveLength(2);
    expect(restored.world.description).toBe('更新后的世界说明');
  });

  test('does not leak a persisted session into a different world', () => {
    const saved = createCustomModuleAgentSession(world);
    saved.brief.goal = '旧世界目标';
    saved.conversation = [{ role: 'user', content: '旧世界对话' }];
    const restored = restoreCustomModuleAgentSessionForWorld(saved, { id: 'world-b', name: 'World B' });
    expect(restored.world.id).toBe('world-b');
    expect(restored.brief.goal).toBe('');
    expect(restored.conversation).toEqual([]);
  });
});
