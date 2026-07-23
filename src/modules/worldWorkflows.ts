// ============================================================
//  6 个内置世界的规则 → 工作流定义
//  用新节点系统重写旧规则，提升上限
// ============================================================
import type { WorkflowDefinition, NodeInstance, WorkflowConnection } from './workflowSchema';

let _nodeId = 0;
function nid(): string { return `n${++_nodeId}`; }
function resetId() { _nodeId = 0; }

function node(typeId: string, label: string, x: number, y: number, widgetValues?: Record<string, unknown>): NodeInstance {
  const id = nid();
  return { id, typeId, label, position: { x, y }, widgetValues: widgetValues ?? {} };
}

function conn(source: NodeInstance, target: NodeInstance, sourceSocket = 'flow_out', targetSocket = 'flow_in'): WorkflowConnection {
  return { id: `e-${source.id}-${target.id}`, sourceNodeId: source.id, sourceSocketKey: sourceSocket, targetNodeId: target.id, targetSocketKey: targetSocket };
}

function connData(source: NodeInstance, target: NodeInstance, sourceSocket: string, targetSocket: string): WorkflowConnection {
  return { id: `e-${source.id}-${target.id}`, sourceNodeId: source.id, sourceSocketKey: sourceSocket, targetNodeId: target.id, targetSocketKey: targetSocket };
}

function makeWorkflow(id: string, name: string, nodes: NodeInstance[], connections: WorkflowConnection[]): WorkflowDefinition {
  return { version: 1, id, name, nodes, connections };
}

