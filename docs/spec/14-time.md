> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（14、时间系统 — `src/time/`）。
> 总索引见 `../PROJECT_FUNCTIONAL_SPEC.md`。

## 14、时间系统 — `src/time/`

### 14.1 世界时钟 — `src/time/worldClock.ts`

世界时间推进核心:

```typescript
function resolveTurnTimeAdvance(input: { rawResponse: string; narrativeText: string; userText: string; clock: WorldClockState; config: WorldClockConfig }): ResolvedTimeAdvance | null;
function advanceWorldClockForTurn(raw: WorldClockState, configInput: WorldClockConfig, minutesInput: number, metadata: Omit<WorldClockAdvanceMetadata, 'minutes'>): WorldClockState;
function formatWorldClock(clockInput: WorldClockState, configInput: WorldClockConfig): string;
function ensureWorldClockOnGameState<T extends { 世界?: any }>(state: T, worldDef?: WorldDef): T;
```

### 14.2 商业周期 — `src/time/businessPeriod.ts`

经营模块用的"商业周期"(日/周/月/季),与自然时钟正交。

---

