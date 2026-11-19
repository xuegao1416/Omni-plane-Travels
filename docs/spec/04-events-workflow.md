> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（4、事件与工作流系统）。
> 总索引见仓库根目录的 `PROJECT_FUNCTIONAL_SPEC.md`（相对本文件为 `../../PROJECT_FUNCTIONAL_SPEC.md`）。

## 4、事件与工作流系统

### 4.1 卡片工作流引擎 — `src/modules/cardWorkflowEngine.ts`

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
  dynamicConfig?: DynamicChoiceConfig;                    // AI动态选项配置（结构见 src/modules/schema.ts:1298）
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
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;
    if (elapsed > limits.maxWallMs) {
      warnings.push(`工作流执行超时（${Math.round(elapsed)}ms > ${limits.maxWallMs}ms）`);
      aborted = true; break;
    }
    
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
    if (result.outputs) { outputCache.set(nodeId, result.outputs); }
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
  
  return { renderData, choices: choices ?? [], pendingEffects: pendingEffects.flat(), executedNodeIds, warnings, aborted, dynamicConfig };
}
```

---

### 4.2 卡片节点执行器 — `src/modules/cardNodeExecutors.ts`

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
// 契约形态（与 src/modules/schema.ts:1533 的 CardNodeExecutionResult.dynamicConfig 一致）：空 choices + 顶层 dynamicConfig，由 CardOverlay 层调 AI 生成
{
  choices: [],
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
  outputs: { flow_out: true },
}
```

⚠ **与代码实际行为不符（已知缺陷，记录在此以免误读）**：类型声明（`src/modules/schema.ts:1533`）与引擎（`src/modules/cardWorkflowEngine.ts:104/196-198/231`）都按**顶层** `result.dynamicConfig` 读写，但 `choice.dynamic` 执行器（`src/modules/cardNodeExecutors.ts:143-164`）把它塞进了 `outputs.dynamicConfig`。两条通道不一致，因此 `executeCardWorkflow` 返回的 `dynamicConfig` 恒为 `undefined`，`CardOverlay.tsx:59` 的动态选项分支实际不会进入，`fallbackChoices` 也取不到。上面的结构是**类型契约**；修复应改执行器（把 `dynamicConfig` 提到返回值顶层），而不是改这里的契约。

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
    aiNote: opt.aiNote as string | undefined,
    effect: opt.effect as { statId?: string; resourcePath?: string; delta: number } | undefined,
    ...(opt.action ? { action: opt.action as NarrativeDecisionAction } : {}),
    weight: opt.weight,   // 权重已在 weighted 映射里归一化为 Number(opt.weight ?? 1)
  })),
  outputs: { flow_out: true },
}
// 选取逻辑：先对每个选项补 weight: Number(opt.weight ?? 1)，再按 weight 降序取前 showCount(默认 3) 个（非随机，是确定性排序）
```

#### 效果节点（3种）

**effect.stat**:

```typescript
const statKey = String(w.statKey ?? inputs.statKey ?? '');
const delta = Number(w.delta ?? inputs.delta ?? inputs.delta_in ?? 0);
{
  pendingEffects: statKey ? [{ statId: statKey, delta }] : [],
  outputs: { flow_out: true },
}
// statKey: 规范化属性键 attrA(生命) / attrB(能量) / dim1-dim6，见 src/modules/canonicalStats.ts:17-26
// delta: 正数增加，负数减少；优先级 widget → inputs.delta → inputs.delta_in → 0
```

**effect.resource**:

```typescript
const resourceKey = String(w.resourceKey ?? inputs.resourceKey ?? '');
const delta = Number(w.delta ?? inputs.delta ?? inputs.delta_in ?? 0);
{
  pendingEffects: resourceKey ? [{ resourcePath: resourceKey, delta }] : [],
  outputs: { flow_out: true },
}
// resourceKey: "金币" / "木材" 等
```

**effect.flag**:

```typescript
const flagPath = String(w.flagPath ?? inputs.flagPath ?? '');
const value = w.value ?? inputs.value ?? true;
{
  pendingEffects: flagPath ? [{ flagPath, value }] : [],
  outputs: { flow_out: true },
}
// flagPath: "玩家.状态.已触发事件A"
// value: widget → inputs.value → 默认 true
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

### 4.3 DAG 工作流引擎 — `src/modules/workflowEngine.ts`

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