// ═══════════════════════════════════════════════════════════
//  1. 武林风云
// ═══════════════════════════════════════════════════════════
export function wuxiaWorldWorkflow(): WorkflowDefinition {
  resetId();
  const nodes: NodeInstance[] = [];
  const conns: WorkflowConnection[] = [];

  // === 周期：内息恢复（每3轮体力+5）===
  const p1 = node('triggers.periodic', '内息恢复', 50, 50, { interval: 3, description: '调息吐纳恢复内息', narrate: true });
  const a1 = node('actions.modify_stat', '体力+5', 300, 50, { stat_key: '体力值', delta: 5 });
  nodes.push(p1, a1);
  conns.push(conn(p1, a1));

  // === 周期：内息波动（每5轮体力+3）===
  const p2 = node('triggers.periodic', '内息波动', 50, 150, { interval: 5, offset: 2, description: '内息自然波动' });
  const a2 = node('actions.modify_stat', '体力+3', 300, 150, { stat_key: '体力值', delta: 3 });
  nodes.push(p2, a2);
  conns.push(conn(p2, a2));

  // === 周期：江湖局势（每10轮AI叙事）===
  const p3 = node('triggers.periodic', '江湖局势', 50, 250, { interval: 10, offset: 3, description: '江湖局势变化', narrate: true });
  nodes.push(p3);

  // === 周期：门派动态（每7轮AI叙事）===
  const p4 = node('triggers.periodic', '门派动态', 50, 350, { interval: 7, offset: 5, description: '各门派动态', narrate: true });
  nodes.push(p4);

  // === 事件规则：比武挑战（血量>80）===
  const t1 = node('triggers.world_event', '比武触发', 50, 500, { match_type: 'tick' });
  const c1 = node('conditions.check_stat', '血量>80', 300, 500, { stat_key: 'attrA', op: '>', threshold: 80 });
  const e1 = node('actions.add_event', '比武挑战', 550, 500, { event_id: 'duel' });
  nodes.push(t1, c1, e1);
  conns.push(conn(t1, c1), conn(c1, e1));

  // === 事件规则：藏宝图（体力>60）===
  const t2 = node('triggers.world_event', '藏宝图触发', 50, 620, { match_type: 'tick' });
  const c2 = node('conditions.check_stat', '体力>60', 300, 620, { stat_key: '体力值', op: '>', threshold: 60 });
  const e2 = node('actions.add_event', '藏宝图', 550, 620, { event_id: 'treasure_map' });
  nodes.push(t2, c2, e2);
  conns.push(conn(t2, c2), conn(c2, e2));

  // === 事件规则：中毒（血量<50）===
  const t3 = node('triggers.world_event', '中毒触发', 50, 740, { match_type: 'tick' });
  const c3 = node('conditions.check_stat', '血量<50', 300, 740, { stat_key: 'attrA', op: '<', threshold: 50 });
  const e3 = node('actions.add_event', '中毒', 550, 740, { event_id: 'poison' });
  nodes.push(t3, c3, e3);
  conns.push(conn(t3, c3), conn(c3, e3));

  // === 事件规则：武功突破（血量>150）===
  const t4 = node('triggers.world_event', '突破触发', 50, 860, { match_type: 'tick' });
  const c4 = node('conditions.check_stat', '血量>150', 300, 860, { stat_key: 'attrA', op: '>', threshold: 150 });
  const e4 = node('actions.add_event', '武功突破', 550, 860, { event_id: 'breakthrough' });
  nodes.push(t4, c4, e4);
  conns.push(conn(t4, c4), conn(c4, e4));

  // === 事件规则：秘境（悟性>70 AND 福缘>60）===
  const t5 = node('triggers.world_event', '秘境触发', 50, 980, { match_type: 'tick' });
  const c5a = node('conditions.check_stat', '悟性>70', 300, 950, { stat_key: 'dim4', op: '>', threshold: 70 });
  const c5b = node('conditions.check_stat', '福缘>60', 300, 1020, { stat_key: 'dim6', op: '>', threshold: 60 });
  const c5and = node('conditions.and', '并且', 550, 980);
  const g5 = node('flow.gate', '门控', 720, 980);
  const e5 = node('actions.add_event', '秘境发现', 900, 980, { event_id: 'secret_realm' });
  nodes.push(t5, c5a, c5b, c5and, g5, e5);
  conns.push(
    connData(t5, c5a, 'flow_out', 'flow_in'),
    connData(t5, c5b, 'flow_out', 'flow_in'),
    connData(c5a, c5and, 'met', 'in_0'),
    connData(c5b, c5and, 'met', 'in_1'),
    connData(t5, g5, 'flow_out', 'flow_in'),
    connData(c5and, g5, 'result', 'condition'),
    conn(g5, e5),
  );

  // === 事件规则：重伤（血量<30）===
  const t6 = node('triggers.world_event', '重伤触发', 50, 1120, { match_type: 'tick' });
  const c6 = node('conditions.check_stat', '血量<30', 300, 1120, { stat_key: 'attrA', op: '<', threshold: 30 });
  const e6 = node('actions.add_event', '重伤', 550, 1120, { event_id: 'injury' });
  nodes.push(t6, c6, e6);
  conns.push(conn(t6, c6), conn(c6, e6));

  // === 事件规则：奇遇（福缘>75）===
  const t7 = node('triggers.world_event', '奇遇触发', 50, 1240, { match_type: 'tick' });
  const c7 = node('conditions.check_stat', '福缘>75', 300, 1240, { stat_key: 'dim6', op: '>', threshold: 75 });
  const e7 = node('actions.add_event', '奇遇', 550, 1240, { event_id: 'encounter' });
  nodes.push(t7, c7, e7);
  conns.push(conn(t7, c7), conn(c7, e7));

  // === 事件规则：宿敌（膂力>60 AND 血量>100）===
  const t8 = node('triggers.world_event', '宿敌触发', 50, 1360, { match_type: 'tick' });
  const c8a = node('conditions.check_stat', '膂力>60', 300, 1330, { stat_key: 'dim1', op: '>', threshold: 60 });
  const c8b = node('conditions.check_stat', '血量>100', 300, 1400, { stat_key: 'attrA', op: '>', threshold: 100 });
  const c8and = node('conditions.and', '并且', 550, 1360);
  const g8 = node('flow.gate', '门控', 720, 1360);
  const e8 = node('actions.add_event', '宿敌', 900, 1360, { event_id: 'rival' });
  nodes.push(t8, c8a, c8b, c8and, g8, e8);
  conns.push(
    connData(t8, c8a, 'flow_out', 'flow_in'),
    connData(t8, c8b, 'flow_out', 'flow_in'),
    connData(c8a, c8and, 'met', 'in_0'),
    connData(c8b, c8and, 'met', 'in_1'),
    connData(t8, g8, 'flow_out', 'flow_in'),
    connData(c8and, g8, 'result', 'condition'),
    conn(g8, e8),
  );

  return makeWorkflow('wf-wuxia', '武林风云', nodes, conns);
}

