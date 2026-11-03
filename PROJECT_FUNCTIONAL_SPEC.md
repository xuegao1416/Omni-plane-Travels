# Omni-plane Travels（世界漫游指南）功能总图（v2.8.3 当前代码基线）

> 项目总地图 / Agent 索引。实际代码是最终依据；子系统细节按需打开 `docs/spec/` 对应章节。
>
> 技术栈：React 19 + TypeScript 6 + Zustand + Bun 1.3.14 + Cloudflare Workers/D1 + Tauri 2 工具链。
>
> 当前清理基线：内置世界 6 个；世界定义、内置事件数据和运行时读取已统一到 canonical 格式；历史格式只允许停留在明确的导入/加载迁移边界。生产 `src/` 已清除静态不可达文件与 TypeScript 可检测的未使用局部/导入（`src/novel/` 独立子系统除外）。

## 0. 使用原则

1. 先用本文件定位模块，再打开对应 `docs/spec/§N-*.md`，最后以实际代码确认。
2. **运行时只消费 canonical 数据。** 兼容逻辑应集中在导入/加载边界，完成一次转换后不继续双读旧字段。
3. **数据格式兼容窗口只保留直接上一代。** 例如当前 schema V3 可保留 V2→V3；V1→V2、V0→V1 之类更早链路应从当前运行时移除。数据库部署版本独立判断：IndexedDB 必须支持上一正式版（2.8.2 的 DB v5）及其后开发版本直接补齐到当前 v10，不改写存档记录；数据库 SQL 迁移历史也不按此规则删除。
4. 外部协议兼容（如 SillyTavern 字段、OpenAI-compatible URL）不等同于项目内部历史 schema，不因内部清理而删除。
5. `src/novel/` 是独立的数据/拆解子系统；修改主游戏时默认不联动它。

## 1. 总体数据流

```text
Start / World Hall
  ↓
WorldDef（worldBookEntries + canonical modules）
  ↓
GameContext / useGameEngine
  ├─ promptAssembler + worldbook
  ├─ memoryPipeline
  ├─ variableExtraction / variableManager
  ├─ gameplay kernel / combat / profession
  ├─ director / offscreen acceptance / runtime snapshots
  └─ events / workflows
  ↓
IndexedDB save + module state + optional Cloudflare services
```

## 2. 子系统索引

| # | 子系统 | 主要路径 | 详细文档 |
|---|---|---|---|
| 1 | 核心引擎 | `src/engine/` | `docs/spec/01-core-engine.md` |
| 2 | 记忆系统 | `src/memory/` | `docs/spec/02-memory.md` |
| 3 | 世界书 | `src/worldbook/` | `docs/spec/03-worldbook.md` |
| 4 | 事件 / 工作流 | `src/modules/` | `docs/spec/04-events-workflow.md` |
| 5 | 玩法内核 / 战斗 / 职业 | `src/gameplay/` | `docs/spec/05-gameplay.md` |
| 6 | 剧情导演与运行状态 | `src/director/` `src/simulation/` | `docs/spec/06-simulation.md` |
| 7 | 自定义模块 | `src/custom-modules/` | `docs/spec/07-custom-modules.md` |
| 8 | API / 存储 | `src/api/` `src/storage/` `src/stores/` | `docs/spec/08-api-storage.md` |
| 9 | UI | `src/components/` | `docs/spec/09-ui-components.md` |
| 10 | 导航 / Context | `src/context/` | `docs/spec/10-context-nav.md` |
| 11 | Hooks | `src/hooks/` | `docs/spec/11-hooks.md` |
| 12 | 世界 / 预设数据 | `src/data/` | `docs/spec/12-data-presets.md` |
| 13 | 小说数据集 | `src/novel/` | `docs/spec/13-novel.md` |
| 14 | 世界时间 | `src/time/` | `docs/spec/14-time.md` |
| 15 | 世界生成 | `src/worldgen/` | `docs/spec/15-worldgen.md` |
| 16 | 主题 / CSS | `src/theme/` `src/styles/` | `docs/spec/16-theme-styles.md` |
| 17 | 安全 / 基础设施 | `src/security/` `src/schema/` `src/config/` | `docs/spec/17-security-infra.md` |
| 18 | 工具 | `src/utils/` | `docs/spec/18-utils.md` |
| 19 | 构建 / 部署 | 根目录、`functions/`、`migrations/`、`scripts/` | `docs/spec/19-root-deploy.md` |
| 20 | 文档系统 | `docs/` | `docs/spec/20-docs.md` |
| 21 | 跨系统数据流 | 多模块 | `docs/spec/21-dataflow.md` |
| 22 | 关键设计决策 | 多模块 | `docs/spec/22-design-decisions.md` |
| 23 | GameContext / 存档桥 | `src/context/` + `src/storage/` | `docs/spec/23-gamecontext-bridge.md` |

