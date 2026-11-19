/**
 * AI 生成的事件合集：整理成事件包 + 规则包文件，并用事件校验检查引用是否存在，供「校验 → 修复」使用。
 */
import type { WorldDef } from '../data/worlds-schema';
import type { CardWorkflowDefinition, EventIndexEntry, Manifest } from '../modules/schema';
import { buildCanonicalCardPackFiles, type CanonicalCardPackEvent } from '../modules/webEventStore';
import { readCanonicalEventPack } from '../modules/eventPackFormat';
import { createDefaultGameState } from '../schema/variables';
import { createGameplayHost } from '../core/registry';
import { compileEventCatalog, type RuntimePackLike, type TriggerInput } from './catalog';
import { validateEventCatalog, type EventIssue } from './validate';

export interface GeneratedPack {
  id: string;
  manifest: Manifest;
  files: Record<string, string>;
}

export interface GeneratedBundle {
  bundleName: string;
  eventCount: number;
  ruleCount: number;
  nodeCount: number;
  card: GeneratedPack;
  rule?: GeneratedPack;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** 生成器给 AI 的参考：变量、命令与常见领域事件。 */
export function generatorReference(world: WorldDef) {
  const base = createDefaultGameState();
  const host = createGameplayHost(world, base);
  const state = host.prepare(base);
  const variables = host.facts.catalog(state, { audience: 'director' })
    .filter(entry => ['number', 'boolean', 'string'].includes(entry.type) && !entry.path.startsWith('npc.'))
    .map(entry => ({ path: entry.path, label: entry.label, type: entry.type, writable: entry.writable.includes('event') }));
  const playerOnly = new Set(['stats.allocate', 'progression.breakthrough', 'dice.roll']);
  const commands = host.commandNames().filter(name => !name.startsWith('events.') && !playerOnly.has(name));
  // 本世界会发生的领域事件（来自已启用模块的声明），写成「类型（说明；payload 说明）」。
  const domainEvents = host.domainEvents().map(spec => `${spec.type}（${spec.label}${spec.payload ? `；${spec.payload}` : ''}）`);
  return { variables, commands, domainEvents };
}

export function buildGeneratedBundle(data: unknown, world: WorldDef, ids: { card: string; rule: string }): GeneratedBundle {
  const source = record(data);
  const bundleName = typeof source.bundleName === 'string' && source.bundleName.trim() ? source.bundleName.trim() : `${world.name} 内容合集`;
  const events = Array.isArray(source.events) ? source.events.map(record) : [];
  const rules = Array.isArray(source.rules) ? source.rules.map(record) : [];
  let nodeCount = 0;
  const triggers: Record<string, TriggerInput> = {};
  const cardEvents: CanonicalCardPackEvent[] = events.map((event, index) => {
    const entry: EventIndexEntry = {
      id: typeof event.id === 'string' && event.id.trim() ? event.id.trim() : `evt_${index + 1}`,
      name: typeof event.name === 'string' && event.name.trim() ? event.name.trim() : '未命名事件',
    };
    const generated = record(event.workflow);
    const nodes = Array.isArray(generated.nodes) ? generated.nodes : [];
    nodeCount += nodes.length;
    if (event.trigger && typeof event.trigger === 'object') triggers[entry.id] = event.trigger as TriggerInput;
    const workflow: CardWorkflowDefinition = {
      version: 1, id: entry.id, name: entry.name,
      nodes: nodes as CardWorkflowDefinition['nodes'],
      connections: (Array.isArray(generated.connections) ? generated.connections : []) as CardWorkflowDefinition['connections'],
    };
    return { entry, workflow };
  });
  const cardManifest: Manifest = {
    id: ids.card, name: `${bundleName} - 事件`, version: '1.0.0', author: 'AI 生成',
    description: `基于「${world.name}」由 AI 生成的事件合集`, engine: 'opt-event', schemaVersion: 1, minAppVersion: '2.6.1',
    type: 'card', coverColor: '#8b5cf6', icon: 'Sparkles', enabledByDefault: false, loadOrder: 100, permissions: ['add_card'], worldId: world.id,
  };
  const card: GeneratedPack = {
    id: ids.card,
    manifest: cardManifest,
    files: {
      'manifest.json': JSON.stringify(cardManifest, null, 2),
      ...buildCanonicalCardPackFiles(cardManifest.name, cardEvents),
      ...(Object.keys(triggers).length ? { 'schema/triggers.json': JSON.stringify({ triggers }, null, 2) } : {}),
    },
  };
  let rule: GeneratedPack | undefined;
  if (rules.length > 0) {
    const nodes: Array<Record<string, unknown>> = [];
    const connections: Array<Record<string, unknown>> = [];
    let yOffset = 0;
    for (const item of rules) {
      const workflow = record(item.workflow);
      const ruleNodes = (Array.isArray(workflow.nodes) ? workflow.nodes : []).map(record);
      nodes.push(...ruleNodes.map(node => {
        const position = record(node.position);
        return { ...node, position: { x: Number(position.x) || 100, y: (Number(position.y) || 0) + yOffset } };
      }));
      connections.push(...(Array.isArray(workflow.connections) ? workflow.connections.map(record) : []));
      nodeCount += ruleNodes.length;
      yOffset += ruleNodes.reduce((max, node) => Math.max(max, (Number(record(node.position).y) || 0) + 150), 300);
    }
    const ruleManifest: Manifest = {
      id: ids.rule, name: `${bundleName} - 规则`, version: '1.0.0', author: 'AI 生成',
      description: `基于「${world.name}」由 AI 生成的规则合集`, engine: 'opt-event', schemaVersion: 1, minAppVersion: '2.6.1',
      type: 'rule', coverColor: '#f59e0b', icon: 'Zap', enabledByDefault: false, loadOrder: 100,
      // 规则要能弹出本合集的事件卡、安排延迟事件。
      permissions: ['read_world_state', 'modify_world_state', 'add_card', 'register_tick'], rules: [], worldId: world.id,
    };
    rule = {
      id: ids.rule,
      manifest: ruleManifest,
      files: {
        'manifest.json': JSON.stringify(ruleManifest, null, 2),
        'schema/rules.json': JSON.stringify({ version: 1, rules: [], periodicRules: [] }, null, 2),
        'schema/workflow.json': JSON.stringify({ version: 1, id: `rule-wf-${ids.rule}`, name: bundleName, nodes, connections }, null, 2),
      },
    };
  }
  return { bundleName, eventCount: events.length, ruleCount: rules.length, nodeCount, card, ...(rule ? { rule } : {}) };
}

function runtime(pack: GeneratedPack): RuntimePackLike {
  return { id: pack.id, manifest: { name: pack.manifest.name, worldId: pack.manifest.worldId, permissions: pack.manifest.permissions }, files: pack.files };
}

/** 校验生成的合集：返回错误与警告（编译问题、引用不存在的属性/物资/命令/后续事件等）。 */
export function validateGeneratedBundle(bundle: GeneratedBundle, world: WorldDef): EventIssue[] {
  const packs = [runtime(bundle.card), ...(bundle.rule ? [runtime(bundle.rule)] : [])];
  const compiled = compileEventCatalog(world, packs, files => [...readCanonicalEventPack(files).workflows]);
  const own = new Set(packs.map(pack => pack.id));
  const catalog = { worldId: world.id, definitions: compiled.definitions, warnings: compiled.warnings, summary: '' };
  const issues = validateEventCatalog(world, { catalog }).filter(issue => own.has(issue.key.split('/')[0] ?? ''));
  const cards = compiled.definitions.filter(def => def.kind === 'card' && own.has(def.packId));
  if (bundle.eventCount > 0 && cards.length === 0) issues.push({ key: bundle.card.id, level: 'error', message: '事件包里没有读出任何卡片（检查 events[].workflow 的结构）' });
  for (const warning of compiled.warnings) issues.push({ key: bundle.card.id, level: 'warning', message: warning });
  return issues;
}

/** 修复请求：把校验问题逐条告诉 AI，要求返回完整 JSON。 */
export function buildRepairMessage(issues: readonly EventIssue[]): string {
  const lines = issues.slice(0, 30).map(issue => `- ${issue.key}${issue.option !== undefined ? ` 第 ${issue.option + 1} 个选项` : ''}：${issue.message}`);
  return `上面的合集校验发现以下问题：\n${lines.join('\n')}\n请只修正这些问题（属性 key、物资 id、变量路径、命令名必须使用参考表里的精确值；后续事件 id 必须存在），保持其余内容不变，输出修正后的完整 JSON，不要任何解释文字。`;
}

export function errorCount(issues: readonly EventIssue[]): number {
  return issues.filter(issue => issue.level === 'error').length;
}