// ═══════════════════════════════════════════════════════════
//  2. 烟火人间
// ═══════════════════════════════════════════════════════════
export function desireMetropolisWorkflow(): WorkflowDefinition {
  resetId();
  const nodes: NodeInstance[] = [];
  const conns: WorkflowConnection[] = [];

  // === 周期：日常节奏（每轮恢复体力+精力）===
  const p1 = node('triggers.periodic', '日常节奏', 50, 50, { interval: 1, description: '每天自然恢复' });
  const a1a = node('actions.modify_stat', '血量+3', 300, 30, { stat_key: 'attrA', delta: 3 });
  const a1b = node('actions.modify_stat', '体力+5', 300, 90, { stat_key: '体力值', delta: 5 });
  nodes.push(p1, a1a, a1b);
  conns.push(conn(p1, a1a), conn(p1, a1b));

  // === 周期：工作消耗（每5轮体力-15，条件：体力>20）===
  const p2 = node('triggers.periodic', '工作消耗', 50, 180, { interval: 5, description: '工作消耗精力' });
  const c2 = node('conditions.check_stat', '体力>20', 300, 180, { stat_key: '体力值', op: '>', threshold: 20 });
  const a2 = node('actions.modify_stat', '体力-15', 550, 180, { stat_key: '体力值', delta: -15 });
  nodes.push(p2, c2, a2);
  conns.push(conn(p2, c2), conn(c2, a2));

  // === 周期：房租提醒（每30轮AI叙事）===
  const p3 = node('triggers.periodic', '房租提醒', 50, 300, { interval: 30, description: '每月房租到期', narrate: true });
  nodes.push(p3);

  // === 周期：社交圈（每7轮AI叙事）===
  const p4 = node('triggers.periodic', '社交圈', 50, 400, { interval: 7, description: '朋友圈动态', narrate: true });
  nodes.push(p4);

  // === 事件：加班（体力<30 AND 血量>50）===
  const t1 = node('triggers.world_event', '加班触发', 50, 520, { match_type: 'tick' });
  const c1a = node('conditions.check_stat', '体力<30', 300, 490, { stat_key: '体力值', op: '<', threshold: 30 });
  const c1b = node('conditions.check_stat', '血量>50', 300, 560, { stat_key: 'attrA', op: '>', threshold: 50 });
  const c1and = node('conditions.and', '并且', 550, 520);
  const g1 = node('flow.gate', '门控', 720, 520);
  const e1 = node('actions.add_event', '加班', 900, 520, { event_id: 'overtime' });
  nodes.push(t1, c1a, c1b, c1and, g1, e1);
  conns.push(
    connData(t1, c1a, 'flow_out', 'flow_in'),
    connData(t1, c1b, 'flow_out', 'flow_in'),
    connData(c1a, c1and, 'met', 'in_0'),
    connData(c1b, c1and, 'met', 'in_1'),
    connData(t1, g1, 'flow_out', 'flow_in'),
    connData(c1and, g1, 'result', 'condition'),
    conn(g1, e1),
  );

  // === 事件：做饭（体力>60）===
  const t2 = node('triggers.world_event', '做饭触发', 50, 660, { match_type: 'tick' });
  const c2e = node('conditions.check_stat', '体力>60', 300, 660, { stat_key: '体力值', op: '>', threshold: 60 });
  const e2 = node('actions.add_event', '做饭', 550, 660, { event_id: 'cook' });
  nodes.push(t2, c2e, e2);
  conns.push(conn(t2, c2e), conn(c2e, e2));

  // === 事件：健身（血量>80）===
  const t3 = node('triggers.world_event', '健身触发', 50, 780, { match_type: 'tick' });
  const c3 = node('conditions.check_stat', '血量>80', 300, 780, { stat_key: 'attrA', op: '>', threshold: 80 });
  const e3 = node('actions.add_event', '健身', 550, 780, { event_id: 'gym' });
  nodes.push(t3, c3, e3);
  conns.push(conn(t3, c3), conn(c3, e3));

  // === 事件：搬家（体力<30）===
  const t4 = node('triggers.world_event', '搬家触发', 50, 900, { match_type: 'tick' });
  const c4 = node('conditions.check_stat', '体力<30', 300, 900, { stat_key: '体力值', op: '<', threshold: 30 });
  const e4 = node('actions.add_event', '搬家', 550, 900, { event_id: 'moving' });
  nodes.push(t4, c4, e4);
  conns.push(conn(t4, c4), conn(c4, e4));

  // === 事件：宠物生病（血量<40）===
  const t5 = node('triggers.world_event', '宠物生病触发', 50, 1020, { match_type: 'tick' });
  const c5 = node('conditions.check_stat', '血量<40', 300, 1020, { stat_key: 'attrA', op: '<', threshold: 40 });
  const e5 = node('actions.add_event', '宠物生病', 550, 1020, { event_id: 'pet_sick' });
  nodes.push(t5, c5, e5);
  conns.push(conn(t5, c5), conn(c5, e5));

  // === 事件：同事聚餐（社交>50）===
  const t6 = node('triggers.world_event', '聚餐触发', 50, 1140, { match_type: 'tick' });
  const c6 = node('conditions.check_stat', '社交>50', 300, 1140, { stat_key: 'dim5', op: '>', threshold: 50 });
  const e6 = node('actions.add_event', '同事聚餐', 550, 1140, { event_id: 'colleague_dinner' });
  nodes.push(t6, c6, e6);
  conns.push(conn(t6, c6), conn(c6, e6));

  // === 事件：约会（社交>60）===
  const t7 = node('triggers.world_event', '约会触发', 50, 1260, { match_type: 'tick' });
  const c7 = node('conditions.check_stat', '社交>60', 300, 1260, { stat_key: 'dim5', op: '>', threshold: 60 });
  const e7 = node('actions.add_event', '约会', 550, 1260, { event_id: 'date' });
  nodes.push(t7, c7, e7);
  conns.push(conn(t7, c7), conn(c7, e7));

  return makeWorkflow('wf-metropolis', '烟火人间', nodes, conns);
}

