> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（4、事件与工作流系统）。
> 总索引见 `../PROJECT_FUNCTIONAL_SPEC.md`。

## 4、事件与工作流系统

### 4.1 卡片工作流引擎 — `src/modules/cardWorkflowEngine.ts` (233行)

**文件路径**: `src/modules/cardWorkflowEngine.ts`

**CardWorkflowExecutionResult**:

```typescript
interface CardWorkflowExecutionResult {
  renderData: CardNodeExecutionResult['renderData'][];  // 叙事节点输出数组
  choices: CardNodeExecutionResult['choices'];          // 交互节点输出（取最后一个）
  pendingEffects: CardNodeExecutionResult['pendingEffects']; // 待应用效果
  executedNodeIds: string[];                             // 按执行顺序的节点ID列表
  warnings: string[];                                     // 警告信息
  aborted: boolean;                                       // 是否因超限中止
  dynamicConfig?: Record<string, unknown>;                // AI动态选项配置
}
```

**executeCardWorkflow 主流程**:

```typescript
export function executeCardWorkflow(
  workflow: CardWorkflowDefinition,
  ctx: CardExecutionContext,
): CardWorkflowExecutionResult {
  
  // 1. 初始化
  const outputCache = new Map<string, Record<string, unknown>>();
  const executed = new Set<string>();
  const queue: Array<{ nodeId: string }> = [];
  
  // 2. 查找入口节点
  const entries = findEntryNodes(workflow.nodes, workflow.connections);
  for (const entry of entries) {
    queue.push({ nodeId: entry.id });
  }
  
  // 3. BFS主循环
  while (queue.length > 0) {
    // 超限检查
    if (executed.size >= limits.maxNodes) { aborted = true; break; }
    if (Date.now() - startTime > limits.maxWallMs) { aborted = true; break; }
    
    const { nodeId } = queue.shift();
    if (executed.has(nodeId)) continue;
    
    // 收集输入
    const inputs = collectInputs(node, workflow.connections, outputCache);
    
    // 执行节点
    const executor = getCardNodeExecutor(node.typeId);
    const result = executor(node, ctx, inputs);
    
    // 记录结果
    executed.add(nodeId);
    executedNodeIds.push(nodeId);
    outputCache.set(nodeId, result.outputs);
    if (result.renderData) renderData.push(result.renderData);
    if (result.choices) choices = result.choices;
    if (result.pendingEffects) pendingEffects.push(...result.pendingEffects);
    
    // 后继节点入队
    if (result.branchTarget) {
      // 分支节点：只沿指定分支继续
      const successors = findSuccessors(nodeId, result.branchTarget, workflow.connections);
      for (const s of successors) {
        if (!executed.has(s.nodeId)) queue.push({ nodeId: s.nodeId });
      }
    } else {
      // 普通节点：所有flow类型的输出socket对应的后继入队
      for (const output of def.outputs) {
        if (output.type === 'flow') {
          const successors = findSuccessors(nodeId, output.key, workflow.connections);
          for (const s of successors) {
            if (!executed.has(s.nodeId)) queue.push({ nodeId: s.nodeId });
          }
        }
      }
    }
  }
  
  return { renderData, choices, pendingEffects, executedNodeIds, warnings, aborted, dynamicConfig };
}
```

---

### 4.2 卡片节点执行器 — `src/modules/cardNodeExecutors.ts` (291行)

**文件路径**: `src/modules/cardNodeExecutors.ts`

**12种节点类型详解**:

#### 叙事节点（4种）

**narrative.title**:

```typescript
{
  renderData: { type: 'title', title: String(w.title ?? inputs.title ?? '') },
  outputs: { flow_out: true },
}
```

**narrative.text**:

```typescript
{
  renderData: { type: 'text', text: String(w.text ?? inputs.text ?? '') },
  outputs: { flow_out: true },
}
```

**narrative.image**:

```typescript
{
  renderData: {
    type: 'image',
    imageUrl: String(w.imageUrl ?? inputs.imageUrl ?? ''),
    text: String(w.caption ?? inputs.caption ?? ''),
  },
  outputs: { flow_out: true },
}
```

