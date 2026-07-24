// ============================================================
//  卡片工作流模板 — 8 种预设模板
//  一键创建常见事件模式
// ============================================================
import type { CardWorkflowDefinition, CardNodeInstance, CardWorkflowConnection } from './schema';

export interface CardWorkflowTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: '探索' | '交易' | '对话' | '战斗' | '剧情';
  create: () => CardWorkflowDefinition;
}

// ─── 辅助工厂 ───

let nodeCounter = 0;
function nodeId(): string {
  return `tpl-${Date.now().toString(36)}-${(nodeCounter++).toString(36)}`;
}

function node(typeId: CardNodeInstance['typeId'], x: number, y: number, widgetValues?: Record<string, unknown>): CardNodeInstance {
  return { id: nodeId(), typeId, position: { x, y }, widgetValues };
}

function conn(sourceId: string, sourceSocket: string, targetId: string, targetSocket: string): CardWorkflowConnection {
  return { id: `conn-${nodeCounter++}`, sourceNodeId: sourceId, sourceSocketKey: sourceSocket, targetNodeId: targetId, targetSocketKey: targetSocket };
}

function workflow(name: string, nodes: CardNodeInstance[], connections: CardWorkflowConnection[]): CardWorkflowDefinition {
  return { version: 1, id: `tpl-${Date.now().toString(36)}`, name, nodes, connections };
}

// ═══════════════════════════════════════════════════════════
//  8 种预设模板
// ═══════════════════════════════════════════════════════════

