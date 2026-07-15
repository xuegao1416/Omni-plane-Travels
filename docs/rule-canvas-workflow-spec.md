# 规则画布工作流规范 v1.0

> 解决核心问题：节点之间有"工作"但没有"流"。本规范定义节点如何连接、条件如何参与、以及图如何转换为 EventRule DSL。

---

## 1. 节点角色分类

| 角色 | 节点类型 | 出度 | 入度 | 在 EventRule 中的归属 |
|------|---------|------|------|----------------------|
| **源** | `trigger`, `periodic` | ≥0 | 0 | 产出一条 EventRule 或 PeriodicRule 的起点 |
| **门** | `condition` | ≥1 | ≥1 | 构建 `when: Condition` 树 |
| **汇** | `effect`, `event`, `worldState` | 0 | ≥1 | 构建 `then: Action[]` 或独立产物 |
| **约束** | `guardrail` | 0 | 0 | 不参与流，仅通过 constraint 边约束 effect |
| **特殊** | `periodic`（带条件链） | ≥1 | 0 | 产出带 `when` 守卫的 PeriodicRule |

---

## 2. 连接规则（什么能连什么）

### 2.1 合法连接矩阵

```
源 \ 目    condition  effect  event  worldState  guardrail  trigger  periodic
trigger       ✅        ✅      ✅       ✅          ❌        ❌       ❌
condition     ✅        ✅      ✅       ✅          ❌        ❌       ❌
periodic      ✅        ✅      ✅       ✅          ❌        ❌       ❌
effect        ❌        ❌      ❌       ❌          ❌        ❌       ❌
event         ❌        ❌      ❌       ❌          ❌        ❌       ❌
worldState    ❌        ❌      ❌       ❌          ❌        ❌       ❌
guardrail     ❌  (constraint边→effect) ❌       ❌          ❌        ❌       ❌
```

### 2.2 一句话规则

1. **trigger/periodic/condition → condition/effect/event/worldState**：合法的 flow 边。
2. **effect/event/worldState → 任何节点**：非法。汇节点无出度，它们是终点。
3. **trigger → trigger / periodic → periodic**：非法。源节点不能串联。
4. **guardrail → effect**：合法，但必须是 `constraint` 边（虚线），不是 `flow` 边。
5. **guardrail → 非 effect 节点**：非法。护栏只约束效果。
6. **trigger 直连 effect**：合法。跳过条件 = 无条件触发（`when: { all: [] }`，恒真）。

---

## 3. Condition 节点的多输入语义

### 3.1 问题

一个 condition 节点有 3 条入边，这代表 AND 还是 OR？

### 3.2 解决方案：`logicMode` 字段

在 `EventGraphNode` 上新增：

```typescript
// condition 节点专属
logicMode?: 'and' | 'or' | 'not';  // 默认 'and'
```

- **`and`（默认）**：所有入边对应的条件必须同时满足。3 条入边 → `{ all: [cond1, cond2, cond3] }`。
- **`or`**：任一入边条件满足即可。3 条入边 → `{ any: [cond1, cond2, cond3] }`。
- **`not`**：仅允许 1 条入边，翻转其条件。多入边报校验错误。

### 3.3 UI 体现

- condition 节点卡片上显示逻辑模式标签：`AND` / `OR` / `NOT`。
- 用户在属性面板中切换模式（下拉选择）。
- `NOT` 模式下，如果入边 > 1，校验报错 `CONDITION_NOT_MULTI_INPUT`。

### 3.4 condition 节点自身的 `when` 字段

condition 节点可以同时持有自己的条件（`state` 或 `event` 类型）。此时：

- 入边条件 **先** 组合（按 logicMode），**再** 与节点自身的 `when` 做 AND。
- 即：`{ all: [自身when, 按logicMode组合的入边条件] }`。
- 如果节点无 `when` 字段，则只使用入边组合结果。

### 3.5 条件树的组装算法