**narrative.dialog**:

```typescript
{
  renderData: {
    type: 'dialog',
    npcName: String(w.npcName ?? inputs.npcName ?? ''),
    text: String(w.dialogText ?? inputs.dialogText ?? ''),
    npcEmotion: String(w.emotion ?? inputs.emotion ?? 'neutral'),
  },
  outputs: { flow_out: true },
}
```

#### 交互节点（4种）

**choice.static**:

```typescript
// 直接透传options，无运行时处理
{
  choices: options,  // w.options 或 inputs.options（支持JSON字符串或数组）
  outputs: { flow_out: true },
}
```

**choice.dynamic** — 核心设计:

```typescript
// 返回空choices + dynamicConfig，由CardOverlay层AI生成
{
  choices: [],
  outputs: { flow_out: true },
  dynamicConfig: {
    instruction: String(w.instruction ?? inputs.instruction ?? ''),
    countRange: [Number(w.minCount ?? inputs.minCount ?? 2), Number(w.maxCount ?? inputs.maxCount ?? 4)],
    optionTemplate: {
      effectRequired: Boolean(w.effectRequired ?? inputs.effectRequired ?? false),
      aiNoteRequired: w.aiNoteRequired !== false,
    },
    fallbackChoices: (() => {
      const raw = w.fallback ?? inputs.fallback;
      if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return []; } }
      return Array.isArray(raw) ? raw : [];
    })(),
  },
}
```

**choice.conditional** — 运行时过滤:

```typescript
// 对每个选项检查conditionPath，对应gameState中的值
{
  choices: filtered.map(opt => ({
    label: String(opt.label ?? ''),
    aiNote: opt.aiNote as string | undefined,
    effect: opt.effect as { statId?: string; resourcePath?: string; delta: number } | undefined,
    ...(opt.action ? { action: opt.action as NarrativeDecisionAction } : {}),
  })),
  outputs: { flow_out: true },
}
// 过滤逻辑：
// for opt in options:
//   if opt.conditionPath:
//     actual = getPath(ctx.gameState, opt.conditionPath)
//     if !compareValues(opt.conditionOp ?? '!=', actual, opt.conditionValue ?? false): skip
```

**choice.weighted** — 按权重选取:

```typescript
// 默认显示3个选项，按权重降序排序
{
  choices: selected.map(opt => ({
    label: String(opt.label ?? ''),
    aiNote: String(opt.aiNote ?? ''),
    effect: opt.effect,
    action: opt.action as NarrativeDecisionAction,
    weight: Number(opt.weight ?? 1),
  })),
  outputs: { flow_out: true },
}
// 选取逻辑：按weight降序，取前showCount个（非随机，是确定性排序）
```

#### 效果节点（3种）

**effect.stat**:

```typescript
{
  pendingEffects: statKey ? [{ statId: statKey, delta: Number(delta) }] : [],
  outputs: { flow_out: true },
}
// statKey: "血量" / "体力值" / "dim1" 等
// delta: 正数增加，负数减少
```

**effect.resource**:

```typescript
{
  pendingEffects: resourceKey ? [{ resourcePath: resourceKey, delta: Number(delta) }] : [],
  outputs: { flow_out: true },
}
// resourceKey: "金币" / "木材" 等
```

**effect.flag**:

```typescript
{
  pendingEffects: flagPath ? [{ flagPath, value: w.value ?? true }] : [],
  outputs: { flow_out: true },
}
// flagPath: "玩家.状态.已触发事件A"
// value: 默认true
```

#### 流程节点（1种）

**flow.branch**:

```typescript
{
  branchTarget: result ? 'true_out' : 'false_out',
  outputs: {
    condition: result,
    [result ? 'true_out' : 'false_out']: true,
  },
}
// checkPath: 游戏状态路径
// op: 比较操作符 '==' | '!=' | '>' | '<' | '>=' | '<='
// compareValue: 期望值
// result: compareValues(op, getPath(ctx.gameState, checkPath), compareValue)
```

---

### 4.3 DAG 工作流引擎 — `src/modules/workflowEngine.ts` (258行)

