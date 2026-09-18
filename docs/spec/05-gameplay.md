> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（5、游戏玩法内核 — `src/gameplay/`）。
> 总索引见 `../PROJECT_FUNCTIONAL_SPEC.md`。

## 5、游戏玩法内核 — `src/gameplay/`

玩法/战斗/技能/职业/叙事决策的统一抽象层,与引擎解耦,通过 `engineBridge` 接入 `§1 核心引擎`。

### 5.1 内核与类型

| 文件                       | 职责                                               |
| ------------------------ | ------------------------------------------------ |
| `src/gameplay/kernel.ts` | 玩法内核主入口(条件求值/状态机/事件分发)                           |
| `src/gameplay/types.ts`  | `GameplayStateRoot` / `Condition` / `Action` 等类型 |

**`kernel.ts` 提供**(均为实际导出符号;无 `applyGameplayAction` / `registerGameplayModule`):

- `evaluateGameplayCondition(condition, state, events)` — §4.4 规则引擎委托的核心条件求值
- `executeGameplayTransaction(state, transaction)` — 玩法事务执行(含条件校验)
- `createGameplayStateDiff(...)` / `removeGameplayPath(...)` / `getGameplayPath(...)` / `setGameplayPath(...)` — 状态差异与路径读写
- `compareGameplayValues(op, left, right)` — 值比较
- `advanceGameplayEvents(...)` / `consumeGameplayEvents(...)` / `revertGameplayTransaction(...)` — 事件推进/消费/回滚
- `GAMEPLAY_SCHEMA_VERSION`(=1)常量

### 5.2 战斗系统

当前生产战斗链只有一套：

```text
GameState.v3.combatSession
  ↓
combatRuntime.ts
  ↓
combatV2.ts + combatMath.ts + combatRulesets.ts
  ↓
combatViewModel.ts / CombatWireframe
  ↓
combatNarrativeBoundary.ts 返回正文
```

| 文件 | 职责 |
| --- | --- |
| `src/gameplay/combatV2.ts` | `CombatSessionV2` 状态机、指令解析、结算、回滚与存档恢复 |
| `src/gameplay/combatRuntime.ts` | V3 游戏状态与战斗会话的运行时桥接 |
| `src/gameplay/combatMath.ts` | 当前系统共用的纯战斗数学公式 |
| `src/gameplay/combatRulesets.ts` | 回合制 / 即时制 / 混合规则集 |
| `src/gameplay/combatNarrativeBoundary.ts` | 战斗与正文叙事的边界 |
| `src/gameplay/combatViewModel.ts` | 战斗状态 → UI 视图模型 |

旧 `combat.ts`、旧 `gameState.combat` 正式运行路径和 `CombatOverlay` 已删除。直接上一代状态只允许在 V3 归一边界转换为 `combatSession`，运行时不双写两套战斗状态。

### 5.3 能力系统 — `src/gameplay/abilitySystem.ts`

能力(技能/天赋/职业/ innate 天赋)的统一构建与实例化管理接口。

> 注:`AbilityDefinition` 接口本身定义在 `src/gameplay/protocols.ts`(含 `schemaVersion`/`id`/`name`/`category`/`rarity`/`maxRank`/`pointCost`/`prerequisites`/`tags`/`mechanics` 等字段),**不存在 `trigger` 字段**;触发逻辑位于 `mechanics` 内的 `cooldownRounds`/`statuses`/`combat` 等子字段。

`abilitySystem.ts` 实际导出的关键函数(无 `registerAbility` / `executeAbility`):

```typescript
function createAbilityInstance(definition: AbilityDefinition, source: AbilityCategory, acquiredAt?: number): AbilityInstance;
function createAbilityRuntime(rank?: number): AbilityRuntime;
function abilityRankCost(definition: AbilityDefinition, rank: number): number;
function createAbilityLibraryRuntime(): AbilityLibraryRuntime;
function stageAbilityProposal(runtime, proposal): { state; preview: AbilityDefinition };
function confirmAbilityProposal(runtime, proposalId): { state; definition?: AbilityDefinition };
function balanceAbilityProposal(proposal: AbilityProposal): AbilityDefinition;
function isMechanicalAbilityDefinition(definition: AbilityDefinition): boolean;
// 以及能力来源转换:abilityDefinitionFromProfessionAbility / FromInnateTalent / FromTalent / FromSkill
```

### 5.4 叙事决策 — `src/gameplay/narrativeDecision.ts`

玩家决策的统一记录与回放接口(供回溯/导出)。实际接口名为 `NarrativeDecisionRecord`(非 `NarrativeDecision`),字段与文档旧版截然不同:

```typescript
interface NarrativeDecisionRecord {
  schemaVersion: 1; id: string; saveId: string;
  eventPackId: string; cardId: string; blockId: string;
  selectedIndex: number; action: NarrativeDecisionAction;
  aiNote?: string; status: 'pending' | 'consumed';
  createdAt: number; consumedAt?: number; consumedByNarrativeId?: string;
}
```

实际导出函数(无 `logDecision` / `getDecisionsForRound`):

```typescript
function createNarrativeDecisionRecord(input: NarrativeDecisionRecordInput): NarrativeDecisionRecord;
function applyNarrativeDecision(state, record): NarrativeDecisionApplication;
function getPendingNarrativeDecisions(state): NarrativeDecisionRecord[];
function consumeNarrativeDecisions(state, consumption): GameState;
function settleNarrativeResponse(state, result): GameState;
function getNarrativeDecisionPromptSnapshot(state, saveId?): NarrativeDecisionPromptSnapshot;
```

### 5.5 协议 — `src/gameplay/protocols.ts`

玩法层与 UI/AI 的通信协议(请求/响应/事件类型定义)。

### 5.6 状态归一 — `src/gameplay/statePreparation.ts`

当前迁移策略不是串联保留所有历史代际：

- `GameState.v3` 是当前状态容器，战斗会话协议本身仍为 `CombatSessionV2`。
- `normalizeGameStateV3()` 只接收直接上一代可识别状态并归一到 V3。
- `prepareGameplayState()` 负责当前 gameplay runtime 初始化与模块状态补齐。
- 更早战斗修补层已经退出；运行时不再维护 `state.combat` 与 `v3.combatSession` 双状态。

### 5.7 子目录

| 子目录                           | 职责                       |
| ----------------------------- | ------------------------ |
| `src/gameplay/creation/`      | 角色创建流程(数据 schema + 步骤定义) |
| `src/gameplay/profession/`    | 职业系统(职业库/技能树/晋升)         |
| `src/gameplay/moduleRuntime/` | 模块运行时(实际装载到 varMgr 的接口)  |
| `src/gameplay/modules/`       | 具体玩法模块(每个模块一个目录)         |

---

