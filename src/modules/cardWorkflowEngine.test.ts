// ============================================================
//  卡片工作流引擎 — 单元测试
// ============================================================
import { test, expect, describe } from 'bun:test';
import { executeCardWorkflow } from './cardWorkflowEngine';
import { migrateLegacyCardFile, type LegacyCardFile as CardFile } from './eventPackFormat';
import type { CardWorkflowDefinition, CardExecutionContext } from './schema';

// ─── 测试用数据 ───

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

// ─── PH12A: 线性流程测试 ───

describe('线性流程', () => {
  test('title → narrative → choice.static → effect.stat', () => {
    const workflow: CardWorkflowDefinition = {
      version: 1,
      id: 'test-linear',
      name: '线性测试',
      nodes: [
        { id: 'n1', typeId: 'narrative.title', position: { x: 0, y: 0 }, widgetValues: { title: '神秘森林' } },
        { id: 'n2', typeId: 'narrative.text', position: { x: 0, y: 100 }, widgetValues: { text: '你来到了一片黑暗的森林。' } },
        { id: 'n3', typeId: 'choice.static', position: { x: 0, y: 200 }, widgetValues: { options: '[{"label":"前进","aiNote":"深入森林"},{"label":"返回","aiNote":"放弃探索"}]' } },
        { id: 'n4', typeId: 'effect.stat', position: { x: 0, y: 300 }, widgetValues: { statKey: '能量', delta: -10 } },
      ],
      connections: [
        { id: 'c1', sourceNodeId: 'n1', sourceSocketKey: 'flow_out', targetNodeId: 'n2', targetSocketKey: 'flow_in' },
        { id: 'c2', sourceNodeId: 'n2', sourceSocketKey: 'flow_out', targetNodeId: 'n3', targetSocketKey: 'flow_in' },
        { id: 'c3', sourceNodeId: 'n3', sourceSocketKey: 'flow_out', targetNodeId: 'n4', targetSocketKey: 'flow_in' },
      ],
    };

    const result = executeCardWorkflow(workflow, baseCtx);

    expect(result.aborted).toBe(false);
    expect(result.warnings.length).toBe(0);
    expect(result.executedNodeIds).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect(result.renderData.length).toBe(2); // title + text
    expect(result.renderData[0]?.type).toBe('title');
    expect(result.renderData[0]?.title).toBe('神秘森林');
    expect(result.renderData[1]?.type).toBe('text');
    expect(result.choices?.length).toBe(2);
    expect(result.pendingEffects!.length).toBe(1);
    expect(result.pendingEffects![0]?.statId).toBe('能量');
    expect(result.pendingEffects![0]?.delta).toBe(-10);
  });

  test('multiple titles execute in connection order instead of all entering at once', () => {
    const workflow: CardWorkflowDefinition = {
      version: 1,
      id: 'test-multiple-titles',
      name: 'Multiple titles',
      nodes: [
        {
          id: 'title-one',
          typeId: 'narrative.title',
          position: { x: 0, y: 0 },
          widgetValues: { title: 'Chapter one' },
        },
        {
          id: 'narrative',
          typeId: 'narrative.text',
          position: { x: 0, y: 120 },
          widgetValues: { text: 'Between titles' },
        },
        {
          id: 'title-two',
          typeId: 'narrative.title',
          position: { x: 0, y: 240 },
          widgetValues: { title: 'Chapter two' },
        },
      ],
      connections: [
        {
          id: 'flow-one',
          sourceNodeId: 'title-one',
          sourceSocketKey: 'flow_out',
          targetNodeId: 'narrative',
          targetSocketKey: 'flow_in',
        },
        {
          id: 'flow-two',
          sourceNodeId: 'narrative',
          sourceSocketKey: 'flow_out',
          targetNodeId: 'title-two',
          targetSocketKey: 'flow_in',
        },
      ],
    };

    const result = executeCardWorkflow(workflow, baseCtx);

    expect(result.executedNodeIds).toEqual([
      'title-one',
      'narrative',
      'title-two',
    ]);
    expect(result.renderData.map((rendered) => rendered?.type)).toEqual([
      'title',
      'text',
      'title',
    ]);
    expect(result.renderData.map((rendered) => rendered?.title ?? rendered?.text)).toEqual([
      'Chapter one',
      'Between titles',
      'Chapter two',
    ]);
  });

  test('migrated multiple titles execute in legacy connection order', () => {
    const legacy: CardFile = {
      version: 1,
      puck: {
        root: { props: {} },
        components: {
          title: [
            { id: 'legacy-title-one', props: { title: 'Legacy chapter one' } },
            { id: 'legacy-title-two', props: { title: 'Legacy chapter two' } },
          ],
        },
      },
      cards: [
        { id: 'legacy-title-one', componentId: 'title', title: 'Legacy chapter one' },
        { id: 'legacy-title-two', componentId: 'title', title: 'Legacy chapter two' },
      ],
    };

    const workflow = migrateLegacyCardFile(legacy, 'test-migrated-titles', 'Migrated titles');
    const result = executeCardWorkflow(workflow, baseCtx);

    expect(result.aborted).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.executedNodeIds).toEqual([
      'legacy-title-one',
      'legacy-title-two',
    ]);
    expect(result.renderData.map((rendered) => rendered?.title)).toEqual([
      'Legacy chapter one',
      'Legacy chapter two',
    ]);
  });
});