```
buildCondition(nodeId, visited):
  node = getNode(nodeId)
  incomingEdges = getIncomingFlowEdges(nodeId)

  if node.kind == 'condition':
    // 收集所有上游入边的条件
    upstreamConditions = incomingEdges.map(e => buildCondition(e.source, visited))

    // 按 logicMode 组合
    if node.logicMode == 'or':
      combined = { any: upstreamConditions }
    elif node.logicMode == 'not':
      combined = { not: upstreamConditions[0] }  // 校验保证只有1条
    else:  // 'and' 或默认
      combined = { all: upstreamConditions }

    // 如果节点自身有条件，与之 AND
    if node.when:
      return { all: [node.when, combined] }
    else:
      return combined

  elif node.kind in ['trigger', 'periodic']:
    return node.when ?? { all: [] }  // 源节点的 when 字段

  else:
    return { all: [] }  // effect/event/worldState 不产出条件
```

---

## 4. 从图"流"出一条 EventRule

### 4.1 转换算法（替换现有 `graphToRuleFile`）

```
graphToRuleFile(graph):

  rules = []
  periodicRules = []

  for each node in graph.nodes:
    if node.kind == 'trigger':
      // 1. 从 trigger 出发，BFS 找所有可达的 condition 和 effect/event/worldState 节点
      reachable = bfsFrom(node.id, flowEdgesOnly)

      // 2. 找到所有直接或间接连接的 effect 节点
      effectNodes = reachable.filter(n => n.kind == 'effect')

      // 3. 找到 trigger 与 effect 之间的所有 condition 节点
      conditionNodes = reachable.filter(n => n.kind == 'condition')

      // 4. 构建 when 条件树
      when = buildTriggerWhen(node, conditionNodes, graph)

      // 5. 收集 then 动作
      then = effectNodes.flatMap(n => n.actions ?? [])

      // 6. 收集 event/worldState 节点的动作
      eventNodes = reachable.filter(n => n.kind == 'event')
      worldStateNodes = reachable.filter(n => n.kind == 'worldState')
      then.push(...eventNodes.map(n => ({ emit: n.event })))
      then.push(...worldStateNodes.flatMap(n => worldStateToActions(n)))

      rules.push({ id: node.id, when, then, ...metadata })

    elif node.kind == 'periodic':
      // 周期节点：检查是否连接了 condition 链
      reachable = bfsFrom(node.id, flowEdgesOnly)
      conditionNodes = reachable.filter(n => n.kind == 'condition')
      effectNodes = reachable.filter(n => n.kind == 'effect')

      if conditionNodes.length > 0:
        // 有条件链 → 产出带 when 守卫的 PeriodicRule
        when = buildConditionFromGraph(conditionNodes, graph)
        effects = collectModuleEffects(effectNodes)
        periodicRules.push({ id, intervalTicks, offsetTicks, when, effects, ... })
      else:
        // 无条件链 → 纯周期（保持现有行为）
        periodicRules.push({ id, intervalTicks, offsetTicks, effects: node.effects, ... })

  return { version: 1, rules, periodicRules }
```

### 4.2 `buildTriggerWhen` 算法

```
buildTriggerWhen(triggerNode, conditionNodes, graph):
  triggerWhen = triggerNode.when ?? { all: [] }

  if conditionNodes.length == 0:
    return triggerWhen  // 无条件节点，直接用 trigger 的 when

  // 找到离 trigger 最近的 condition 节点（直接后继）
  directConditions = conditionNodes.filter(c =>
    hasEdge(triggerNode.id, c.id, graph))

  if directConditions.length == 1:
    // 单路径：trigger → cond1 → ... → effect
    condWhen = buildCondition(directConditions[0].id, graph)
    return { all: [triggerWhen, condWhen] }

  elif directConditions.length > 1:
    // 多路径（trigger 直接连多个 condition）：隐式 AND
    condWhens = directConditions.map(c => buildCondition(c.id, graph))
    return { all: [triggerWhen, ...condWhens] }

  else:
    // condition 不直接连 trigger（中间隔了其他节点），按 BFS 最近路径处理
    nearestConditions = findNearestConditions(triggerNode.id, conditionNodes, graph)
    condWhens = nearestConditions.map(c => buildCondition(c.id, graph))
    return { all: [triggerWhen, ...condWhens] }
```

