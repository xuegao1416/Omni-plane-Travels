<div align="center">

# <img src="https://unpkg.com/lucide-static@latest/icons/globe-2.svg" width="32" height="32" /> 世界漫游指南 · Omniplane Travels

**把任何脑洞编织成一个可以真正活进去的世界**

一个面向自定义世界、长期叙事与规则化模拟的 AI 互动叙事引擎。项目以 React + TypeScript 构建前端，以小说拆解、剧情导演、结构化游戏状态、叙事记忆、事件工作流和可插拔模块共同驱动游戏。

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3-FBF0CF?logo=bun)](https://bun.sh/)
[![Zustand](https://img.shields.io/badge/Zustand-5-3B3B3B)](https://zustand-demo.pmnd.rs/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

`v2.8.3` · Web / PWA · BYOK

</div>

<img src="public/art/theme/entry/hall-background-16x9-nocturne-v2.png" alt="世界晶体大厅" width="100%" />

## <img src="https://unpkg.com/lucide-static@latest/icons/sparkles.svg" width="20" height="20" /> 项目能力

### 小说拆解与剧情导演

- 导入 TXT、EPUB 或拆解资料，识别章节、提取原文证据，归并人物、势力、地点、物品与世界规则，生成世界书和主线资料。
- 支持暂停、检查点恢复及可选 Embedding；小说分析分段与游戏主线阶段分别组织。
- 原创原稿与小说共用可人工编辑的固定剧情版本，支持自创/原作角色及阶段起点，小说创建前需保存主线版本。
- 导演在正文前提供指导、正文后核对落实；主线和人物幕后行动共用事实依据，玩家拒绝或前提变化可以影响后续计划。
- 普通面板只展示玩家上次获知的人物资料；幕后事实经实际见闻或披露后才更新角色认知。
- 主线耗尽后可继续游玩；固定剧情版本、阶段与导演状态随存档导出，支持跨设备导入续玩。

### <img src="https://unpkg.com/lucide-static@latest/icons/theater.svg" width="16" height="16" /> 世界与角色

- 内置日式校园、烟火人间、武侠世界、末日废土、荒岛求生、边境贸易六个世界。
- 支持通过四阶段“世界编织仪式”从自然语言创建自定义世界。
- 世界定义覆盖地理、势力、文化、经济、人物、规则、系统与世界书。
- 四阶段角色创建流程将身份、天赋、经历与启程契约写入结构化角色状态。
- 自定义世界、角色与存档均可导入和导出。

### <img src="https://unpkg.com/lucide-static@latest/icons/brain.svg" width="16" height="16" /> 叙事运行时

- 非流式 AI 正文与可交互选择卡片。
- 结构化 `GameState` 同步维护世界、玩家、NPC、资源和任务状态。
- 编译式叙事记忆保存场景锚点、故事线、关系、事件与长期事实。
- 剧情导演统一主线与幕后人物计划；资源、时间周期和机械效果由玩法系统结算。
- 动态任务、纪事系统、变量快照与历史回滚。

### <img src="https://unpkg.com/lucide-static@latest/icons/puzzle.svg" width="16" height="16" /> 模块、事件与规则

- 数值属性、成长体系、生存资源、经营资产、骰子检定、职业与战斗等可插拔模块；未启用的世界不会显示对应创建步骤或注入相关提示词。
- 先天天赋、职业能力、自由技能、动态技能、宠物/召唤能力和战斗道具共用统一能力协议；AI 只提出语义方案，最终数值由本地配平并经玩家确认。
- 内置经典幻想与东方幻想两套职业典藏，共十二种四阶职业，支持能力树前置/互斥校验、复制修改、导入导出与 AI 扩展。
- 独立卡片战场支持最多 4v4、每单位每轮一次行动、本地策略 AI、完整战前检查点和普通/困难/炼狱风险；整场机械结算结束后才调用一次主模型承接正文。
- 自定义模块代理可根据世界需求生成、校验、保存、导出并发布受约束的玩法模块。
- 事件包由事件卡、规则、周期规则和世界书组成，可导入、导出和按局启用。
- 创意工坊支持世界包、玩法模块、事件/工作流包、冒险包和视觉主题，并提供分类、精选、热门、兼容版本与依赖检查。
- 基于 React Flow 的类型化工作流编辑器与确定性规则解释器。
- AI 合集生成器可按世界生成事件、规则与世界书合集。

### <img src="https://unpkg.com/lucide-static@latest/icons/hard-drive.svg" width="16" height="16" /> 存储与跨端

- Web 端使用 IndexedDB 保存游戏存档、事件包与本地配置。
- 支持多存档、自动保存、快照回滚和 JSON 迁移。
- 可选云存档、创意工坊与邮箱验证码账号体系。
- 记忆检索可选择远程 Embedding、应用内 WASM 端侧模型或外部本地服务；不可用时自动降级到关键词召回。
- 服务端可配置不可由客户端重置的三轮匿名体验额度，上游失败不会消耗次数。
- 移动端使用响应式面板与抽屉布局；当前交付为 Web/PWA，Tauri 原生适配入口保留，但本版源码不包含 `src-tauri` 工程。

## <img src="https://unpkg.com/lucide-static@latest/icons/image.svg" width="20" height="20" /> 设计与流程图

| 世界编织与角色创建 | AI 叙事管线 |
|---|---|
| ![角色创建流程](docs/diagrams/character-creation.svg) | ![AI 叙事管线](docs/diagrams/pipeline.svg) |

![世界书扫描流程](docs/diagrams/worldbook.svg)

## <img src="https://unpkg.com/lucide-static@latest/icons/layers.svg" width="20" height="20" /> 技术架构

```text
React UI
├─ 开始界面 / 世界编织 / 角色创建 / 游戏界面
├─ 设置 / 事件典藏 / 自定义模块 / 存档空间
└─ 响应式桌面端与移动端布局
        │
        ▼
Zustand + React Context
├─ 配置、存档、事件、图像与账号状态
└─ 结构化 GameState / PlayerState / NPCData
        │
        ▼
Game Engine
├─ Prompt 组装与非流式正文
├─ 变量更新与机械效果结算
├─ 叙事记忆与世界书注入
├─ 剧情导演、幕后受理与事件规则求值
└─ 任务、纪事、卡片与快照
        │
        ▼
Storage / Services
├─ IndexedDB
├─ 固定剧情定义与小说资料
└─ Cloudflare Workers + D1（可选云服务）
```

### <img src="https://unpkg.com/lucide-static@latest/icons/settings-2.svg" width="16" height="16" /> 核心技术栈

| 层级 | 技术 |
|---|---|
| 前端 | React 19、TypeScript 6、Zustand |
| 服务 | Bun、Hono |
| 原生适配 | Tauri 2 前端适配保留；原生工程不在本版源码内 |
| 存储 | IndexedDB、可选 Cloudflare D1 |
| 编辑器 | React Flow、Mermaid、Marked |
| 数据校验 | Zod |

### <img src="https://unpkg.com/lucide-static@latest/icons/folder-tree.svg" width="16" height="16" /> 关键目录

```text
src/
├─ api/                 AI Provider、图像生成与请求限流
├─ components/          React UI 组件
│  ├─ start/            首页、世界大厅、世界编织与角色创建
│  ├─ game/             游戏主界面、对话、选择卡片与侧栏
│  ├─ event/            事件典藏、卡片与规则工作流编辑器
│  ├─ workflow/         类型化工作流画布
│  ├─ card-workflow/    卡片内容编辑工作流
│  ├─ settings/         API、预设、记忆、变量与界面设置
│  └─ shared/           共享弹窗、图标、图谱与 UI 基础组件
├─ config/              存储键与运行配置
├─ constants/           运行时常量
├─ context/             游戏与 UI Context
├─ data/                内置世界、世界 Schema 与加载器
├─ director/            固定剧情定义、因果计划、指导与落实回执
├─ engine/              Prompt、正文管线、变量与事件总线
├─ gameplay/            统一玩法内核、能力协议、职业与确定性战斗
├─ hooks/               游戏、向导、NPC、生图与响应式 Hooks
├─ memory/              编译式叙事记忆、向量检索与检查点
├─ modules/             属性、成长、生存、经营、骰子与天赋模块
├─ schema/              GameState / PlayerState / NPCData 类型
├─ novel/               小说导入、证据提取、档案归并与世界书生成
├─ simulation/          导演运行状态、上下文与快照接入
├─ storage/             IndexedDB 存档与模板持久化
├─ stores/              Zustand 配置、存档、预设与生图 Store
├─ styles/ + theme/     Dawn V4 UI 与主题样式
├─ utils/               Markdown、Prompt、快照与安全工具
├─ worldbook/           SillyTavern 兼容世界书引擎
└─ worldgen/            选择式与自定义世界生成管线

functions/              Cloudflare Workers API 与边缘函数
migrations/             D1 数据库迁移
docs/                   架构、教程、规范、截图与变更记录
public/art/             世界、UI、图标与大厅视觉素材
```

## <img src="https://unpkg.com/lucide-static@latest/icons/rocket.svg" width="20" height="20" /> 本地运行

### 环境要求

- [Bun](https://bun.sh/)
- 一个 OpenAI 兼容 API；也支持 DeepSeek、Google AI 和自定义端点

### 安装与启动

```bash
git clone https://github.com/xuegao1416/Omni-plane-Travels.git
cd Omni-plane-Travels
bun install
bun run dev
```

开发服务默认运行在 `http://localhost:3456/`。

### 常用命令

| 命令 | 用途 |
|---|---|
| `bun run dev` | 启动本地开发服务 |
| `bun run build` | 构建 Web 版本 |
| `bun run typecheck` | TypeScript 静态检查 |
| `bun test` | 运行测试 |
| `bun run tauri:dev` | 启动 Tauri 开发环境 |
| `bun run tauri:build` | 构建桌面端 |
| `bun run tauri:android:init` | 初始化 Android 工程（首次或清理后） |
| `bun run tauri:android:dev` | 启动 Android 开发环境 |
| `bun run tauri:android:build:debug` | 构建 ARM64 调试 APK |

上表中的 Tauri 命令仅供已有完整原生工程的工作副本使用；本版不含 `src-tauri`，不能直接生成安装包。历史构建依赖和产物位置见 [原生构建指南](docs/native-build.md)。标签发布默认产出 Web 压缩包，仅在原生工程存在时执行原生构建。

## <img src="https://unpkg.com/lucide-static@latest/icons/key-round.svg" width="20" height="20" /> API 配置

启动应用后，在“设置”中填写：

1. API 端点；
2. API Key；
3. 模型名称；
4. 可选的温度、上下文长度、最大输出与代理地址。

API Key 使用 Web Crypto 加密后保存在本机。浏览器端遇到 Provider CORS 限制时，可使用自建代理；Tauri 桌面端可走原生 HTTP 链路。

## <img src="https://unpkg.com/lucide-static@latest/icons/database.svg" width="20" height="20" /> 数据与扩展格式

### 世界

- 内置世界：`src/data/worlds.json`
- 自定义世界：运行时保存并通过统一世界加载器读取
- 世界包含设定、人物、规则、模块、世界书和事件包关联

### 事件包

- `.opt-event` 为事件包导入导出格式
- 事件包可包含事件卡、规则、周期规则与世界书
- 全局启用状态与单局启用状态分离

### 世界书

- 支持 SillyTavern Lorebook 的关键词、正则、逻辑组合、概率、递归与去重机制
- 世界书可以来自世界定义、事件包和 NPC 档案

### 存档

- 游戏存档包含世界、角色、对话、变量、记忆、任务、纪事、模块运行时、职业能力、可恢复战斗会话，以及导演状态、玩家已知资料和固定剧情依赖
- 支持自动保存、手动导入导出与历史快照回滚

## <img src="https://unpkg.com/lucide-static@latest/icons/shield-check.svg" width="20" height="20" /> 安全与隐私

- API Key 仅保存在本机，不由项目服务器代管。
- Web 端使用 Web Crypto AES-GCM 与 non-extractable key。
- HTML 内容经过 DOMPurify 清理，嵌入内容运行在受限沙箱中。
- 变量路径和规则动作使用白名单与危险键检查。
- 云服务为可选能力，本地游戏不依赖项目账号。

## <img src="https://unpkg.com/lucide-static@latest/icons/file-text.svg" width="20" height="20" /> 文档

- [快速开始](docs/GETTING_STARTED.md)
- [玩法系统指南](docs/gameplay-system-guide.md)
- [架构说明](docs/ARCHITECTURE.md)
- [上手教程](docs/tutorial.md)
- [变更日志](docs/CHANGELOG.md)
- [规则画布与工作流规范](docs/rule-canvas-workflow-spec.md)
- [记忆系统参考](docs/reference-memory-system.md)
- [内容政策](docs/content-policy.md)
- [项目治理](docs/governance.md)
- [隐私政策](PRIVACY.md)

## <img src="https://unpkg.com/lucide-static@latest/icons/heart.svg" width="20" height="20" /> 致谢

本项目的编译式叙事记忆系统移植并适配自 [lucklyjkop/异界转生录](https://github.com/lucklyjkop/yijiekkk)，已获得原作者授权。原实现基于 Vue 3 与 Pinia，本项目将相关机制迁移为 React、TypeScript 与 Zustand 架构。

感谢原作者提供授权与技术资料。

## <img src="https://unpkg.com/lucide-static@latest/icons/scale.svg" width="20" height="20" /> License

[MIT](LICENSE)