// ═══════════════════════════════════════════════════════════
//  3. 绥芬边贸
// ═══════════════════════════════════════════════════════════
export function borderTradeWorkflow(): WorkflowDefinition {
  resetId();
  const nodes: NodeInstance[] = [];
  const conns: WorkflowConnection[] = [];

  // === 周期：市场行情（每5轮AI叙事）===
  const p1 = node('triggers.periodic', '市场行情', 50, 50, { interval: 5, description: '市场行情波动', narrate: true });
  nodes.push(p1);

  // === 周期：口岸形势（每10轮AI叙事）===
  const p2 = node('triggers.periodic', '口岸形势', 50, 150, { interval: 10, description: '口岸形势变化', narrate: true });
  nodes.push(p2);

  // === 周期：政策变动（每15轮AI叙事）===
  const p3 = node('triggers.periodic', '政策变动', 50, 250, { interval: 15, offset: 8, description: '政策变动', narrate: true });
  nodes.push(p3);

  // === 周期：天气影响（每8轮AI叙事）===
  const p4 = node('triggers.periodic', '天气影响', 50, 350, { interval: 8, offset: 3, description: '天气对边贸的影响', narrate: true });
  nodes.push(p4);

  // === 事件：大单生意（货币>200）===
  const t1 = node('triggers.world_event', '大单触发', 50, 470, { match_type: 'tick' });
  const c1 = node('conditions.check_resource', '货币>200', 300, 470, { resource_key: '主货币', op: '>', threshold: 200 });
  const e1 = node('actions.add_event', '大单生意', 550, 470, { event_id: 'deal' });
  nodes.push(t1, c1, e1);
  conns.push(conn(t1, c1), conn(c1, e1));

  // === 事件：走私机会（货币<100）===
  const t2 = node('triggers.world_event', '走私触发', 50, 590, { match_type: 'tick' });
  const c2 = node('conditions.check_resource', '货币<100', 300, 590, { resource_key: '主货币', op: '<', threshold: 100 });
  const e2 = node('actions.add_event', '走私机会', 550, 590, { event_id: 'smuggle' });
  nodes.push(t2, c2, e2);
  conns.push(conn(t2, c2), conn(c2, e2));

  // === 事件：质量问题（货币>500）===
  const t3 = node('triggers.world_event', '质量触发', 50, 710, { match_type: 'tick' });
  const c3 = node('conditions.check_resource', '货币>500', 300, 710, { resource_key: '主货币', op: '>', threshold: 500 });
  const e3 = node('actions.add_event', '质量问题', 550, 710, { event_id: 'quality_issue' });
  nodes.push(t3, c3, e3);
  conns.push(conn(t3, c3), conn(c3, e3));

  // === 事件：大买卖（货币>1000）===
  const t4 = node('triggers.world_event', '大买卖触发', 50, 830, { match_type: 'tick' });
  const c4 = node('conditions.check_resource', '货币>1000', 300, 830, { resource_key: '主货币', op: '>', threshold: 1000 });
  const e4 = node('actions.add_event', '大买卖', 550, 830, { event_id: 'big_deal' });
  nodes.push(t4, c4, e4);
  conns.push(conn(t4, c4), conn(c4, e4));

  // === 事件：资金危机（货币<50）===
  const t5 = node('triggers.world_event', '危机触发', 50, 950, { match_type: 'tick' });
  const c5 = node('conditions.check_resource', '货币<50', 300, 950, { resource_key: '主货币', op: '<', threshold: 50 });
  const e5 = node('actions.add_event', '资金危机', 550, 950, { event_id: 'currency_crisis' });
  nodes.push(t5, c5, e5);
  conns.push(conn(t5, c5), conn(c5, e5));

  // === 事件：人脉拓展（货币>300）===
  const t6 = node('triggers.world_event', '人脉触发', 50, 1070, { match_type: 'tick' });
  const c6 = node('conditions.check_resource', '货币>300', 300, 1070, { resource_key: '主货币', op: '>', threshold: 300 });
  const e6 = node('actions.add_event', '人脉拓展', 550, 1070, { event_id: 'network' });
  nodes.push(t6, c6, e6);
  conns.push(conn(t6, c6), conn(c6, e6));

  // === 事件：骗局（货币>600）===
  const t7 = node('triggers.world_event', '骗局触发', 50, 1190, { match_type: 'tick' });
  const c7 = node('conditions.check_resource', '货币>600', 300, 1190, { resource_key: '主货币', op: '>', threshold: 600 });
  const e7 = node('actions.add_event', '骗局', 550, 1190, { event_id: 'scam' });
  nodes.push(t7, c7, e7);
  conns.push(conn(t7, c7), conn(c7, e7));

  return makeWorkflow('wf-border-trade', '绥芬边贸', nodes, conns);
}

