// AI 生成的事件合集：整理成事件包/规则包、写入触发器、校验引用，供「校验 → 修复」。
import 'fake-indexeddb/auto';
import { describe, expect, test } from 'bun:test';
import { WORLDS } from '../data/worldLoader';
import { buildGeneratedBundle, buildRepairMessage, errorCount, generatorReference, validateGeneratedBundle } from './generatedBundle';
import { compileEventDefinitions } from './catalog';
import { readCanonicalEventPack } from '../modules/eventPackFormat';
import { buildEventGeneratorPrompt } from '../utils/prompts/event-generator';

const island = WORLDS.find(world => world.id === 'stranded_island')!;

function output(stat: string) {
  return {
    bundleName: '潮汐',
    events: [{
      id: 'tide_cave', name: '潮洞', trigger: { on: ['resources.low'], when: { event: { type: 'resources.low', where: { id: 'food' } } }, cooldownTurns: 4 },
      workflow: {
        nodes: [
          { id: 'n1', typeId: 'narrative.text', position: { x: 0, y: 0 }, widgetValues: { text: '退潮后露出一个洞口。' } },
          { id: 'n2', typeId: 'choice.static', position: { x: 0, y: 100 }, widgetValues: { options: JSON.stringify([
            { label: '摸进去', check: { stat, dc: 12 }, success: { effects: [{ resource: 'food', delta: 3 }] }, failure: { effects: [{ stat: 'attrA', delta: -8 }] } },
            { label: '算了', effects: [] },
          ]) } },
        ],
        connections: [{ id: 'c1', sourceNodeId: 'n1', sourceSocketKey: 'flow_out', targetNodeId: 'n2', targetSocketKey: 'flow_in' }],
      },
    }],
    rules: [{ id: 'r', name: '涨潮', workflow: { nodes: [
      { id: 'r1', typeId: 'triggers.periodic', position: { x: 0, y: 0 }, widgetValues: { interval: 5 } },
      { id: 'r2', typeId: 'actions.add_event', position: { x: 0, y: 0 }, widgetValues: { event_id: 'tide_cave' } },
    ], connections: [{ id: 'rc', sourceNodeId: 'r1', sourceSocketKey: 'flow_out', targetNodeId: 'r2', targetSocketKey: 'flow_in' }] } }],
  };
}

