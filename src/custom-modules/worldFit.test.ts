// 自创模块与当前世界的契合检查：按本世界的能力目录，草稿读的输入、用的生存资源都要存在；
// 工坊提交时报错交回 Agent，修正后才能提交。
import { describe, expect, test } from 'bun:test';
import { buildCustomModuleAgentWorldContext } from './capabilities';
import { checkCustomModuleWorldFit } from './worldFit';
import { commitWorkshopRevision, createWorkshopSession } from './workshopSession';
import { executeWorkshopTool } from './workshopTools';
import type { CustomGameplayModuleV3 } from './schema';

const island = buildCustomModuleAgentWorldContext({
  id: 'island', name: '荒岛',
  modules: [{ moduleId: 'survival', enabled: true, moduleConfig: { resources: [{ id: 'water' }, { id: 'wood' }] } }],
});
const town = buildCustomModuleAgentWorldContext({ id: 'town', name: '小镇', modules: [] });

function module(resourceId: string, reads: string[] = []): CustomGameplayModuleV3 {
  return {
    kind: 'custom-gameplay-module', schemaVersion: 3, id: 'well', name: '水井', version: '1.0.0', author: 'test', scope: 'world',
    inputs: Object.fromEntries(reads.map((path, index) => [`in${index}`, path])), capabilities: ['survival'], items: {},
    state: { drawn: { type: 'number', default: 0, min: 0 } },
    permissions: { read: reads, write: 'own-state-only' },
    logic: { onGameStart: [], onTurnEnd: [], onTick: [], onChoice: [], onButton: [{ id: 'draw', actions: [
      { type: 'survival.grant', resourceId, amount: 1 }, { type: 'add', path: 'drawn', value: 1 },
    ] }] },
  };
}

describe('自创模块与世界的契合', () => {
  test('用了本世界没有的资源或输入会报错，并列出可用项', () => {
    const issues = checkCustomModuleWorldFit(module('gold', ['player.stats.dim1']), island);
    const messages = issues.filter(issue => issue.severity === 'error').map(issue => issue.message).join('\n');
    expect(messages).toContain('生存资源「gold」在本世界不存在。可用：water、wood');
    expect(messages).toContain('本世界没有宿主输入「player.stats.dim1」');
    expect(checkCustomModuleWorldFit(module('water', ['player.survival.water.amount']), island)).toEqual([]);
  });

  test('没有生存模块的世界不能声明 survival 能力', () => {
    const codes = checkCustomModuleWorldFit(module('water'), town).map(issue => issue.code);
    expect(codes).toEqual(expect.arrayContaining(['world-capability-unavailable', 'world-resource-unavailable']));
  });

  test('世界上下文没有能力信息时不检查（旧会话）', () => {
    expect(checkCustomModuleWorldFit(module('gold'), { id: 'old', name: '旧会话' })).toEqual([]);
  });

  test('工坊提交草稿时拒绝不契合的版本，原因写在错误里；修正后可以提交，validateDraft 也报告契合问题', () => {
    const session = createWorkshopSession(island);
    expect(() => commitWorkshopRevision(session, module('gold'), 0, '创建')).toThrow('生存资源「gold」在本世界不存在');
    const committed = commitWorkshopRevision(session, module('water'), 0, '创建');
    expect(committed.currentRevision).toBe(1);
    const stale = { ...committed, world: town };
    const { output } = executeWorkshopTool(stale, 'validateDraft', {}, 'v');
    expect((output as { valid: boolean }).valid).toBe(false);
  });
});