### 4.4 规则引擎 — `src/modules/ruleEngine.ts`

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
export function evalCondition(
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
  
  // state / event 条件 → 委托 gameplay kernel，是两条各自计步的独立分支
  if ('state' in cond) {
    stepRef.steps++;
    return evaluateGameplayCondition(cond, ctx as GameplayStateRoot, events.map(e => ({
      type: e.type,
      payload: e.where,
    })));
  }
  if ('event' in cond) {
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
  const warnings: string[] = [];
  const applied: AppliedAction[] = [];   // 实际实现以此累积
  const start = nowMs();
  const stepRef: StepRef = { steps: 0, aborted: false };

  // 上限：每 mod ≤ maxRulesPerMod（默认 128），超限先告警再截断
  if (rulesIn.length > limits.maxRulesPerMod) {
    warnings.push(`规则数 ${rulesIn.length} 超过上限 ${limits.maxRulesPerMod}，截断至前 ${limits.maxRulesPerMod} 条`);
  }
  const rules = rulesIn.slice(0, limits.maxRulesPerMod);
  // 上限：每 tick 求值集 ≤ maxEvalSet（默认 1024），超限告警（已含上一条截断，此处二次防御）
  if (rules.length > limits.maxEvalSet) {
    warnings.push(`求值集 ${rules.length} 超过上限 ${limits.maxEvalSet}，截断`);
  }

  // 冷却递减（确定性，由tick驱动）
  for (const k of Object.keys(runtime.cooldownRemaining)) {
    if (runtime.cooldownRemaining[k] > 0) runtime.cooldownRemaining[k] -= 1;
  }

  // 过滤活跃规则
  const active = rules
    .filter(r => !(r.once && runtime.onceFired[r.id]))
    .filter(r => (runtime.cooldownRemaining[r.id] ?? 0) <= 0)
    .filter(r => evalCondition(r.when, ctx, events, 1, limits, stepRef))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));  // 高优先级先执行

  // 遍历执行
  for (const rule of active) {
    if (stepRef.aborted) break;

    const then = rule.then ?? [];
    if (then.length > limits.maxActionsPerRule) {
      warnings.push(`规则 ${rule.id} 动作数 ${then.length} 超过上限 ${limits.maxActionsPerRule}，截断`);
    }
    const actions = then.slice(0, limits.maxActionsPerRule);

    for (const action of actions) {
      if (stepRef.aborted) break;
      if (stepRef.steps >= limits.maxStepsPerTick) { stepRef.aborted = true; break; }

      // 动作校验
      const kind = actionKindOf(action);
      if (!kind) { warnings.push(`规则 ${rule.id} 含无法识别的动作，已拒绝`); continue; }
      if (!ACTION_KINDS.includes(kind)) { warnings.push(`规则 ${rule.id} 动作 ${kind} 不在白名单，跳过`); continue; }
      if (!options.permissions.includes(ACTION_PERMISSION[kind])) { warnings.push(`规则 ${rule.id} 缺少权限 ${ACTION_PERMISSION[kind]}，跳过动作 ${kind}`); continue; }

      // 执行（单条规则异常隔离）
      try {
        applyAction(action, ctx, applied, rule.id);
        stepRef.steps++;
      } catch (e) {
        warnings.push(`规则 ${rule.id} 动作 ${kind} 执行失败，已隔离: ${e.message}`);
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

  // 提取scheduleTick条目（不改 applyAction 签名，保持纯函数）
  const scheduledTickEntries: Array<{ scheduledAt: number; ruleId: string; payload?: Record<string, unknown> }> = [];
  for (const a of applied) {
    if (a.kind === 'scheduleTick') {
      const detail = a.detail as { after: number; payload?: Record<string, unknown> };
      scheduledTickEntries.push({ scheduledAt: options.tick + detail.after, ruleId: a.ruleId, payload: detail.payload });
    }
  }

  const aborted = stepRef.aborted || nowMs() - start > limits.maxWallMs;
  return {
    ctx, applied, warnings, aborted,
    reason: aborted ? '超过步数 / 墙钟上限，本次求值中止并告警' : undefined,
    scheduledTickEntries,
  };
}
```

---

### 4.5 模块 Schema — `src/modules/schema.ts`

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
  inputs: string[];  formula?: 'sum' | 'average' | 'min' | 'max' | 'ratio';
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
  scarce: boolean;
  gatherRate?: string; usage?: string;
  gatherAmount?: number; gatherTimeMinutes?: number; gatherStaminaCost?: number;
  description: string;
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
  description: string;
  resources: SurvivalResource[];
  recipes?: SurvivalRecipe[];
  rules: {
    cycleName: string;
    consumePerCycle: string;
    criticalThreshold: number;
  };
  consumption?: {
    perCycle: Record<string, number>;
    exhaustionPenalty?: Record<string, number>;
  };
  statuses?: Array<{
    id: string; name: string; description?: string;
    durationTicks?: number; statEffects?: GameplayEffect[];
  }>;
  resourceEvolution?: ResourceEvolutionStep[];
  [key: string]: unknown;
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
  description?: string; homepage?: string | null;
  engine: 'opt-event';
  schemaVersion: number;
  minAppVersion: string;
  type: 'card' | 'rule' | 'worldbook' | 'bundle';
  coverColor: string; icon: string;
  enabledByDefault?: boolean; loadOrder?: number;
  dependencies?: string[]; conflicts?: string[];
  permissions?: Permission[];
  rules?: string[]; cards?: string[];
  assets?: { path: string; kind: AssetKind; size: number }[];
  checksum?: { manifest: string; assets: Record<string, string> };
  signature?: string | null;
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
  searchTags?: string[];  // 供 searchCardNodes 检索
}

interface CardExecutionContext {
  tick: number;
  events: Array<{ type: string; [key: string]: unknown }>;
  permissions: string[];
  gameState: Record<string, unknown>;
  limits?: { maxNodes?: number; maxWallMs?: number };
}

interface CardNodeExecutionResult {
  renderData?: {
    type: 'title' | 'text' | 'image' | 'dialog';
    title?: string; text?: string; imageUrl?: string;
    npcName?: string; npcEmotion?: string;
  };
  choices?: Array<{
    label: string;
    aiNote?: string;
    effect?: { statId?: string; resourcePath?: string; delta: number };
    action?: { type: string; [key: string]: unknown };
    conditionPath?: string;
    conditionValue?: unknown;
    weight?: number;
  }>;
  pendingEffects?: Array<{ statId?: string; resourcePath?: string; flagPath?: string; delta?: number; value?: unknown }>;
  branchTarget?: string;
  outputs?: Record<string, unknown>;
  dynamicConfig?: DynamicChoiceConfig;
}
```

---

### 4.6 卡片节点生态

| 文件                                      | 职责                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------- |
| `src/modules/cardNodeRegistry.ts`       | **节点类型定义表**（`CardNodeDefinition` 元数据：socket / widget / 图标 / 配色 / `searchTags`），导出 `registerCardNode:13`、`getCardNodeDefinition:17`、`getAllCardNodeDefinitions:21`、`validateCardConnection:49`；执行器在另一文件 |
| `src/modules/cardNodeExecutors.ts`      | **执行器映射表** `const executors = new Map<string, CardNodeExecutor>()`（`:17`），导出 `registerCardNodeExecutor(typeId, executor)`（`:19`）与 `getCardNodeExecutor`（`:23`），内置 12 种节点实现 |
| `src/modules/dynamicChoiceGenerator.ts` | `choice.dynamic` 节点的 AI 异步生成逻辑,接收 `dynamicConfig` 调用 API 产出实际 `choices[]` |
| `src/modules/workflowBridge.ts`         | 把 **DAG 工作流**包装成规则引擎的 `EvaluateResult`（`executeWorkflowAsEvaluation:28`），供 `eventIntegration.evaluateTick` 走同一条 tick 结算通道；与卡片工作流无关 |
| `src/modules/workflowConverters.ts`     | 三方格式互转：`EventGraph`(规则编辑器图, `eventGraphToWorkflow:32` / `workflowToEventGraph:129`)、`RuleFile`(`schema/rules.json` 落盘形态, `ruleFileToWorkflow:244` / `workflowToRuleFile:329`)、`WorkflowDefinition`；不处理 ReactFlow 原始 JSON |
| `src/modules/cardWorldBindings.ts`      | 把世界内联的 `cardWorkflows` 安装成 builtin 卡片事件包（`installWorldCardWorkflows(worldDef):14`，packId 为 `world-card-${world.id}-${entry.id}`，幂等写 IndexedDB，`type:'card'`、`builtin:true`），并提供 `hasWorldCardWorkflows(worldId):67` 判定 |

**注册方式（函数式，不是 Map 实例方法）**:

```typescript
// src/modules/cardNodeExecutors.ts:17-23
const executors = new Map<string, CardNodeExecutor>();

export function registerCardNodeExecutor(typeId: string, executor: CardNodeExecutor): void {
  executors.set(typeId, executor);
}
export function getCardNodeExecutor(typeId: string): CardNodeExecutor | undefined {
  return executors.get(typeId);
}

// 内置节点在文件内注册，例：
registerCardNodeExecutor('narrative.text', narrativeTextExecutor);
// 自定义模块从外部注册新节点：
registerCardNodeExecutor('custom.x', customExecutor);
```

### 4.7 事件运行时生态

事件包加载、激活、调度、执行、持久化的完整链路:

| 文件                                                                | 职责                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------- |
| `src/modules/eventActivation.ts`                                  | 事件包**全局**启用态判定 `isEventActive(entryEnabled):1-9`；事件包启用/禁用是全局操作（`rec.enabled`），**已无存档级二级开关** |
| `src/modules/eventApi.ts`                                         | 事件包**管理面 API**（Tauri invoke 桥，`call<T>:56`）：`discoverPacks:100`/`listPacks:105`/`validateEvent:114`/`installPack:123`/`uninstallPack:134`/`enablePack:144`/`disablePack:154`/`importPack:165`/`exportPack:183`/`getEventDetail:192`/`getRuntimePack:199` + 合集 CRUD `:221-253`；**不含 `emit`/`subscribe`/`tick`** |
| `src/modules/eventRuntime.ts`                                     | 仅「按世界筛选可运行时事件包」`selectRuntimePacksForWorld(packs, worldId):1-13`；真正的 tick 结算在 `eventIntegration.ts` 的 `eventWorldEvolution.evaluateTick` |
| `src/modules/eventIntegration.ts`                                 | 规则求值 / DAG 工作流与游戏 tick 的集成点：`evaluateTick:91-144`（`if (pack.workflow) executeWorkflowAsEvaluation(...) else evaluate(...)`）、`collectAddEventEvents:156`、`collectCombatEncounterRequests:173`、`collectScheduledTickEntries:184`、`runEventRulesOnTick:204`；**不涉及卡片工作流** |
| `src/modules/eventDb.ts`                                          | 事件状态持久化(IndexedDB)：`putWebEvent:60`、`getWebEvent:68`、`allWebEvents:79` 等 |
| `src/modules/eventErrors.ts`                                      | 统一错误码与构造/归一化工具（`EventApiErrorCode:6-9`、`EventApiError:18`、`ensureEventApiError:34`）；**不承担捕获与降级**，按包异常隔离实际在 `eventIntegration.ts:130-134` |
| `src/modules/eventChoiceState.ts`                                 | 「待结算选项」的模块级 Map（按 save 维度）：`PendingChoice:15-33`、`selectChoice:40`、`getPendingForSave:45`、`clearPendingForSave:54`、`resolvePendingChoices:147` → `applyEffectTarget:133`；**没有「禁用/超时」状态机** |
| `src/modules/eventPackFormat.ts`                                  | canonical v2 事件包读取 + v1 indexed pack→v2 的直接迁移边界                    |
| `src/modules/webEventStore.ts`                                   | Web 端事件存储、导入导出、运行时包读取与启用清单持久化                |
| `src/modules/manifestSchema.ts`                                   | 事件包 manifest schema(`id/name/version/permissions/type`) |

**事件触发链**（真实实现）:

```
事件来源（AI 响应 / 周期规则 / 按钮 / 定时）
  ↓
getRuntimePack / readCanonicalEventPack — 读取 canonical v2 事件包
  ↓
eventRuntime.selectRuntimePacksForWorld(packs, worldId) — 按世界过滤
  ↓
分支一：CardOverlay → executeCardWorkflow(workflow, ctx)        （卡片工作流，见 §4.1）
分支二：eventWorldEvolution.evaluateTick → executeWorkflowAsEvaluation / evaluate
                                                                （DAG 工作流 / 规则包，见 §4.3）
  ↓
结果持久化：eventDb.putWebEvent / saveStore
```

#### 4.7.1 事件生态核心文件

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
| `src/modules/playerDecisionLog.ts` | 记录最近 8 条玩家决策的 **aiNote 文本 + 回合号 + 时间戳**（`PlayerDecision { note; round; at }`），供 `getPlayerDecisionContext()` 注入下一轮提示词；不记录选项 id / 来源 / 效果 |
| `src/modules/playTracker.ts`       | **需用户同意的匿名游玩统计**：会话活跃时长 + 到达的最深页面 + 是否回访 + 浏览器/屏幕/时区；不含回合数、死亡次数或重大事件 |

**`playerDecisionLog` 结构**（`src/modules/playerDecisionLog.ts:5-9`）:

```typescript
interface PlayerDecision {
  note: string;    // 取自选项的 aiNote
  round: number;
  at: number;      // 时间戳
}
// MAX_RECENT = 8（:11）；recordPlayerDecision(note: string, round = 0)（:15）
```

`playTracker.ts` 相关类型：`PlayDepth = 'home' | 'lobby' | 'events' | 'wizard' | 'game'`(`:8`)、`PlayTrackingConsent = 'granted' | 'denied' | null`(`:9`)、`PlaySession { id; startedAt; endedAt; activeDurationMs; maxDepth; isReturn }`(`:23-30`)、`initPlayTracker()`(`:203`)。

### 4.9 构建/标准/默认

| 文件                               | 职责                                |
| -------------------------------- | --------------------------------- |
| `src/modules/buildPipeline.ts`   | **世界创建**的多步生成管线（头注释：主题提取 → 顺序生成 → 世界书生成 → 合成验证），导出 `executeBuildPipeline(ctx: BuildContext, config: PipelineConfig): Promise<BuildContext>`(`:53`)；与事件包运行时实例化无关 |
| `src/modules/buildContext.ts`    | 世界构建管线使用的上下文**数据类型**集合（`StatConfig:10`/`StatState:25`/`StatBonuses:38`/`ProgressionConfig:50` 等），不含注册表或权限模型 |
| `src/modules/canonicalStats.ts`  | 规范化属性选项表：`FIXED_OPTIONS`(`:17-26`) = `attrA`「生命」/ `attrB`「能量」/ `dim1`–`dim6` 六维语义标签；`getCanonicalStatOptions():31`、`getStatOptionsFromState():38`、`CUSTOM_STAT_SENTINEL='__custom_stat__':50`。键名不是「血量/体力值」 |
| `src/modules/defaults.ts`        | 各模块默认值(无配置时的兜底)                   |
| `src/modules/normalizeModule.ts` | 只做轻量标准化：`normalizeModule:16`/`normalizeModules:27` 补默认值（progression 交给 `xpAlgorithm.normalizeProgressionConfig`），`normalizeSpecial:38` 处理特色属性；**无版本兼容迁移或字段合并** |

### 4.10 工作流 Schema 与节点系统

| 文件                              | 职责                                                                    |
| ------------------------------- | --------------------------------------------------------------------- |
| `src/modules/workflowSchema.ts` | DAG 工作流 schema 定义(`WorkflowDefinition`/`NodeDefinition`/`Connection`)；`SocketType` 10 种(`:9-19`)、配色 `SOCKET_COLORS`(`:22-33`) |
| `src/modules/workflowConverters.ts` | 当前 `WorkflowDefinition` 与规则执行表示之间的显式转换层                                  |
| `src/modules/nodeExecutors.ts`  | DAG 工作流节点执行器集合(与 §4.6 卡片节点区分)                                         |
| `src/modules/nodeRegistry.ts`   | DAG 节点注册表：共 **36 种**节点（triggers 4：`triggers.world_event`/`periodic`/`manual`/`choice_made`；conditions 10：`compare`/`check_resource`/`check_stat`/`and`/`or`/`not`/`check_flag`/`check_inventory`/`check_npc`/`event_match`；actions 10：`set_value`/`modify_resource`/`modify_stat`/`add_event`/`request_combat`/`schedule_tick`/`modify_inventory`/`modify_currency`/`modify_npc`/`add_notebook`；data 6：`get_value`/`get_resource`/`get_stat`/`constant`/`math`/`get_random`；flow 3：`branch`/`gate`/`reroute`；output 3：`show_card`/`narrate_hint`/`end_workflow`） |
| `src/modules/autoLayout.ts`     | 工作流画布自动布局，使用 **dagre**（`:6 import dagre from 'dagre'`、`computeAutoLayout(nodes, edges, getTypeId?):87`、`:107-113` `setGraph({ rankdir:'LR', ranksep:300, nodesep: maxNodeHeight*0.5+50, marginx:80, marginy:80 })`）；未使用 ELK |

### 4.11 经验与世界工作流

| 文件                              | 职责                                                          |
| ------------------------------- | ----------------------------------------------------------- |
| `src/modules/xpAlgorithm.ts`    | 经验值计算(`xpFormula`: `baseXP * level^exponent * scaleFactor`) |
| `src/modules/worldWorkflows.ts` | `worldId → 工作流工厂`（`WORLD_WORKFLOWS: Record<string, WorldWorkflowFactory>:62`）：`WORLD_NAMES` 仅列 6 个内置世界(`:9-16`)，`createWorldWorkflow(worldId):19-60` 按需生成「`triggers.periodic` → `actions.add_event`」两节点工作流；不是每世界预挂独立工作流集合 |
| `src/modules/runtime.ts`        | 两个投影辅助函数：`extractWorldSystemData(worldSystem):14` 汇总世界系统数据、`getProgressionDisplay(progression):33` 生成成长体系展示数据；**不存在模块运行时容器，也不供 `engineBridge` 使用** |

---