**文件路径**: `src/modules/workflowEngine.ts`

**Kahn算法拓扑排序**:

```typescript
// 构建邻接表
const adj = new Map<string, Array<{ target: string; sourceSocket: string; targetSocket: string }>>();
const revAdj = new Map<string, Array<{ source: string; sourceSocket: string; targetSocket: string }>>();

// 计算入度
const inDegree = new Map<string, number>();
for (const node of workflow.nodes) {
  inDegree.set(node.id, (revAdj.get(node.id) ?? []).length);
}

// 入度为0的节点入队
const queue: string[] = [];
for (const [id, deg] of inDegree) {
  if (deg === 0) queue.push(id);
}

// Kahn算法主循环
const sorted: string[] = [];
while (queue.length > 0) {
  const id = queue.shift()!;
  sorted.push(id);
  for (const edge of adj.get(id) ?? []) {
    const deg = inDegree.get(edge.target)! - 1;
    inDegree.set(edge.target, deg);
    if (deg === 0) queue.push(edge.target);
  }
}

// 环检测
if (sorted.length !== workflow.nodes.length) {
  return failResult('检测到循环依赖，工作流无法执行');
}
```

**Connected flow sockets门控**:

```typescript
// 如果一个flow类型输入未连接（inputs中没有true），则跳过该节点执行
const connectedFlowInputs = def.inputs.filter(inputDef =>
  inputDef.type === 'flow'
  && (revAdj.get(nodeId) ?? []).some(edge => edge.targetSocket === inputDef.key)
);

if (connectedFlowInputs.some(inputDef => inputs[inputDef.key] !== true)) {
  // 输出flow全置false，不执行节点
  const outputs: Record<string, unknown> = {};
  for (const outputDef of def.outputs) {
    if (outputDef.type === 'flow') outputs[outputDef.key] = false;
  }
  nodeOutputs.set(nodeId, outputs);
  continue;
}
```

---

> **逐字节核对(2026-09-08)**:实际导出函数名是 `executeWorkflow`(不是 `workflowEngine.execute()`)。`workflowEngine.ts` 实际 258 行(差 1)。
>   
> 文档原描述的 `workflowEngine.execute()` 应理解为模块名+方法名。

### 4.4 规则引擎 — `src/modules/ruleEngine.ts` (325行)

**文件路径**: `src/modules/ruleEngine.ts`

**白名单动作**:

```typescript
const ACTION_KINDS: ActionKind[] = [
  'set',
  'addEvent',
  'requestCombat',
  'modifyResource',
  'scheduleTick',
];

const ACTION_PERMISSION: Record<ActionKind, Permission> = {
  set: 'modify_world_state',
  addEvent: 'add_card',
  requestCombat: 'emit_world_event',
  modifyResource: 'modify_world_state',
  scheduleTick: 'register_tick',
};
```

**条件求值**:

```typescript
function evalCondition(
  cond: Condition,
  ctx: WorldContext,
  events: Array<{ type: string; where?: Record<string, Literal> }>,
  depth: number,
  limits: EvaluateLimits,
  stepRef: StepRef,
): boolean {
  // 深度/步数超限检查
  if (depth > limits.maxConditionDepth) { stepRef.aborted = true; return false; }
  if (stepRef.steps >= limits.maxStepsPerTick) { stepRef.aborted = true; return false; }
  
  // 布尔逻辑
  if ('all' in cond) {
    stepRef.steps++;
    return cond.all.every(c => evalCondition(c, ctx, events, depth + 1, limits, stepRef));
  }
  if ('any' in cond) {
    stepRef.steps++;
    return cond.any.some(c => evalCondition(c, ctx, events, depth + 1, limits, stepRef));
  }
  if ('not' in cond) {
    stepRef.steps++;
    return !evalCondition(cond.not, ctx, events, depth + 1, limits, stepRef);
  }
  
  // state/event条件 → 委托gameplay kernel
  if ('state' in cond || 'event' in cond) {
    stepRef.steps++;
    return evaluateGameplayCondition(cond, ctx as GameplayStateRoot, events.map(e => ({
      type: e.type,
      payload: e.where,
    })));
  }
  
  return false;
}
```