### 4.3 转换示例

**图结构**：
```
trigger(dice_roll) → condition(hp<50, mode=and) → condition(has_key, mode=and) → effect(addCard)
```

**产出 EventRule**：
```json
{
  "id": "trigger-xxx",
  "when": {
    "all": [
      { "event": { "type": "dice_roll" } },
      { "all": [
        { "state": { "path": "attrA.current", "op": "<", "value": 50 } },
        { "state": { "path": "flags.has_key", "op": "==", "value": true } }
      ]}
    ]
  },
  "then": [{ "addCard": { "cardId": "adventure" } }]
}
```

---

## 5. Validation 规则

### 5.1 非法连接（ERROR）

| 规则 | 严重度 | code | 说明 |
|------|--------|------|------|
| 汇节点有出边 | ERROR | `SINK_HAS_OUT` | effect/event/worldState 不应有任何出边 |
| 源节点有入边 | ERROR | `SOURCE_HAS_IN` | trigger/periodic 不应有任何 flow 入边 |
| guardrail 连非 effect | ERROR | `GUARDRAIL_INVALID_TARGET` | 护栏只能约束 effect |
| effect 连 trigger | ERROR | `INVALID_EDGE` | 汇→源无意义 |
| NOT condition 入边 > 1 | ERROR | `CONDITION_NOT_MULTI_INPUT` | NOT 门只接受 1 条入边 |
| 自环 | ERROR | `SELF_LOOP` | 任何节点连自己 |
| 多 SCC 环 | ERROR | `CYCLE` | 触发环（已有） |

### 5.2 警告（WARNING）

| 规则 | 严重度 | code | 说明 |
|------|--------|------|------|
| effect 无上游 | WARNING | `ISOLATED_EFFECT` | 效果节点无上游触发器（已有） |
| trigger 直连 effect（无 condition） | INFO | `DIRECT_TRIGGER_EFFECT` | 合法但提示：无条件触发 |
| condition 节点无入边 | WARNING | `CONDITION_NO_INPUT` | 条件门没有输入，条件为空 |
| condition 节点无出边 | WARNING | `CONDITION_NO_OUTPUT` | 条件门没有下游，不起作用 |
| periodic 直连 effect（无 condition） | INFO | `DIRECT_PERIODIC_EFFECT` | 合法但提示：周期无条件 |
| trigger 的 when 为空 | INFO | `EMPTY_TRIGGER_WHEN` | 触发器无自身条件，完全依赖 condition 节点 |

### 5.3 校验增强（在现有 `validateRuleGraph` 基础上新增）

```typescript
// 新增校验项
function validateWorkflow(graph: EventGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const node of graph.nodes) {
    const inEdges = graph.edges.filter(e => e.target === node.id && e.kind !== 'constraint');
    const outEdges = graph.edges.filter(e => e.source === node.id && e.kind !== 'constraint');

    // 汇节点不应有出边
    if (['effect', 'event', 'worldState'].includes(node.kind) && outEdges.length > 0) {
      issues.push({ code: 'SINK_HAS_OUT', nodeId: node.id, ... });
    }

    // 源节点不应有入边
    if (['trigger', 'periodic'].includes(node.kind) && inEdges.length > 0) {
      issues.push({ code: 'SOURCE_HAS_IN', nodeId: node.id, ... });
    }

    // NOT condition 只能有 1 条入边
    if (node.kind === 'condition' && node.logicMode === 'not' && inEdges.length > 1) {
      issues.push({ code: 'CONDITION_NOT_MULTI_INPUT', nodeId: node.id, ... });
    }

    // condition 节点无入边
    if (node.kind === 'condition' && inEdges.length === 0) {
      issues.push({ code: 'CONDITION_NO_INPUT', nodeId: node.id, ... });
    }

    // condition 节点无出边
    if (node.kind === 'condition' && outEdges.length === 0) {
      issues.push({ code: 'CONDITION_NO_OUTPUT', nodeId: node.id, ... });
    }
  }

  // guardrail 只能连 effect
  for (const e of graph.edges.filter(e => e.kind === 'constraint')) {
    const target = graph.nodes.find(n => n.id === e.target);
    if (target && target.kind !== 'effect') {
      issues.push({ code: 'GUARDRAIL_INVALID_TARGET', ... });
    }
  }

  return issues;
}
```