describe('AI 生成的事件合集', () => {
  test('写入触发器；规则包有弹卡权限；引用不存在的属性会被校验指出', () => {
    const bundle = buildGeneratedBundle(output('力量'), island, { card: 'ai-card-t', rule: 'ai-rule-t' });
    expect(JSON.parse(bundle.card.files['schema/triggers.json']).triggers.tide_cave.on).toEqual(['resources.low']);
    expect(bundle.rule?.manifest.permissions).toContain('add_card');
    const issues = validateGeneratedBundle(bundle, island);
    expect(errorCount(issues)).toBe(1);
    expect(issues[0].message).toContain('力量');
    expect(buildRepairMessage(issues)).toContain('第 1 个选项');
  });

  test('修正后通过校验，卡片按触发器编译', () => {
    const bundle = buildGeneratedBundle(output('player.hp'), island, { card: 'ai-card-t', rule: 'ai-rule-t' });
    expect(errorCount(validateGeneratedBundle(bundle, island))).toBe(0);
    const definitions = compileEventDefinitions(island, [
      { id: bundle.card.id, manifest: { permissions: ['add_card'] }, files: bundle.card.files },
    ], files => [...readCanonicalEventPack(files).workflows]);
    expect(definitions.find(def => def.key === 'ai-card-t/tide_cave')?.trigger.on).toEqual(['resources.low']);
  });

  test('规则节点里的属性、物资、后续卡、节点类型与监听事件也按本世界校验', () => {
    const data = output('player.hp');
    data.rules[0].workflow.nodes.push(
      { id: 'r3', typeId: 'actions.modify_resource', position: { x: 0, y: 0 }, widgetValues: { resource_key: 'gold', delta: 1 } } as never,
      { id: 'r4', typeId: 'conditions.check_stat', position: { x: 0, y: 0 }, widgetValues: { stat_key: '魔力', op: '>=', threshold: 3 } } as never,
      { id: 'r5', typeId: 'actions.add_event', position: { x: 0, y: 0 }, widgetValues: { event_id: 'nowhere' } } as never,
      { id: 'r6', typeId: 'actions.summon_dragon', position: { x: 0, y: 0 }, widgetValues: {} } as never,
      { id: 'r7', typeId: 'triggers.world_event', position: { x: 0, y: 0 }, widgetValues: { match_type: 'economy.traded' } } as never,
    );
    const issues = validateGeneratedBundle(buildGeneratedBundle(data, island, { card: 'ai-card-w', rule: 'ai-rule-w' }), island);
    const errors = issues.filter(issue => issue.level === 'error').map(issue => issue.message).join('\n');
    expect(errors).toContain('物资「gold」在这个世界不存在');
    expect(errors).toContain('属性「魔力」在这个世界不存在');
    expect(errors).toContain('弹出的事件「nowhere」不存在');
    expect(errors).toContain('未知的节点类型 actions.summon_dragon');
    expect(errors).not.toContain('tide_cave');
    expect(issues.some(issue => issue.level === 'warning' && issue.message.includes('economy.traded'))).toBe(true);
  });

  test('提示词里的示例（触发器写法与完整自联动规则）放进合集后能编译并通过校验', () => {
    const reference = generatorReference(island);
    const prompt = buildEventGeneratorPrompt({
      worldName: island.name, worldDescription: island.description, worldBookEntries: [], moduleNames: [], statKeys: ['attrA'], statNames: { attrA: '生命' },
      resources: [{ id: 'water', name: '淡水' }, { id: 'food', name: '食物' }], assets: [], npcNames: [], factionNames: [], ...reference,
    });
    const triggers = [...prompt.matchAll(/^"trigger": (\{.*\})\s*(?:\/\/.*)?$/gm)].map(match => JSON.parse(match[1]));
    expect(triggers.length).toBeGreaterThanOrEqual(4);
    const ruleText = prompt.slice(prompt.indexOf('【完整自联动示例】'));
    const rule = JSON.parse(ruleText.slice(ruleText.indexOf('{\n    "id": "hunger_rule"'), ruleText.lastIndexOf('}') + 1));
    const base = output('player.hp');
    const card = base.events[0];
    const data = {
      bundleName: '示例',
      events: [
        ...triggers.map((trigger, index) => ({ ...card, id: `example_${index}`, name: `示例 ${index}`, trigger })),
        { ...card, id: 'starvation_event', name: '饥饿危机', trigger: undefined },
      ],
      rules: [{ ...rule, workflow: { ...rule.workflow, nodes: rule.workflow.nodes.map((node: Record<string, unknown>) => ({ position: { x: 0, y: 0 }, ...node })) } }],
    };
    const issues = validateGeneratedBundle(buildGeneratedBundle(data, island, { card: 'ai-card-x', rule: 'ai-rule-x' }), island);
    expect(issues.filter(issue => issue.level === 'error')).toEqual([]);
  });

  test('生成提示词带上本世界的变量、命令与选项后果写法', () => {
    const reference = generatorReference(island);
    expect(reference.variables.some(item => item.path === 'player.resources.water')).toBe(true);
    expect(reference.commands).toContain('resources.grant');
    const prompt = buildEventGeneratorPrompt({
      worldName: island.name, worldDescription: island.description, worldBookEntries: [], moduleNames: [], statKeys: ['attrA'], statNames: { attrA: '生命' },
      resources: [{ id: 'water', name: '淡水' }], assets: [], npcNames: [], factionNames: [], ...reference,
    });
    expect(prompt).toContain('【选项的后果');
    expect(prompt).toContain('player.resources.water');
    expect(prompt).not.toContain('choice.static(flow_out) → effect.stat(flow_in)');
  });
});