**evaluate主流程**:

```typescript
export function evaluate(
  ctxIn: WorldContext,
  rulesIn: EventRule[],
  options: EvaluateOptions,
): EvaluateResult {
  const ctx = clone(ctxIn);  // 克隆，不污染原状态
  const runtime = options.runtime ?? { onceFired: {}, cooldownRemaining: {} };
  
  // 冷却递减（确定性，由tick驱动）
  for (const k of Object.keys(runtime.cooldownRemaining)) {
    if (runtime.cooldownRemaining[k] > 0) runtime.cooldownRemaining[k] -= 1;
  }
  
  // 过滤活跃规则
  const active = rulesIn
    .filter(r => !(r.once && runtime.onceFired[r.id]))
    .filter(r => (runtime.cooldownRemaining[r.id] ?? 0) <= 0)
    .filter(r => evalCondition(r.when, ctx, events, 1, limits, stepRef))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));  // 高优先级先执行
  
  // 遍历执行
  for (const rule of active) {
    if (stepRef.aborted) break;
    
    const actions = rule.then?.slice(0, limits.maxActionsPerRule) ?? [];
    
    for (const action of actions) {
      if (stepRef.aborted) break;
      
      // 动作校验
      const kind = actionKindOf(action);
      if (!kind) { warnings.push(...); continue; }
      if (!ACTION_KINDS.includes(kind)) { warnings.push(...); continue; }
      if (!options.permissions.includes(ACTION_PERMISSION[kind])) { warnings.push(...); continue; }
      
      // 执行（异常隔离）
      try {
        applyAction(action, ctx, applied, rule.id);
        stepRef.steps++;
      } catch (e) {
        warnings.push(`规则 ${rule.id} 动作执行失败: ${e.message}`);
      }
    }
    
    // 更新运行时状态
    if (rule.once) runtime.onceFired[rule.id] = true;
    if (rule.cooldownTicks && rule.cooldownTicks > 0) {
      runtime.cooldownRemaining[rule.id] = rule.cooldownTicks;
    }
    
    // 墙钟检查
    if (nowMs() - start > limits.maxWallMs) stepRef.aborted = true;
  }
  
  // 提取scheduleTick条目
  const scheduledTickEntries = applied
    .filter(a => a.kind === 'scheduleTick')
    .map(a => ({
      scheduledAt: options.tick + (a.detail as { after: number }).after,
      ruleId: a.ruleId,
      payload: (a.detail as { payload?: Record<string, unknown> }).payload,
    }));
  
  return { ctx, applied, warnings, aborted: stepRef.aborted, scheduledTickEntries };
}
```

---

### 4.5 模块 Schema — `src/modules/schema.ts` (1572行)

**文件路径**: `src/modules/schema.ts`

**完整类型分类**:

#### 数值属性模块

```typescript
interface SixDimStat {
  name: string;
  value: number;
  range: [number, number];
  semanticRole?: 'power' | 'guard' | 'agility' | 'intellect' | 'social' | 'perception';
  description?: string;
}

interface SpecialStat {
  id: string; name: string; value: number;
  range: [number, number]; description: string;
}

interface StatModifierDefinition {
  id: string;
  statId: string; delta: number;
  mode?: 'flat' | 'percent';
  source?: string;
  durationTicks?: number;
  permanent?: boolean;
}

interface DerivedStatDefinition {
  id: string; name: string;
  inputs: string[];  formula: 'sum' | 'average' | 'min' | 'max' | 'ratio';
  scale?: number; offset?: number; min?: number; max?: number;
}

interface StatModuleSchema {
  pointScale?: number;
  attrA: { name: string; current: number; max: number; };
  attrB: { name: string; current: number; max: number; };
  dim1?: SixDimStat; dim2?: SixDimStat; dim3?: SixDimStat;
  dim4?: SixDimStat; dim5?: SixDimStat; dim6?: SixDimStat;
  special: SpecialStat[];
  derived?: DerivedStatDefinition[];
  modifiers?: StatModifierDefinition[];
}
```