const templates: CardWorkflowTemplate[] = [
  {
    id: 'explore',
    name: '探索事件',
    description: 'narrative → static choice → effects',
    icon: 'Compass',
    category: '探索',
    create: () => {
      const n1 = node('narrative.title', 0, 0, { title: '探索未知区域' });
      const n2 = node('narrative.text', 0, 100, { text: '你来到了一片未知的区域，前方有几条路可以选择。' });
      const n3 = node('choice.static', 0, 200, { options: JSON.stringify([
        { label: '走左边的小路', aiNote: '选择了左边的小路' },
        { label: '走右边的大路', aiNote: '选择了右边的大路' },
        { label: '原地休息', aiNote: '选择休息恢复体力' },
      ]) });
      const n4 = node('effect.stat', -100, 300, { statKey: '能量', delta: -5 });
      const n5 = node('effect.resource', 100, 300, { resourceKey: '生存资源.食物', delta: -1 });
      return workflow('探索事件', [n1, n2, n3, n4, n5], [
        conn(n1.id, 'flow_out', n2.id, 'flow_in'),
        conn(n2.id, 'flow_out', n3.id, 'flow_in'),
        conn(n3.id, 'flow_out', n4.id, 'flow_in'),
        conn(n3.id, 'flow_out', n5.id, 'flow_in'),
      ]);
    },
  },

  {
    id: 'shop',
    name: '商店交易',
    description: 'narrative → conditional choice → resource effects',
    icon: 'Store',
    category: '交易',
    create: () => {
      const n1 = node('narrative.title', 0, 0, { title: '路边商人' });
      const n2 = node('narrative.dialog', 0, 100, { npcName: '商人', dialogText: '要买点什么吗？我这有好东西。' });
      const n3 = node('choice.conditional', 0, 200, { options: JSON.stringify([
        { label: '买食物（10金）', conditionPath: '玩家.经营资产.资金', conditionOp: '>=', conditionValue: 10, effect: { resourcePath: '生存资源.食物', delta: 3 } },
        { label: '买水（5金）', conditionPath: '玩家.经营资产.资金', conditionOp: '>=', conditionValue: 5, effect: { resourcePath: '生存资源.水', delta: 2 } },
        { label: '离开', aiNote: '没有购买任何东西' },
      ]) });
      return workflow('商店交易', [n1, n2, n3], [
        conn(n1.id, 'flow_out', n2.id, 'flow_in'),
        conn(n2.id, 'flow_out', n3.id, 'flow_in'),
      ]);
    },
  },

  {
    id: 'npc_dialog',
    name: 'NPC 对话',
    description: 'dialog → weighted choice → flag effects',
    icon: 'MessageCircle',
    category: '对话',
    create: () => {
      const n1 = node('narrative.title', 0, 0, { title: '神秘老人' });
      const n2 = node('narrative.dialog', 0, 100, { npcName: '神秘老人', dialogText: '年轻人，你想知道什么？', emotion: 'serious' });
      const n3 = node('choice.weighted', 0, 200, { showCount: 2, options: JSON.stringify([
        { label: '询问宝藏', aiNote: '向老人询问宝藏', weight: 30 },
        { label: '询问危险', aiNote: '向老人询问危险', weight: 50 },
        { label: '闲聊', aiNote: '和老人闲聊', weight: 20 },
      ]) });
      const n4 = node('effect.flag', 0, 300, { flagPath: 'flags.已遇到神秘老人', value: true });
      return workflow('NPC 对话', [n1, n2, n3, n4], [
        conn(n1.id, 'flow_out', n2.id, 'flow_in'),
        conn(n2.id, 'flow_out', n3.id, 'flow_in'),
        conn(n3.id, 'flow_out', n4.id, 'flow_in'),
      ]);
    },
  },

  {
    id: 'random_encounter',
    name: '随机遭遇',
    description: 'narrative → dynamic choice → branch',
    icon: 'Zap',
    category: '战斗',
    create: () => {
      const n1 = node('narrative.title', 0, 0, { title: '随机遭遇' });
      const n2 = node('narrative.text', 0, 100, { text: '你在路上遇到了一个不明情况...' });
      const n3 = node('choice.dynamic', 0, 200, { instruction: '根据玩家当前状态生成3个应对选项', minCount: 2, maxCount: 4 });
      const n4 = node('flow.branch', 0, 300, { checkPath: '玩家.生存状态.生命', op: '>=', compareValue: '50' });
      const n5 = node('narrative.text', -100, 400, { text: '你成功应对了情况。' });
      const n6 = node('narrative.text', 100, 400, { text: '你勉强应对了情况，但受了些伤。' });
      return workflow('随机遭遇', [n1, n2, n3, n4, n5, n6], [
        conn(n1.id, 'flow_out', n2.id, 'flow_in'),
        conn(n2.id, 'flow_out', n3.id, 'flow_in'),
        conn(n3.id, 'flow_out', n4.id, 'flow_in'),
        conn(n4.id, 'true_out', n5.id, 'flow_in'),
        conn(n4.id, 'false_out', n6.id, 'flow_in'),
      ]);
    },
  },

  {
    id: 'story_branch',
    name: '剧情分支',
    description: 'narrative → branch → multiple narratives',
    icon: 'GitBranch',
    category: '剧情',
    create: () => {
      const n1 = node('narrative.title', 0, 0, { title: '命运的抉择' });
      const n2 = node('narrative.text', 0, 100, { text: '你站在岔路口，必须做出选择...' });
      const n3 = node('flow.branch', 0, 200, { checkPath: 'flags.已遇到村长', op: '==', compareValue: 'true' });
      const n4 = node('narrative.text', -100, 300, { text: '你选择了熟悉的路，因为村长告诉过你这里的秘密。' });
      const n5 = node('narrative.text', 100, 300, { text: '你选择了陌生的路，一切都是未知。' });
      return workflow('剧情分支', [n1, n2, n3, n4, n5], [
        conn(n1.id, 'flow_out', n2.id, 'flow_in'),
        conn(n2.id, 'flow_out', n3.id, 'flow_in'),
        conn(n3.id, 'true_out', n4.id, 'flow_in'),
        conn(n3.id, 'false_out', n5.id, 'flow_in'),
      ]);
    },
  },

  {
    id: 'resource_check',
    name: '资源检查',
    description: 'branch → conditional narrative → effects',
    icon: 'Package',
    category: '探索',
    create: () => {
      const n1 = node('flow.branch', 0, 0, { checkPath: '玩家.生存资源.食物.数量', op: '>', compareValue: '0' });
      const n2 = node('narrative.text', -100, 100, { text: '你有食物，可以安心休息。' });
      const n3 = node('narrative.text', 100, 100, { text: '你没有食物了，饥肠辘辘...' });
      const n4 = node('effect.stat', -100, 200, { statKey: '能量', delta: 10 });
      const n5 = node('effect.stat', 100, 200, { statKey: '生命', delta: -5 });
      return workflow('资源检查', [n1, n2, n3, n4, n5], [
        conn(n1.id, 'true_out', n2.id, 'flow_in'),
        conn(n1.id, 'false_out', n3.id, 'flow_in'),
        conn(n2.id, 'flow_out', n4.id, 'flow_in'),
        conn(n3.id, 'flow_out', n5.id, 'flow_in'),
      ]);
    },
  },

  {
    id: 'chain_event',
    name: '连续事件',
    description: 'narrative → choice → narrative → effects',
    icon: 'Link',
    category: '剧情',
    create: () => {
      const n1 = node('narrative.title', 0, 0, { title: '连续事件' });
      const n2 = node('narrative.text', 0, 100, { text: '你发现了一个神秘的洞穴...' });
      const n3 = node('choice.static', 0, 200, { options: JSON.stringify([
        { label: '进入洞穴', aiNote: '决定进入洞穴探索' },
        { label: '离开', aiNote: '决定不冒险' },
      ]) });
      const n4 = node('narrative.text', 0, 300, { text: '洞穴里有一箱金币！' });
      const n5 = node('effect.resource', 0, 400, { resourceKey: '经营资产.资金', delta: 100 });
      return workflow('连续事件', [n1, n2, n3, n4, n5], [
        conn(n1.id, 'flow_out', n2.id, 'flow_in'),
        conn(n2.id, 'flow_out', n3.id, 'flow_in'),
        conn(n3.id, 'flow_out', n4.id, 'flow_in'),
        conn(n4.id, 'flow_out', n5.id, 'flow_in'),
      ]);
    },
  },

  {
    id: 'ai_dynamic',
    name: 'AI 动态叙事',
    description: 'dynamic choice → effects → narrate hint',
    icon: 'Sparkles',
    category: '探索',
    create: () => {
      const n1 = node('narrative.title', 0, 0, { title: 'AI 动态叙事' });
      const n2 = node('narrative.text', 0, 100, { text: '你来到了一个神秘的地方...' });
      const n3 = node('choice.dynamic', 0, 200, {
        instruction: '根据玩家当前的属性和资源，生成3个有意义的选项，每个选项应有不同的风险和收益',
        minCount: 3, maxCount: 5,
      });
      const n4 = node('effect.stat', 0, 300, { statKey: '能量', delta: -10 });
      return workflow('AI 动态叙事', [n1, n2, n3, n4], [
        conn(n1.id, 'flow_out', n2.id, 'flow_in'),
        conn(n2.id, 'flow_out', n3.id, 'flow_in'),
        conn(n3.id, 'flow_out', n4.id, 'flow_in'),
      ]);
    },
  },
];

// ─── 导出 ───

export function getAllCardWorkflowTemplates(): CardWorkflowTemplate[] {
  return templates;
}

export function getCardWorkflowTemplate(id: string): CardWorkflowTemplate | undefined {
  return templates.find(t => t.id === id);
}

export function getCardWorkflowTemplatesByCategory(category: string): CardWorkflowTemplate[] {
  return templates.filter(t => t.category === category);
}