// ═══════════════════════════════════════════════════════════
//  4. 日式校园
// ═══════════════════════════════════════════════════════════
export function japaneseSchoolWorkflow(): WorkflowDefinition {
  resetId();
  const nodes: NodeInstance[] = [];
  const conns: WorkflowConnection[] = [];

  // === 周期：校园日常（每3轮AI叙事）===
  const p1 = node('triggers.periodic', '校园日常', 50, 50, { interval: 3, offset: 1, description: '校园日常节奏', narrate: true });
  nodes.push(p1);

  // === 周期：学业消耗（每5轮体力-5）===
  const p2 = node('triggers.periodic', '学业消耗', 50, 150, { interval: 5, description: '学业消耗体力' });
  const a2 = node('actions.modify_stat', '体力-5', 300, 150, { stat_key: '体力值', delta: -5 });
  nodes.push(p2, a2);
  conns.push(conn(p2, a2));

  // === 周期：季节变化（每30轮AI叙事）===
  const p3 = node('triggers.periodic', '季节变化', 50, 260, { interval: 30, description: '季节更替', narrate: true });
  nodes.push(p3);

  // === 周期：人际关系（每10轮AI叙事）===
  const p4 = node('triggers.periodic', '人际关系', 50, 360, { interval: 10, offset: 5, description: '人际关系发展', narrate: true });
  nodes.push(p4);

  // === 事件：告白（好感度>=70）===
  const t1 = node('triggers.world_event', '告白触发', 50, 480, { match_type: 'tick' });
  const c1 = node('conditions.check_npc', '好感度>=70', 300, 480, { npc_id: '学生', field: '好感度', op: '>=', threshold: 70 });
  const e1 = node('actions.add_event', '告白', 550, 480, { event_id: 'confession' });
  nodes.push(t1, c1, e1);
  conns.push(conn(t1, c1), conn(c1, e1));

  // === 事件：文化祭（秋季，用AI叙事提示代替时间检查）===
  const t2 = node('triggers.world_event', '文化祭触发', 50, 600, { match_type: 'tick' });
  const c2 = node('conditions.check_flag', '秋季标记', 300, 600, { path: '世界.时间系统.季节', op: 'contains', threshold: '秋' });
  const e2 = node('actions.add_event', '文化祭', 550, 600, { event_id: 'festival' });
  nodes.push(t2, c2, e2);
  conns.push(conn(t2, c2), conn(c2, e2));

  // === 事件：体育祭（春季）===
  const t3 = node('triggers.world_event', '体育祭触发', 50, 720, { match_type: 'tick' });
  const c3 = node('conditions.check_flag', '春季标记', 300, 720, { path: '世界.时间系统.季节', op: 'contains', threshold: '春' });
  const e3 = node('actions.add_event', '体育祭', 550, 720, { event_id: 'sports_festival' });
  nodes.push(t3, c3, e3);
  conns.push(conn(t3, c3), conn(c3, e3));

  // === 事件：情人节（2月）===
  const t4 = node('triggers.world_event', '情人节触发', 50, 840, { match_type: 'tick' });
  const c4 = node('conditions.check_flag', '2月标记', 300, 840, { path: '世界.时间系统.当前时间', op: 'contains', threshold: '2月' });
  const e4 = node('actions.add_event', '情人节', 550, 840, { event_id: 'valentine' });
  nodes.push(t4, c4, e4);
  conns.push(conn(t4, c4), conn(c4, e4));

  // === 事件：雨天 ===
  const t5 = node('triggers.world_event', '雨天触发', 50, 960, { match_type: 'tick' });
  const c5 = node('conditions.check_flag', '雨天标记', 300, 960, { path: '世界.时间系统.当前天气', op: 'contains', threshold: '雨' });
  const e5 = node('actions.add_event', '雨天', 550, 960, { event_id: 'rainy_day' });
  nodes.push(t5, c5, e5);
  conns.push(conn(t5, c5), conn(c5, e5));

  return makeWorkflow('wf-japanese-school', '日式校园', nodes, conns);
}

