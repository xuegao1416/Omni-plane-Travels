// ============================================================
//  卡片节点注册表 — 单元测试
// ============================================================
import { test, expect, describe } from 'bun:test';
import {
  registerCardNode,
  getCardNodeDefinition,
  getAllCardNodeDefinitions,
  getCardNodeCategories,
  searchCardNodes,
  areCardSocketTypesCompatible,
  validateCardConnection,
} from './cardNodeRegistry';
import type { CardNodeDefinition, CardNodeType } from './schema';

// ─── 基础注册表测试 ───

describe('cardNodeRegistry', () => {
  test('getAllCardNodeDefinitions 返回 12 种节点', () => {
    const all = getAllCardNodeDefinitions();
    expect(all.length).toBe(12);
  });

  test('getCardNodeDefinition 能找到每种节点类型', () => {
    const types: CardNodeType[] = [
      'narrative.text', 'narrative.title', 'narrative.image', 'narrative.dialog',
      'choice.static', 'choice.dynamic', 'choice.conditional', 'choice.weighted',
      'effect.stat', 'effect.resource', 'effect.flag',
      'flow.branch',
    ];
    for (const t of types) {
      const def = getCardNodeDefinition(t);
      expect(def).toBeDefined();
      expect(def!.typeId).toBe(t);
    }
  });

  test('getCardNodeCategories 返回 4 个分类', () => {
    const cats = getCardNodeCategories();
    expect(cats.has('narrative')).toBe(true);
    expect(cats.has('choice')).toBe(true);
    expect(cats.has('effect')).toBe(true);
    expect(cats.has('flow')).toBe(true);
    expect(cats.get('narrative')!.length).toBe(4);
    expect(cats.get('choice')!.length).toBe(4);
    expect(cats.get('effect')!.length).toBe(3);
    expect(cats.get('flow')!.length).toBe(1);
  });

  test('searchCardNodes 按名称搜索', () => {
    const results = searchCardNodes('标题');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.typeId === 'narrative.title')).toBe(true);
  });

  test('searchCardNodes 按标签搜索', () => {
    const results = searchCardNodes('AI 动态');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.typeId === 'choice.dynamic')).toBe(true);
  });

  test('searchCardNodes 空查询返回全部', () => {
    const results = searchCardNodes('');
    expect(results.length).toBe(12);
  });

  test('searchCardNodes 无匹配返回空', () => {
    const results = searchCardNodes('xyz不存在的关键词');
    expect(results.length).toBe(0);
  });
});

// ─── Socket 类型兼容性测试 ───

describe('areCardSocketTypesCompatible', () => {
  test('相同类型兼容', () => {
    expect(areCardSocketTypesCompatible('flow', 'flow')).toBe(true);
    expect(areCardSocketTypesCompatible('number', 'number')).toBe(true);
    expect(areCardSocketTypesCompatible('string', 'string')).toBe(true);
  });

  test('any 类型与所有类型兼容', () => {
    expect(areCardSocketTypesCompatible('any', 'flow')).toBe(true);
    expect(areCardSocketTypesCompatible('number', 'any')).toBe(true);
    expect(areCardSocketTypesCompatible('any', 'any')).toBe(true);
  });

  test('不同类型不兼容', () => {
    expect(areCardSocketTypesCompatible('flow', 'number')).toBe(false);
    expect(areCardSocketTypesCompatible('string', 'boolean')).toBe(false);
  });
});

// ─── 连接验证测试 ───

describe('validateCardConnection', () => {
  const titleDef = getCardNodeDefinition('narrative.title')!;
  const textDef = getCardNodeDefinition('narrative.text')!;
  const choiceDef = getCardNodeDefinition('choice.static')!;
  const branchDef = getCardNodeDefinition('flow.branch')!;

  test('有效连接返回 null', () => {
    const result = validateCardConnection(
      titleDef, 'flow_out',
      textDef, 'flow_in',
      [], 'node2',
    );
    expect(result).toBeNull();
  });

  test('源节点没有该输出端口时报错', () => {
    const result = validateCardConnection(
      titleDef, 'nonexistent',
      textDef, 'flow_in',
      [], 'node2',
    );
    expect(result).toContain('源节点没有输出端口');
  });

  test('目标节点没有该输入端口时报错', () => {
    const result = validateCardConnection(
      titleDef, 'flow_out',
      textDef, 'nonexistent',
      [], 'node2',
    );
    expect(result).toContain('目标节点没有输入端口');
  });

  test('类型不兼容时报错', () => {
    const result = validateCardConnection(
      branchDef, 'true_out',
      choiceDef, 'flow_in',
      [], 'node2',
    );
    // flow → flow should be compatible
    expect(result).toBeNull();
  });

  test('非 multi 端口重复连接时报错', () => {
    const existing = [{ targetNodeId: 'node2', targetSocketKey: 'flow_in' }];
    const result = validateCardConnection(
      titleDef, 'flow_out',
      textDef, 'flow_in',
      existing, 'node2',
    );
    expect(result).toContain('端口已连接');
  });
});

// ─── 节点定义完整性测试 ───

describe('节点定义完整性', () => {
  test('每个节点都有 name 和 description', () => {
    for (const def of getAllCardNodeDefinitions()) {
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  test('源节点没有 flow 输入', () => {
    for (const def of getAllCardNodeDefinitions()) {
      if (def.source) {
        const flowInputs = def.inputs.filter(s => s.type === 'flow');
        expect(flowInputs.length).toBe(0);
      }
    }
  });

  test('终端节点没有 flow 输出', () => {
    for (const def of getAllCardNodeDefinitions()) {
      if (def.terminal) {
        const flowOutputs = def.outputs.filter(s => s.type === 'flow');
        expect(flowOutputs.length).toBe(0);
      }
    }
  });

  test('非源节点都有 flow 输入', () => {
    for (const def of getAllCardNodeDefinitions()) {
      if (!def.source) {
        const flowInputs = def.inputs.filter(s => s.type === 'flow');
        expect(flowInputs.length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