#### 成长体系模块

```typescript
interface TierDef {
  name: string; description: string;
  xpRequired: number;
  statBonuses: StatBonuses;
}

interface LevelData {
  maxLevel: number;
  baseStats: StatBonuses;
  growthPerLevel: StatBonuses;
}

interface XpFormula {
  baseXP: number; exponent: number; scaleFactor: number;
}

interface ProgressionConfig {
  mode: 'tiered' | 'level';
  xpFormula: XpFormula;
  tiers?: TierDef[];
  levelData?: LevelData;
  pointsPerTier?: { attribute?: number; talent?: number; skill?: number };
  breakthroughs?: Array<{
    tierIndex: number;
    conditions?: GameplayCondition[];
    costs?: GameplayCost[];
    rewards?: GameplayEffect[];
    description?: string;
  }>;
}
```

#### 生存资源模块

```typescript
interface SurvivalResource {
  id: string; name: string; symbol: string;
  amount: number; max: number;
  scarce?: boolean;
  gatherRate?: string; usage?: string;
  gatherAmount?: number; gatherTimeMinutes?: number; gatherStaminaCost?: number;
  description?: string;
}

interface SurvivalRecipe {
  id: string; name: string; description: string;
  inputs: Record<string, number>;
  output: { resourceId: string; amount: number };
  craftTimeMinutes?: number;
  unlockConditions?: GameplayCondition[]; unlockCost?: GameplayCost[];
}

interface ResourceEvolutionStep {
  id: string;
  trigger: { keywords: string[]; };
  afterRounds?: number;
  add?: SurvivalResource[];
  remove?: string[];
  narrateHint?: string;
}

interface SurvivalModuleSchema {
  description?: string;
  resources: SurvivalResource[];
  recipes?: SurvivalRecipe[];
  consumption?: {
    perCycle: Record<string, number>;
    exhaustionPenalty?: Record<string, number>;
  };
  resourceEvolution?: ResourceEvolutionStep[];
}
```

#### 事件包系统

```typescript
type Permission =
  | 'read_world_state' | 'modify_world_state' | 'add_card'
  | 'override_card' | 'register_tick' | 'emit_world_event'
  | 'provide_assets';

interface EventRule {
  id: string;
  priority?: number;
  once?: boolean;
  cooldownTicks?: number;
  when: Condition;   // { all: [...] } | { any: [...] } | { not: {...} } | { state: {...} } | { event: {...} }
  then: Action[];   // [{ set: {...} }] | [{ addEvent: {...} }] | [{ modifyResource: {...} }] | [{ scheduleTick: {...} }]
}

interface PeriodicRule {
  id: string; name?: string;
  intervalTicks: number; offsetTicks?: number;
  when?: Condition;
  actions?: Action[];
  description?: string;
  narrateToAI?: boolean;
}

interface Manifest {
  id: string; name: string; version: string; author: string;
  engine: 'opt-event';
  schemaVersion: number;
  minAppVersion: string;
  type: 'card' | 'rule' | 'worldbook' | 'bundle';
  permissions?: Permission[];
  rules?: string[];
  worldId?: string;  // 空则全局可见
}

interface EventRegistryEntry {
  meta: EventMeta;
  enabled: boolean;
  status: 'installed' | 'enabled' | 'disabled';
  registeredAt: string;
  lastEnabledAt?: string | null;
  builtin?: boolean;
}
```

#### 卡片节点系统

