// ============================================================
//  卡片工作流 — 端到端集成测试
// ============================================================
import { test, expect, describe } from 'bun:test';
import { executeCardWorkflow } from './cardWorkflowEngine';
import { getAllCardWorkflowTemplates } from './cardWorkflowTemplates';
import { getAllCardNodeDefinitions, getCardNodeDefinition, searchCardNodes } from './cardNodeRegistry';
import type { CardWorkflowDefinition, CardExecutionContext } from './schema';

const baseCtx: CardExecutionContext = {
  tick: 1,
  events: [],
  permissions: ['modify_world_state', 'add_card'],
  gameState: {
    玩家: {
      生存状态: { 生命: 80, 能量: 60 },
      生存资源: { 食物: { 数量: 10 }, 水: { 数量: 5 } },
      经营资产: { 资金: 1000 },
    },
    flags: { 已遇到村长: true },
  },
};

// ─── 模板测试 ───

describe('模板系统', () => {
  test('有 8 种预设模板', () => {
    const templates = getAllCardWorkflowTemplates();
    expect(templates.length).toBe(8);
  });

  test('每个模板都能创建有效工作流', () => {
    const templates = getAllCardWorkflowTemplates();
    for (const t of templates) {
      const wf = t.create();
      expect(wf.version).toBe(1);
      expect(wf.nodes.length).toBeGreaterThan(0);
      expect(wf.connections.length).toBeGreaterThan(0);
    }
  });

  test('每个模板都能执行', () => {
    const templates = getAllCardWorkflowTemplates();
    for (const t of templates) {
      const wf = t.create();
      const result = executeCardWorkflow(wf, baseCtx);
      expect(result.executedNodeIds.length).toBeGreaterThan(0);
      expect(result.aborted).toBe(false);
    }
  });
});

// ─── 注册表完整性测试 ───

describe('注册表完整性', () => {
  test('12 种节点全部注册', () => {
    const all = getAllCardNodeDefinitions();
    expect(all.length).toBe(12);
  });

  test('每种节点都有执行器', () => {
    const { getCardNodeExecutor } = require('./cardNodeExecutors');
    for (const def of getAllCardNodeDefinitions()) {
      const executor = getCardNodeExecutor(def.typeId);
      expect(executor).toBeDefined();
    }
  });

  test('搜索功能正常', () => {
    expect(searchCardNodes('AI').length).toBeGreaterThanOrEqual(1);
    expect(searchCardNodes('属性').length).toBeGreaterThanOrEqual(1);
    expect(searchCardNodes('分支').length).toBeGreaterThanOrEqual(1);
  });
});

// ─── 完整流程测试 ───

describe('完整流程', () => {
  test('探索 → 选择 → 效果 → 结算', () => {
    const templates = getAllCardWorkflowTemplates();
    const explore = templates.find(t => t.id === 'explore')!;
    const wf = explore.create();

    const result = executeCardWorkflow(wf, baseCtx);

    // 验证渲染数据
    expect(result.renderData.length).toBeGreaterThanOrEqual(2); // title + text
    expect(result.renderData[0]?.type).toBe('title');
    expect(result.renderData[1]?.type).toBe('text');

    // 验证选项
    expect(result.choices?.length).toBe(3);

    // 验证效果
    expect(result.pendingEffects?.length).toBeGreaterThanOrEqual(1);
  });

  test('条件选项根据资金过滤', () => {
    const templates = getAllCardWorkflowTemplates();
    const shop = templates.find(t => t.id === 'shop')!;
    const wf = shop.create();

    const result = executeCardWorkflow(wf, baseCtx);

    // 资金 1000 >= 10 和 >= 5，所以前两个选项应该显示
    expect(result.choices?.length).toBe(3); // 买食物 + 买水 + 离开
  });

  test('条件分支根据标记走不同路径', () => {
    const templates = getAllCardWorkflowTemplates();
    const branch = templates.find(t => t.id === 'story_branch')!;
    const wf = branch.create();

    const result = executeCardWorkflow(wf, baseCtx);

    // flags.已遇到村长 = true → 走 true 路径
    expect(result.renderData.some(r => r?.text?.includes('熟悉的路'))).toBe(true);
    expect(result.renderData.some(r => r?.text?.includes('陌生的路'))).toBe(false);
  });

  test('资源检查根据食物走不同路径', () => {
    const templates = getAllCardWorkflowTemplates();
    const resCheck = templates.find(t => t.id === 'resource_check')!;
    const wf = resCheck.create();

    const result = executeCardWorkflow(wf, baseCtx);

    // 食物 10 > 0 → 走 true 路径
    expect(result.renderData.some(r => r?.text?.includes('有食物'))).toBe(true);
    expect(result.pendingEffects?.some(e => e?.statId === '能量' && e?.delta === 10)).toBe(true);
  });

  test('工作流无节点时返回错误', () => {
    const wf: CardWorkflowDefinition = {
      version: 1,
      id: 'empty',
      name: '空工作流',
      nodes: [],
      connections: [],
    };

    const result = executeCardWorkflow(wf, baseCtx);
    expect(result.aborted).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