// ─── PH12B: 条件分支测试 ───

describe('条件分支', () => {
  test('branch 根据 stat 走不同路径', () => {
    const workflow: CardWorkflowDefinition = {
      version: 1,
      id: 'test-branch',
      name: '分支测试',
      nodes: [
        { id: 'n1', typeId: 'flow.branch', position: { x: 0, y: 0 }, widgetValues: { checkPath: '玩家.生存状态.生命', op: '>=', compareValue: '50' } },
        { id: 'n2', typeId: 'narrative.text', position: { x: -100, y: 100 }, widgetValues: { text: '你状态良好。' } },
        { id: 'n3', typeId: 'narrative.text', position: { x: 100, y: 100 }, widgetValues: { text: '你状态不佳。' } },
      ],
      connections: [
        { id: 'c1', sourceNodeId: 'n1', sourceSocketKey: 'true_out', targetNodeId: 'n2', targetSocketKey: 'flow_in' },
        { id: 'c2', sourceNodeId: 'n1', sourceSocketKey: 'false_out', targetNodeId: 'n3', targetSocketKey: 'flow_in' },
      ],
    };

    const result = executeCardWorkflow(workflow, baseCtx);

    expect(result.aborted).toBe(false);
    // 生命 80 >= 50 → 走 true 路径
    expect(result.executedNodeIds).toContain('n1');
    expect(result.executedNodeIds).toContain('n2');
    expect(result.executedNodeIds).not.toContain('n3');
    expect(result.renderData[0]?.text).toBe('你状态良好。');
  });

  test('branch 走 false 路径', () => {
    const workflow: CardWorkflowDefinition = {
      version: 1,
      id: 'test-branch-false',
      name: '分支测试-false',
      nodes: [
        { id: 'n1', typeId: 'flow.branch', position: { x: 0, y: 0 }, widgetValues: { checkPath: '玩家.生存状态.生命', op: '<', compareValue: '50' } },
        { id: 'n2', typeId: 'narrative.text', position: { x: -100, y: 100 }, widgetValues: { text: '你很虚弱。' } },
        { id: 'n3', typeId: 'narrative.text', position: { x: 100, y: 100 }, widgetValues: { text: '你很健康。' } },
      ],
      connections: [
        { id: 'c1', sourceNodeId: 'n1', sourceSocketKey: 'true_out', targetNodeId: 'n2', targetSocketKey: 'flow_in' },
        { id: 'c2', sourceNodeId: 'n1', sourceSocketKey: 'false_out', targetNodeId: 'n3', targetSocketKey: 'flow_in' },
      ],
    };

    const result = executeCardWorkflow(workflow, baseCtx);

    // 生命 80 < 50 → false → 走 n3
    expect(result.executedNodeIds).toContain('n3');
    expect(result.executedNodeIds).not.toContain('n2');
    expect(result.renderData[0]?.text).toBe('你很健康。');
  });
});

// ─── PH12C: 条件选项测试 ───

describe('条件选项', () => {
  test('根据资源过滤选项', () => {
    const workflow: CardWorkflowDefinition = {
      version: 1,
      id: 'test-conditional',
      name: '条件选项测试',
      nodes: [
        { id: 'n1', typeId: 'choice.conditional', position: { x: 0, y: 0 }, widgetValues: {
          options: JSON.stringify([
            { label: '吃食物', conditionPath: '玩家.生存资源.食物.数量', conditionOp: '>', conditionValue: 0 },
            { label: '喝水', conditionPath: '玩家.生存资源.水.数量', conditionOp: '>', conditionValue: 0 },
            { label: '使用金币', conditionPath: '玩家.经营资产.资金', conditionOp: '>=', conditionValue: 5000 },
          ]),
        }},
      ],
      connections: [],
    };

    const result = executeCardWorkflow(workflow, baseCtx);

    expect(result.choices?.length).toBe(2); // 食物10>0 ✓, 水5>0 ✓, 资金1000<5000 ✗
    expect(result.choices?.[0]?.label).toBe('吃食物');
    expect(result.choices?.[1]?.label).toBe('喝水');
  });
});

// ─── PH12D: 权重选项测试 ───

