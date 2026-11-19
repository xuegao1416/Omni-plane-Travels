> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（14、时间系统 — `src/time/`）。
> 总索引见仓库根目录的 `PROJECT_FUNCTIONAL_SPEC.md`（相对本文件为 `../../PROJECT_FUNCTIONAL_SPEC.md`）。

## 14、时间系统 — `src/time/`

`src/time/` 只有两个实现文件：`worldClock.ts`（889 行）与 `businessPeriod.ts`（41 行），另有 `worldClock.test.ts`（269 行）。

### 14.1 世界时钟 — `src/time/worldClock.ts`

世界时间推进核心。**权威状态只有 `elapsedMinutes`**：

```typescript
export const WORLD_CLOCK_SCHEMA_VERSION = 2;                 // :3
export const MAX_TIME_ADVANCE_MINUTES = 5_256_000;           // :4

/** v2 deliberately contains no calendar/current/display copy. */   // :47
export interface WorldClockState {                           // :48-54
  schemaVersion: number;
  elapsedMinutes: number;
  lastAdvancedTurnId?: string;
  lastAdvancedRound?: number;
  recentAdvance?: WorldClockAdvanceMetadata;
}
```

`WorldClockConfig`（`:27-37`）保存 `mode: 'gregorian' | 'custom' | 'relative'`（`:6`）、`calendarName` / `eraName` / `start` / `months` / `weekdays` / `timeOfDayLabels`，以及 `defaultTurnMinutes`——后者注释明确「Kept for editor/save compatibility; it is never used as an implicit turn advance」（`:34`），即不会因为没解析到时间就默默推进。

核心导出（行号为实测）：

```typescript
function advanceWorldClockForTurn(raw: WorldClockState, configInput: WorldClockConfig, minutesInput: number, metadata: Omit<WorldClockAdvanceMetadata, 'minutes'>): WorldClockState;   // :424
function formatWorldClock(clockInput: WorldClockState, configInput: WorldClockConfig): string;                                                                                          // :458
function getWorldClockPeriodKeys(clockInput: WorldClockState, configInput: WorldClockConfig): WorldClockPeriodKeys;                                                                      // :476 → { dayKey, weekKey, monthKey }
function reconcileEditedWorldClock(raw: WorldClockState, configInput: WorldClockConfig, displayText: string): WorldClockState;                                                          // :442（人工改显示文本也走同一权威写入口）
function parseTimeAdvance(rawText: string): TimeAdvanceSuggestion | null;                                                                                                                // :489（解析 <TimeAdvance> 标签）
function resolveTurnTimeAdvance(input: { rawResponse: string; narrativeText: string; userText: string; clock: WorldClockState; config: WorldClockConfig }): ResolvedTimeAdvance | null;      // :803
function ensureWorldClockOnGameState<T extends { 世界?: any }>(state: T, worldDef?: WorldDef): T;                                                                                        // :868
```

`resolveTurnTimeAdvance` 的判定优先级（`:810-814`）：叙事文本推断（`inferNarrativeTimeAdvance`，`strength === 'high'` 时直接采用，`source: 'narrative'`）→ 解析模型输出的 `<TimeAdvance>`（`source: 'ai'`）。

### 14.2 商业周期 — `src/time/businessPeriod.ts`

经营模块用的"商业周期"结算键，与自然时钟正交。只有一个导出：

```typescript
export function getBusinessSettlementPeriodKey(cycleName: string, worldTime: string, turnId?: string, clock?: WorldClockState, config?: WorldClockConfig): string | null;   // :5
```

支持的四档粒度（**没有「季」**）：回合/轮（`:12` → `turn:<turnId>`）、月（`:16` / `:23` → `monthKey`）、周/星期（`:17` / `:27` → `weekKey`）、其余落 `dayKey`（`:18`）。有 `clock` 时优先用 `getWorldClockPeriodKeys()` 从权威时钟取键；没有 `clock` 才退回解析 `worldTime` 文本（`:20-40`）。`clock` 存在但缺 `config` 时返回 `null`（`:14`）——宁可不结算也不猜。

---
