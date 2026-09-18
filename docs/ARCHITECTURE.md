# 世界漫游指南 — 当前架构（v2.8.4）

> 总索引见 `../PROJECT_FUNCTIONAL_SPEC.md`；更细的子系统说明见 `spec/`。本文只记录当前架构骨架和跨系统边界，避免与总地图重复维护。

## 1. 总体结构

```text
Browser / PWA
        │
        ▼
React UI + GameContext
        │
        ├── World / Character creation
        ├── AI turn pipeline
        ├── Memory / Worldbook
        ├── Gameplay / Combat / Profession
        ├── Events / Workflow
        └── Novel / Director / Offscreen acceptance
        │
        ▼
Zustand + IndexedDB persistence
        │
        ├── local-only runtime
        └── optional Cloudflare Worker / D1 services
```

前端没有 React Router；页面导航由 Context/状态机驱动。Bun 同时承担本地开发服务器和 production bundle。

## 2. 主要代码层

| 层 | 路径 | 当前职责 |
|---|---|---|
| UI | `src/components/` | 页面、面板、编辑器、Dawn V4 视觉组件 |
| Context / hooks | `src/context/`, `src/hooks/` | 页面桥接、创建流程、运行时连接 |
| 核心引擎 | `src/engine/` | prompt、回合执行、变量提取/事务 |
| 记忆 | `src/memory/` | 记忆流水线、语义检索、编译上下文 |
| 世界书 | `src/worldbook/` | 扫描、匹配、注入、NPC 条目 |
| 事件/工作流 | `src/modules/` | canonical event pack、规则执行、workflow 编辑表示 |
| Gameplay | `src/gameplay/` | V3 gameplay、战斗、职业、能力、模块运行时 |
| Novel | `src/novel/` | 原文导入、证据提取、档案归并、剧情资料与世界书 |
| Director | `src/director/` | 固定版本、因果计划、正文指导、落实审查及幕后提案 |
| Simulation | `src/simulation/` | 导演运行状态、上下文与快照接入，旧演化独立推进已退出 |
| 数据 | `src/data/` | 6 个内置世界、预设、职业资料 |
| 时间 | `src/time/` | canonical WorldClock v2 |
| 持久化 | `src/storage/`, `src/stores/` | IndexedDB、存档、模块状态、Zustand |
| 后端 | `src/server/`, `functions/` | Hono / Cloudflare 服务 |
| 静态资源 | `public/` | PWA manifest、icon、音频、美术 |

小说拆解输出世界书与有来源的剧情材料，后者经导演定义编译和固定版本存储后在开局绑定。导演指导不等于事实；变量与记忆分别保有权威状态及写入管线。

## 3. 世界与模块

内置世界唯一源为：

```text
src/data/worlds.json
        ↓
src/data/worldLoader.ts
        ↓
WorldDef
```

当前 `WorldDef` 的世界书入口只有 `worldBookEntries`。内部 `entryId` 旧模式已经移除。

世界模块 canonical 结构为：

```text
moduleId + enabled + moduleConfig + initialState
```

旧 `WorldModule.data` 只在 `src/modules/normalizeModule.ts` 的直接上一代迁移边界读取；运行时不双读 `data/moduleConfig`。

## 4. 事件与工作流

卡片事件包 canonical 文件：

```text
manifest.json
schema/events.json          # version 2
schema/event-<id>.json      # CardWorkflowDefinition
```

导入只保留 v1 indexed pack → v2。更早的 standalone `schema/card.json` 不再进入迁移链。

规则编辑器还存在两种**当前表示**，它们不是“多代 schema 兼容”：

```text
schema/workflow.json   # 编辑器 WorkflowDefinition
        ⇅ converter
schema/rules.json      # 当前规则执行器 RuleFile
```

两者由 `workflowConverters.ts` 显式转换；不要把这条当前表示转换误当成历史格式迁移。

## 5. 存档

当前内部存档 schema 为 **v4**：头部保存在 saves store，消息按 `${saveId}#${seq}` 分片存储。

自动迁移窗口只有：

```text
v3（messages 内联） → v4（消息分片）
```

更早内部 schema 不再通过 v1→v2→v3→v4 串联进入当前运行时。外部“导出存档 JSON”经过独立 import normalization，不等同于 IndexedDB 内部 schema 历史。

Gameplay 状态当前以 V3 为基线；当前战斗只走 `combatV2.ts` / `combatRuntime.ts` 与 `gameState.v3.combatSession`。旧 `combat.ts`、`CombatOverlay` 和 `combat-runtime-v1` 中间修补层已经移除。

## 6. 世界时钟

`WorldClockState.schemaVersion = 2`，运行时只维护 elapsed/cursor 语义，不保存重复 calendar/current/display 副本。只保留 v1 → v2 的直接迁移。

## 7. 构建与部署

```text
bun run dev
  → server.ts / Bun.serve / Bun.build

bun run build
  → build.ts / Bun.build
  → dist/
```

`public/` 是静态资源唯一源码来源，`dist/` 是生成物。`devDependencies.bun` 用于 npm/Node-only CI 中提供本地 Bun binary。

Cloudflare 后端位于 `src/server/` 与 `functions/`；`migrations/` 中的 D1 SQL 是部署历史，保留完整迁移序列。

## 8. 架构维护约束

1. 运行时保持单一 canonical schema。
2. 兼容逻辑集中在 ingress/import/load boundary。
3. 当前 Vn 最多保留 V(n-1) → Vn；更早链路在版本推进时淘汰。
4. 删除/重命名实现后，同步总地图与对应 `docs/spec`。
5. 外部协议兼容和部署数据库迁移需单独判断，不能机械套用内部 schema 清理规则。