// ═══════════════════════════════════════════════════════════
//  5. 余烬废土
// ═══════════════════════════════════════════════════════════
export function wastelandWorkflow(): WorkflowDefinition {
  resetId();
  const nodes: NodeInstance[] = [];
  const conns: WorkflowConnection[] = [];

  // === 周期：辐射侵蚀（每14轮血量-10体力-15）===
  const p1 = node('triggers.periodic', '辐射侵蚀', 50, 50, { interval: 14, description: '辐射侵蚀身体' });
  const a1a = node('actions.modify_stat', '血量-10', 300, 30, { stat_key: 'attrA', delta: -10 });
  const a1b = node('actions.modify_stat', '体力-15', 300, 90, { stat_key: '体力值', delta: -15 });
  nodes.push(p1, a1a, a1b);
  conns.push(conn(p1, a1a), conn(p1, a1b));

  // === 周期：物资耗竭（每30轮体力-10）===
  const p2 = node('triggers.periodic', '物资耗竭', 50, 180, { interval: 30, description: '物资逐渐耗竭' });
  const a2 = node('actions.modify_stat', '体力-10', 300, 180, { stat_key: '体力值', delta: -10 });
  nodes.push(p2, a2);
  conns.push(conn(p2, a2));

  // === 周期：环境危害（每10轮AI叙事）===
  const p3 = node('triggers.periodic', '环境危害', 50, 290, { interval: 10, offset: 5, description: '废土环境变化', narrate: true });
  nodes.push(p3);

  // === 周期：资源稀缺（每20轮体力-5）===
  const p4 = node('triggers.periodic', '资源稀缺', 50, 390, { interval: 20, offset: 10, description: '资源逐渐稀缺' });
  const a4 = node('actions.modify_stat', '体力-5', 300, 390, { stat_key: '体力值', delta: -5 });
  nodes.push(p4, a4);
  conns.push(conn(p4, a4));

  // === 事件：辐射风暴（血量>50）===
  const t1 = node('triggers.world_event', '辐射风暴触发', 50, 510, { match_type: 'tick' });
  const c1 = node('conditions.check_stat', '血量>50', 300, 510, { stat_key: 'attrA', op: '>', threshold: 50 });
  const e1 = node('actions.add_event', '辐射风暴', 550, 510, { event_id: 'radiation_storm' });
  nodes.push(t1, c1, e1);
  conns.push(conn(t1, c1), conn(c1, e1));

  // === 事件：变异体袭击（体力>30）===
  const t2 = node('triggers.world_event', '变异体触发', 50, 630, { match_type: 'tick' });
  const c2 = node('conditions.check_stat', '体力>30', 300, 630, { stat_key: '体力值', op: '>', threshold: 30 });
  const e2 = node('actions.add_event', '变异体袭击', 550, 630, { event_id: 'mutant_fight' });
  nodes.push(t2, c2, e2);
  conns.push(conn(t2, c2), conn(c2, e2));

  // === 事件：补给点（血量<50）===
  const t3 = node('triggers.world_event', '补给触发', 50, 750, { match_type: 'tick' });
  const c3 = node('conditions.check_stat', '血量<50', 300, 750, { stat_key: 'attrA', op: '<', threshold: 50 });
  const e3 = node('actions.add_event', '补给点', 550, 750, { event_id: 'supply_cache' });
  nodes.push(t3, c3, e3);
  conns.push(conn(t3, c3), conn(c3, e3));

  // === 事件：辐射病（血量<30）===
  const t4 = node('triggers.world_event', '辐射病触发', 50, 870, { match_type: 'tick' });
  const c4 = node('conditions.check_stat', '血量<30', 300, 870, { stat_key: 'attrA', op: '<', threshold: 30 });
  const e4 = node('actions.add_event', '辐射病', 550, 870, { event_id: 'radiation_sickness' });
  nodes.push(t4, c4, e4);
  conns.push(conn(t4, c4), conn(c4, e4));

  // === 事件：异能觉醒（体力>50）===
  const t5 = node('triggers.world_event', '觉醒触发', 50, 990, { match_type: 'tick' });
  const c5 = node('conditions.check_stat', '体力>50', 300, 990, { stat_key: '体力值', op: '>', threshold: 50 });
  const e5 = node('actions.add_event', '异能觉醒', 550, 990, { event_id: 'awakening' });
  nodes.push(t5, c5, e5);
  conns.push(conn(t5, c5), conn(c5, e5));

  // === 事件：掠夺者伏击（血量>60）===
  const t6 = node('triggers.world_event', '伏击触发', 50, 1110, { match_type: 'tick' });
  const c6 = node('conditions.check_stat', '血量>60', 300, 1110, { stat_key: 'attrA', op: '>', threshold: 60 });
  const e6 = node('actions.add_event', '掠夺者伏击', 550, 1110, { event_id: 'raider_ambush' });
  nodes.push(t6, c6, e6);
  conns.push(conn(t6, c6), conn(c6, e6));

  // === 事件：商队遭遇（体力>40）===
  const t7 = node('triggers.world_event', '商队触发', 50, 1230, { match_type: 'tick' });
  const c7 = node('conditions.check_stat', '体力>40', 300, 1230, { stat_key: '体力值', op: '>', threshold: 40 });
  const e7 = node('actions.add_event', '商队遭遇', 550, 1230, { event_id: 'trader_encounter' });
  nodes.push(t7, c7, e7);
  conns.push(conn(t7, c7), conn(c7, e7));

  return makeWorkflow('wf-wasteland', '余烬废土', nodes, conns);
}