## 3. 当前 canonical 边界

### 3.1 世界定义

- 世界叙事条目唯一来源：`WorldDef.worldBookEntries`。
- `WorldDef.entryId` 历史模式已经退出当前基线。
- 世界模块 canonical 形态：`moduleConfig + initialState`。
- 旧 `WorldModule.data` 只在 `src/modules/normalizeModule.ts` 作为**直接上一代导入边界**读取；加载后运行时代码只读 `moduleConfig`。
- `worldLoader.ts` 在内置世界和 localStorage 自建世界进入运行时前统一执行模块规范化。

### 3.2 事件包

- 当前卡片包索引：`schema/events.json`，`version: 2`。
- 当前工作流：`schema/event-<id>.json`。
- 导入层保留 **v1 indexed pack → canonical v2**。
- 更早的“只有 `schema/card.json`、没有 `schema/events.json`”单卡包格式已经退出兼容窗口。
- 内置事件工作流直接以 canonical 节点数据存放在 `worlds.json`；不再运行时修补坏 JSON / 中文 statKey。

### 3.3 世界时间

- 当前 `WorldClockState.schemaVersion = 2`。
- 只保留 v1 clock → v2 cursor 的直接迁移；canonical v2 不保存 calendar/current/display 副本。

### 3.4 Gameplay / Combat

- `GameState.v3` 是当前游戏状态容器；战斗会话协议自身仍是 `CombatSessionV2`。
- `src/gameplay/combatV2.ts` + `combatRuntime.ts` 是当前唯一战斗运行时；旧 `combat.ts` / `CombatOverlay` 已退出生产代码。
- `normalizeGameStateV3()` / `prepareGameplayState()` 负责直接上一代状态归一与当前 runtime 补齐，不再串联多代战斗修补。

### 3.5 内部存档

- 当前 `SAVE_SCHEMA_VERSION = 4`，消息使用独立 store 分片持久化。
- 只保留直接上一代 **v3（内联 messages）→ v4（分片）**。
- v0/v1/v2 内部 IndexedDB 存档不再串联经过多代迁移进入当前运行时。
- 外部导出 JSON 走独立 import normalization，不等同于内部 IndexedDB schema 迁移。

### 3.6 仍应保留的兼容类型

以下属于直接上一代或外部协议，当前仍有意义：

- `WorldModule.data` → `moduleConfig + initialState`（集中在 normalize 边界）
- event pack v1 indexed → v2
- world clock v1 → v2
- profession pack v1 → v2
- combat / GameState V2 语义 → V3
- internal save v3 → v4
- SillyTavern 世界书 / 预设的外部字段别名

## 4. 仓库结构（当前清理包）

```text
src/
├─ engine/          核心 AI / 变量管线
├─ memory/          记忆、embedding、编译上下文
├─ worldbook/       世界书扫描 / NPC 世界书
├─ modules/         事件、卡片、规则、工作流
├─ gameplay/        玩法内核、战斗、职业、能力
├─ director/        固定剧情 / 因果计划 / 指导与落实 / 幕后提案
├─ simulation/      导演运行状态 / 世界上下文 / 快照接入
├─ custom-modules/  自定义 gameplay 模块
├─ api/             模型/API 客户端
├─ storage/         IndexedDB / 模块状态
├─ stores/          Zustand stores
├─ server/          Cloudflare Worker 后端
├─ components/      React UI
├─ context/         GameContext 等
├─ hooks/           React hooks
├─ data/            6 个内置世界、预设、职业数据
├─ novel/           小说拆解与资料系统
├─ time/            世界时钟 / 周期
├─ worldgen/        世界生成类型/选择逻辑
├─ theme/ styles/   主题与样式
└─ utils/           导入、格式化、文本、世界书工具

public/             PWA 与美术/音频静态资源
functions/          Pages Functions
migrations/         D1 SQL 历史迁移（9 个）
scripts/            构建/维护脚本
server.ts           Bun dev server
build.ts            Bun production build
package.json         Bun/npm/Tauri/Cloudflare 脚本与依赖
```

> 当前传递用 clean 包未包含生成型 `src-tauri/` 工程，但 `package.json` 仍保留 Tauri 2 桌面/Android 工具链命令；原生工程需由完整仓库或 `tauri android init` 提供。

## 5. 文档维护规则

代码清理、文件删除、schema 代际变化完成后，至少同步：

- 本文件对应 canonical 边界与路径；
- 受影响的 `docs/spec/` 子文档；
- `docs/ARCHITECTURE.md` 中仍会误导开发的旧结构说明。

`docs/CHANGELOG.md` 是历史记录，不因现状清理而改写历史条目。