---

## 6. Periodic 节点接入工作流

### 6.1 现状

Periodic 节点只能独立产出 `PeriodicRule`（无 `when` 字段），无法连接 condition→effect 链。

### 6.2 方案：扩展 PeriodicRule

```typescript
// schema.ts 修改
export interface PeriodicRule {
  id: string;
  name?: string;
  intervalTicks: number;
  offsetTicks?: number;
  when?: Condition;       // ← 新增：可选守卫条件
  effects: ModuleEffects;
  actions?: Action[];     // ← 新增：可选动作序列（与 effects 平行）
  description?: string;
  narrateToAI?: boolean;
}
```

- `when`：每 N tick 触发时，先检查 `when` 条件，满足才执行 effects/actions。
- `actions`：当 periodic 连接到 effect 节点时，effect 节点的 actions 写入此处。

### 6.3 转换逻辑

- **periodic 单独（无连线）**：保持现有行为，产出 `PeriodicRule { effects }`。
- **periodic → condition → effect**：产出 `PeriodicRule { when: 条件树, actions: 效果动作 }`。
- **periodic → effect（直连）**：产出 `PeriodicRule { actions: 效果动作 }`（无 when，每 N tick 无条件执行）。

---

## 7. 典型工作流示例

### 示例 1：骰子检定 + 条件门 → 触发奇遇

**场景**：骰子检定失败（d20 ≤ 5）且生命值低于 50% 时，触发一张奇遇卡。

```
[trigger: 骰子检定] --flow--> [condition: AND]
  when: { event: { type: 'dice_roll', where: { result: 'fail' } } }
                                  |
                                  +--flow--> [condition: AND] (自身 when: { state: { path: 'attrA.current', op: '<', value: 50 } })
                                                |
                                                +--flow--> [effect: 触发奇遇卡]
                                                             actions: [{ addCard: { cardId: 'adventure' } }]
```

**产出 EventRule**：
```json
{
  "id": "trigger-dice",
  "when": {
    "all": [
      { "event": { "type": "dice_roll", "where": { "result": "fail" } } },
      { "state": { "path": "attrA.current", "op": "<", "value": 50 } }
    ]
  },
  "then": [{ "addCard": { "cardId": "adventure" } }]
}
```

### 示例 2：OR 条件门 — 多触发源汇聚

**场景**：收到"暴风雪"事件 **或** "地震"事件时，减少 2 点食物。

```
[trigger: 暴风雪] --flow--> [condition: OR]
  when: { event: { type: 'blizzard' } }          |
                                    +--flow--> [effect: 减少食物]
[trigger: 地震] --flow------/                      actions: [{ modifyResource: { key: 'food', delta: -2 } }]
  when: { event: { type: 'earthquake' } }
```

**产出 EventRules**（两条，因为有两个 trigger）：

触发器 1（暴风雪）：
```json
{
  "id": "trigger-blizzard",
  "when": { "event": { "type": "blizzard" } },
  "then": [{ "modifyResource": { "key": "food", "delta": -2 } }]
}
```

触发器 2（地震）：
```json
{
  "id": "trigger-earthquake",
  "when": { "event": { "type": "earthquake" } },
  "then": [{ "modifyResource": { "key": "food", "delta": -2 } }]
}
```

> 注：OR 门在多 trigger 场景下，每个 trigger 独立产出一条规则（因为 trigger 是源，OR 门的语义被分解到各 trigger 的 when 中）。OR 门真正发挥作用是在**单 trigger 多 condition 输入**的场景（如 trigger 后接多个 state 检查，任一满足即可）。

### 示例 3：周期触发 + 条件守卫

**场景**：每 10 轮检查一次，如果食物 < 3，自动扣除 1 点生命。