describe('权重选项', () => {
  test('权重选项返回指定数量', () => {
    const workflow: CardWorkflowDefinition = {
      version: 1,
      id: 'test-weighted',
      name: '权重选项测试',
      nodes: [
        { id: 'n1', typeId: 'choice.weighted', position: { x: 0, y: 0 }, widgetValues: {
          showCount: 2,
          options: JSON.stringify([
            { label: '常见事件', weight: 80 },
            { label: '稀有事件', weight: 15 },
            { label: '传说事件', weight: 5 },
          ]),
        }},
      ],
      connections: [],
    };

    const result = executeCardWorkflow(workflow, baseCtx);

    expect(result.choices?.length).toBe(2);
    expect(result.choices?.every(c => c.label)).toBe(true);
  });
});

// ─── PH12E: 效果应用测试 ───

describe('效果节点', () => {
  test('属性效果', () => {
    const workflow: CardWorkflowDefinition = {
      version: 1,
      id: 'test-effect-stat',
      name: '属性效果测试',
      nodes: [
        { id: 'n1', typeId: 'effect.stat', position: { x: 0, y: 0 }, widgetValues: { statKey: '生命', delta: -20 } },
      ],
      connections: [],
    };

    const result = executeCardWorkflow(workflow, baseCtx);

    expect(result.pendingEffects!.length).toBe(1);
    expect(result.pendingEffects![0]?.statId).toBe('生命');
    expect(result.pendingEffects![0]?.delta).toBe(-20);
  });

  test('资源效果', () => {
    const workflow: CardWorkflowDefinition = {
      version: 1,
      id: 'test-effect-resource',
      name: '资源效果测试',
      nodes: [
        { id: 'n1', typeId: 'effect.resource', position: { x: 0, y: 0 }, widgetValues: { resourceKey: '生存资源.食物', delta: -3 } },
      ],
      connections: [],
    };

    const result = executeCardWorkflow(workflow, baseCtx);

    expect(result.pendingEffects!.length).toBe(1);
    expect(result.pendingEffects![0]?.resourcePath).toBe('生存资源.食物');
    expect(result.pendingEffects![0]?.delta).toBe(-3);
  });

  test('标记效果', () => {
    const workflow: CardWorkflowDefinition = {
      version: 1,
      id: 'test-effect-flag',
      name: '标记效果测试',
      nodes: [
        { id: 'n1', typeId: 'effect.flag', position: { x: 0, y: 0 }, widgetValues: { flagPath: 'flags.已完成任务', value: true } },
      ],
      connections: [],
    };

    const result = executeCardWorkflow(workflow, baseCtx);

    expect(result.pendingEffects!.length).toBe(1);
    expect(result.pendingEffects![0]?.flagPath).toBe('flags.已完成任务');
    expect(result.pendingEffects![0]?.value).toBe(true);
  });
});

// ─── PH12F: 循环防护测试 ───

describe('循环防护', () => {
  test('死循环检测', () => {
    const workflow: CardWorkflowDefinition = {
      version: 1,
      id: 'test-loop',
      name: '循环测试',
      nodes: [
        { id: 'n1', typeId: 'narrative.text', position: { x: 0, y: 0 }, widgetValues: { text: '循环' } },
        { id: 'n2', typeId: 'narrative.text', position: { x: 0, y: 100 }, widgetValues: { text: '循环' } },
      ],
      connections: [
        { id: 'c1', sourceNodeId: 'n1', sourceSocketKey: 'flow_out', targetNodeId: 'n2', targetSocketKey: 'flow_in' },
        { id: 'c2', sourceNodeId: 'n2', sourceSocketKey: 'flow_out', targetNodeId: 'n1', targetSocketKey: 'flow_in' },
      ],
    };

    const result = executeCardWorkflow(workflow, { ...baseCtx, limits: { maxNodes: 10 } });

    // 应该执行 n1 和 n2 各一次，然后因为已执行而跳过
    expect(result.executedNodeIds.length).toBe(2);
    expect(result.aborted).toBe(false);
  });

  test('超过节点上限时中止', () => {
    // 创建一个长链
    const nodes = Array.from({ length: 20 }, (_, i) => ({
      id: `n${i}`,
      typeId: 'narrative.text' as const,
      position: { x: 0, y: i * 100 },
      widgetValues: { text: `节点 ${i}` },
    }));
    const connections = Array.from({ length: 19 }, (_, i) => ({
      id: `c${i}`,
      sourceNodeId: `n${i}`,
      sourceSocketKey: 'flow_out',
      targetNodeId: `n${i + 1}`,
      targetSocketKey: 'flow_in',
    }));

    const workflow: CardWorkflowDefinition = {
      version: 1,
      id: 'test-limit',
      name: '限制测试',
      nodes,
      connections,
    };

    const result = executeCardWorkflow(workflow, { ...baseCtx, limits: { maxNodes: 5 } });

    expect(result.aborted).toBe(true);
    expect(result.executedNodeIds.length).toBeLessThanOrEqual(5);
    expect(result.warnings.some(w => w.includes('上限'))).toBe(true);
  });
});
