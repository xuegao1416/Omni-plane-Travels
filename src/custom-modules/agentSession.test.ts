import { describe, expect, test } from 'bun:test';
import {
  applyCustomModuleAgentTurn,
  createCustomModuleAgentSession,
  createEmptyCustomModuleDesignBrief,
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
});