```
[periodic: 每10轮] --flow--> [condition: AND]
  intervalTicks: 10                |
                    +--flow--> [effect: 饥饿惩罚]
                                 actions: [{ modifyResource: { key: 'hp', delta: -1 } }]
                                 该 condition 节点自身 when: { state: { path: 'resources.food.amount', op: '<', value: 3 } }
```

**产出 PeriodicRule**：
```json
{
  "id": "periodic-hunger",
  "name": "饥饿检查",
  "intervalTicks": 10,
  "when": { "state": { "path": "resources.food.amount", "op": "<", "value": 3 } },
  "actions": [{ "modifyResource": { "key": "hp", "delta": -1 } }]
}
```

### 示例 4：NOT 条件门 — 反转

**场景**：玩家**没有**钥匙时，尝试开门会触发陷阱卡。

```
[trigger: 开门] --flow--> [condition: NOT]
  when: { event: { type: 'open_door' } }   |
                               +--flow--> [effect: 触发陷阱]
                                            actions: [{ addCard: { cardId: 'trap' } }]
                               该 NOT 节点的入边来源是 condition: { state: { path: 'flags.has_key', op: '==', value: true } }
```

**产出 EventRule**：
```json
{
  "id": "trigger-door",
  "when": {
    "all": [
      { "event": { "type": "open_door" } },
      { "not": { "state": { "path": "flags.has_key", "op": "==", "value": true } } }
    ]
  },
  "then": [{ "addCard": { "cardId": "trap" } }]
}
```

---

## 8. Schema 变更清单

```typescript
// 1. EventGraphNode 新增字段
interface EventGraphNode {
  // ... 现有字段 ...
  /** condition 节点的逻辑模式（默认 'and'） */
  logicMode?: 'and' | 'or' | 'not';
}

// 2. PeriodicRule 扩展
interface PeriodicRule {
  // ... 现有字段 ...
  /** 可选守卫条件（每 N tick 触发时先检查） */
  when?: Condition;
  /** 可选动作序列（当 periodic 连接到 effect 节点时使用） */
  actions?: Action[];
}

// 3. EventEdgeKind 扩展
type EventEdgeKind = 'flow' | 'constraint';  // 保持不变，constraint 仅 guardrail→effect
```

---

## 9. 实施优先级（RICE）

| 改动 | Reach | Impact | Confidence | Effort | 优先级 |
|------|-------|--------|------------|--------|--------|
| condition 节点 logicMode + 多输入语义 | 高 | 高 | 高 | 中 | **P0** |
| graphToRuleFile 重写（condition 参与 when 构建） | 高 | 高 | 高 | 中 | **P0** |
| 连接规则校验（validateRuleGraph 增强） | 高 | 中 | 高 | 低 | **P0** |
| PeriodicRule 扩展 when/actions | 中 | 高 | 高 | 低 | **P1** |
| periodic → condition → effect 转换 | 中 | 高 | 中 | 中 | **P1** |
| UI 连接合法性即时反馈（拖拽时灰显非法目标） | 中 | 中 | 高 | 中 | **P2** |
| condition 节点卡片显示逻辑模式标签 | 低 | 低 | 高 | 低 | **P2** |

---

## 10. 边界条件

| 场景 | 处理方式 |
|------|---------|
| trigger 无 when 且无 condition 连线 | `when: { all: [] }`（恒真），校验报 INFO `EMPTY_TRIGGER_WHEN` |
| condition 节点无 when 且无入边 | 校验报 WARNING `CONDITION_NO_INPUT`，转换时产出 `{ all: [] }` |
| condition 链深度 > 6 | 校验报 ERROR `CONDITION_DEPTH_EXCEEDED`，与 ruleEngine 的 maxConditionDepth 对齐 |
| periodic 同时有 effects 字段和连线 | 连线产出的 actions/effects **覆盖**节点自身的 effects（连线优先） |
| 多个 trigger 连同一个 condition 链 | 每个 trigger 独立产出一条 EventRule，condition 链被复制到各规则的 when 中 |
| guardrail 用 flow 边而非 constraint 边 | 校验报 ERROR `GUARDRAIL_MUST_USE_CONSTRAINT` |
| effect 节点有出边 | 校验报 ERROR `SINK_HAS_OUT` |