// ═══════════════════════════════════════════════════════════
//  6. 孤岛求生
// ═══════════════════════════════════════════════════════════
export function strandedIslandWorkflow(): WorkflowDefinition {
  resetId();
  const nodes: NodeInstance[] = [];
  const conns: WorkflowConnection[] = [];

  // === 周期：每日消耗（每轮水-1食物-1）===
  const p1 = node('triggers.periodic', '每日消耗', 50, 50, { interval: 1, description: '每天消耗淡水和食物' });
  const a1a = node('actions.modify_resource', '水-1', 300, 30, { resource_key: 'water', delta: -1 });
  const a1b = node('actions.modify_resource', '食物-1', 300, 90, { resource_key: 'food', delta: -1 });
  nodes.push(p1, a1a, a1b);
  conns.push(conn(p1, a1a), conn(p1, a1b));

  // === 周期：潮汐补给（每轮偏移1，食物+1）===
  const p2 = node('triggers.periodic', '潮汐补给', 50, 180, { interval: 1, offset: 1, description: '潮汐带来食物' });
  const a2 = node('actions.modify_resource', '食物+1', 300, 180, { resource_key: 'food', delta: 1 });
  nodes.push(p2, a2);
  conns.push(conn(p2, a2));

  // === 周期：风雨侵蚀（每5轮木材-1）===
  const p3 = node('triggers.periodic', '风雨侵蚀', 50, 280, { interval: 5, description: '风雨侵蚀损耗木材' });
  const a3 = node('actions.modify_resource', '木材-1', 300, 280, { resource_key: 'wood', delta: -1 });
  nodes.push(p3, a3);
  conns.push(conn(p3, a3));

  // === 周期：天气变化（每7轮AI叙事）===
  const p4 = node('triggers.periodic', '天气变化', 50, 380, { interval: 7, offset: 3, description: '天气变化', narrate: true });
  nodes.push(p4);

  // === 周期：资源采集（每3轮食物+1水+1）===
  const p5 = node('triggers.periodic', '资源采集', 50, 480, { interval: 3, offset: 1, description: '自动采集基础资源' });
  const a5a = node('actions.modify_resource', '食物+1', 300, 460, { resource_key: 'food', delta: 1 });
  const a5b = node('actions.modify_resource', '水+1', 300, 510, { resource_key: 'water', delta: 1 });
  nodes.push(p5, a5a, a5b);
  conns.push(conn(p5, a5a), conn(p5, a5b));

  // === 事件：受伤（血量<40）===
  const t1 = node('triggers.world_event', '受伤触发', 50, 610, { match_type: 'tick' });
  const c1 = node('conditions.check_stat', '血量<40', 300, 610, { stat_key: 'attrA', op: '<', threshold: 40 });
  const e1 = node('actions.add_event', '受伤', 550, 610, { event_id: 'injury' });
  nodes.push(t1, c1, e1);
  conns.push(conn(t1, c1), conn(c1, e1));

  // === 事件：淡水告急（水<=2）===
  const t2 = node('triggers.world_event', '淡水告急触发', 50, 730, { match_type: 'tick' });
  const c2 = node('conditions.check_resource', '水<=2', 300, 730, { resource_key: 'water', op: '<=', threshold: 2 });
  const e2 = node('actions.add_event', '淡水告急', 550, 730, { event_id: 'water_crisis' });
  nodes.push(t2, c2, e2);
  conns.push(conn(t2, c2), conn(c2, e2));

  // === 事件：野兽出没（食物>5）===
  const t3 = node('triggers.world_event', '野兽触发', 50, 850, { match_type: 'tick' });
  const c3 = node('conditions.check_resource', '食物>5', 300, 850, { resource_key: 'food', op: '>', threshold: 5 });
  const e3 = node('actions.add_event', '野兽出没', 550, 850, { event_id: 'wild_animal' });
  nodes.push(t3, c3, e3);
  conns.push(conn(t3, c3), conn(c3, e3));

  // === 事件：救援信号（血量>80）===
  const t4 = node('triggers.world_event', '救援触发', 50, 970, { match_type: 'tick' });
  const c4 = node('conditions.check_stat', '血量>80', 300, 970, { stat_key: 'attrA', op: '>', threshold: 80 });
  const e4 = node('actions.add_event', '救援信号', 550, 970, { event_id: 'rescue_signal' });
  nodes.push(t4, c4, e4);
  conns.push(conn(t4, c4), conn(c4, e4));

  // === 事件：探索发现（体力>50）===
  const t5 = node('triggers.world_event', '探索触发', 50, 1090, { match_type: 'tick' });
  const c5 = node('conditions.check_stat', '体力>50', 300, 1090, { stat_key: '体力值', op: '>', threshold: 50 });
  const e5 = node('actions.add_event', '探索发现', 550, 1090, { event_id: 'exploration' });
  nodes.push(t5, c5, e5);
  conns.push(conn(t5, c5), conn(c5, e5));

  // === 事件：营地冲突（血量<60）===
  const t6 = node('triggers.world_event', '冲突触发', 50, 1210, { match_type: 'tick' });
  const c6 = node('conditions.check_stat', '血量<60', 300, 1210, { stat_key: 'attrA', op: '<', threshold: 60 });
  const e6 = node('actions.add_event', '营地冲突', 550, 1210, { event_id: 'conflict' });
  nodes.push(t6, c6, e6);
  conns.push(conn(t6, c6), conn(c6, e6));

  return makeWorkflow('wf-stranded', '孤岛求生', nodes, conns);
}

// ═══════════════════════════════════════════════════════════
//  导出所有世界工作流
// ═══════════════════════════════════════════════════════════
export const WORLD_WORKFLOWS: Record<string, () => WorkflowDefinition> = {
  wuxia_world: wuxiaWorldWorkflow,
  desire_metropolis: desireMetropolisWorkflow,
  border_trade: borderTradeWorkflow,
  japanese_school: japaneseSchoolWorkflow,
  wasteland_apocalypse: wastelandWorkflow,
  stranded_island: strandedIslandWorkflow,
};