```typescript
type CardNodeType =
  | 'narrative.title' | 'narrative.text' | 'narrative.image' | 'narrative.dialog'
  | 'choice.static' | 'choice.dynamic' | 'choice.conditional' | 'choice.weighted'
  | 'effect.stat' | 'effect.resource' | 'effect.flag'
  | 'flow.branch';

type CardSocketType = 'flow' | 'number' | 'string' | 'boolean' | 'stat' | 'resource' | 'flag' | 'any';

interface CardNodeDefinition {
  typeId: CardNodeType;
  category: 'narrative' | 'choice' | 'effect' | 'flow';
  name: string; description: string;
  icon: string; color: string;
  inputs: CardNodeSocket[];
  outputs: CardNodeSocket[];
  widgets?: CardWidgetConfig[];
  terminal?: boolean;  // 是否终端节点
  source?: boolean;    // 是否源节点
}

interface CardExecutionContext {
  tick: number;
  events: Array<{ type: string; [key: string]: unknown }>;
  permissions: string[];
  gameState: Record<string, unknown>;
  limits?: { maxNodes?: number; maxWallMs?: number };
}

interface CardNodeExecutionResult {
  renderData?: { type: 'title' | 'text' | 'image' | 'dialog'; [key: string]: unknown };
  choices?: ChoiceOption[];
  pendingEffects?: Array<{ statId?: string; resourcePath?: string; flagPath?: string; delta?: number; value?: unknown }>;
  branchTarget?: string;
  outputs?: Record<string, unknown>;
  dynamicConfig?: Record<string, unknown>;
}
```

---

### 4.6 卡片节点生态

| 文件                                      | 职责                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------- |
| `src/modules/cardNodeRegistry.ts`       | 节点类型 → 执行器映射表(`Map<CardNodeType, CardNodeExecutor>`),支持运行时扩展(自定义模块注册新节点)  |
| `src/modules/dynamicChoiceGenerator.ts` | `choice.dynamic` 节点的 AI 异步生成逻辑,接收 `dynamicConfig` 调用 API 产出实际 `choices[]` |
| `src/modules/workflowBridge.ts`         | 卡片工作流与 DAG 工作流之间的桥接(允许卡片事件触发 DAG 节点)                                      |
| `src/modules/workflowConverters.ts`     | 工作流格式转换(ReactFlow JSON ↔ 内部 `WorkflowDefinition`)                         |
| `src/modules/cardWorldBindings.ts`      | 卡片与世界配置的绑定关系(每世界注册专属卡片模板)                                                 |

**注册表模式**:

```typescript
const registry = new Map<CardNodeType, CardNodeExecutor>();
registry.set('narrative.text', narrativeTextExecutor);
registry.set('choice.static', choiceStaticExecutor);
// 自定义模块可调用:registry.register('custom.x', customExecutor);
```

### 4.7 事件运行时生态

事件包加载、激活、调度、执行、持久化的完整链路:

| 文件                                                                | 职责                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------- |
| `src/modules/eventActivation.ts`                                  | 二级开关(`sessionActivePacks > global enabledIds`)激活过滤      |
| `src/modules/eventApi.ts`                                         | 事件包暴露给工作流/引擎的 API 表面(emit/subscribe/tick)               |
| `src/modules/eventRuntime.ts`                                     | 事件循环调度(tick 触发 → evaluate → apply)                      |
| `src/modules/eventIntegration.ts`                                 | 与 §6 模拟引擎、`§4.3` 工作流、`§4.1` 卡片工作流的集成点                   |
| `src/modules/eventDb.ts`                                          | 事件状态持久化(IndexedDB)                                      |
| `src/modules/eventErrors.ts`                                      | 错误捕获与降级(失败时不影响主线程)                                      |
| `src/modules/eventChoiceState.ts`                                 | 事件选项的状态机(已选/禁用/超时)                                      |
| `src/modules/eventPackFormat.ts`                                  | canonical v2 事件包读取 + v1 indexed pack→v2 的直接迁移边界                    |
| `src/modules/webEventStore.ts`                                   | Web 端事件存储、导入导出、运行时包读取与启用清单持久化                |
| `src/modules/manifestSchema.ts`                                   | 事件包 manifest schema(`id/name/version/permissions/type`) |

**事件触发链**:

```
事件来源(AI 响应/周期规则/按钮/定时)
  ↓
eventActivation.filter(activePacks, enabledIds)
  ↓
eventRuntime.schedule(event)
  ↓
eventIntegration.bridge() → 卡片 / DAG 工作流 / 模拟引擎
  ↓
executeCardWorkflow() / executeWorkflow() / simEngine.settleMechanics()
  ↓
eventDb.persist(state)
```

#### 4.7.1 事件生态核心文件(漏列补充)

| 文件 | 职责 |
|---|---|
| `src/modules/webEventStore.ts`   | 浏览器事件存储层（IndexedDB-backed 事件表） |
| `src/modules/eventPackFormat.ts` | 事件包 canonical v2 读取、v1 直迁、输入限制与一致性校验              |


#### 4.7.2 Canonical 格式与兼容窗口

- 当前卡片事件索引固定为 `schema/events.json` version 2；每个事件对应 `schema/event-<id>.json`。
- 导入层只保留 version 1 的 indexed pack → version 2。
- 更早的“只有 `schema/card.json`、没有 `schema/events.json`”单卡包已退出兼容窗口；当前导入会明确拒绝。
- `readCanonicalEventPack()` 等运行时消费者只读取 v2，不做历史格式猜测。
- 内置世界事件在 `worlds.json` 中直接保存可执行 canonical 数据，不再依赖安装时修复坏 `options` JSON 或中文 statKey。
- v1 的 `manifest.cards` 只允许在导入边界出现；导入成功后会从持久化 manifest 移除。详情页卡片摘要直接从 canonical `schema/events.json` 派生，不再双读 manifest。
- `schema/workflow.json` 与 `schema/rules.json` 是当前编辑器表示与当前规则执行器表示，两者通过 `workflowConverters.ts` 显式转换；这不是跨代历史 schema 兼容。

### 4.8 玩家决策与游玩追踪

| 文件                                 | 职责                                |
| ---------------------------------- | --------------------------------- |
| `src/modules/playerDecisionLog.ts` | 玩家决策历史(选项点击 + 时间 + 影响)记录,用于后续叙事回顾 |
| `src/modules/playTracker.ts`       | 游玩统计(回合数/会话时长/死亡次数/重大事件)          |

**`playerDecisionLog` 结构**:

```typescript
interface PlayerDecisionEntry {
  round: number;
  decisionId: string;          // narrativeDecision.id
  source: 'option' | 'free-input' | 'system';
  choice: string;
  effects?: { statId?: string; delta?: number; flagPath?: string; value?: unknown };
  timestamp: number;
}
```

### 4.9 构建/标准/默认

| 文件                               | 职责                                |
| -------------------------------- | --------------------------------- |
| `src/modules/buildPipeline.ts`   | 事件包 → 模块运行时实例的构建管线                |
| `src/modules/buildContext.ts`    | 构建上下文(注册表 + 权限 + 配置)              |
| `src/modules/canonicalStats.ts`  | 标准统计量定义(`血量`/`体力值`/`dim1-6`)的统一引用 |
| `src/modules/defaults.ts`        | 各模块默认值(无配置时的兜底)                   |
| `src/modules/normalizeModule.ts` | 模块数据标准化(版本兼容/字段合并)                |

### 4.10 工作流 Schema 与节点系统

| 文件                              | 职责                                                                    |
| ------------------------------- | --------------------------------------------------------------------- |
| `src/modules/workflowSchema.ts` | DAG 工作流 schema 定义(`WorkflowDefinition`/`NodeDefinition`/`Connection`) |
| `src/modules/workflowConverters.ts` | 当前 `WorkflowDefinition` 与规则执行表示之间的显式转换层                                  |
| `src/modules/nodeExecutors.ts`  | DAG 工作流节点执行器集合(与 §4.6 卡片节点区分)                                         |
| `src/modules/nodeRegistry.ts`   | DAG 节点注册表                                                             |
| `src/modules/autoLayout.ts`     | 工作流画布自动布局算法(Sugiyama/ELK)                                             |

### 4.11 经验与世界工作流

| 文件                              | 职责                                                          |
| ------------------------------- | ----------------------------------------------------------- |
| `src/modules/xpAlgorithm.ts`    | 经验值计算(`xpFormula`: `baseXP * level^exponent * scaleFactor`) |
| `src/modules/worldWorkflows.ts` | 世界级工作流注册表(每世界挂载独立工作流集合)                                     |
| `src/modules/runtime.ts`        | 模块运行时容器(汇总所有子系统 + 提供给 engineBridge 访问)                      |

---

