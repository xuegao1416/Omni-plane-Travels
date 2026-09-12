> 本文档对应 `PROJECT_FUNCTIONAL_SPEC.md` §12。实际实现以 `src/data/` 为准。

# 12、数据与预设

## 12.1 世界数据

| 文件 | 职责 |
|---|---|
| `src/data/worlds.json` | 6 个内置世界的 canonical 定义、世界书、模块和内置事件 |
| `src/data/worlds-schema.ts` | `WorldDef` / `WorldModule` / 世界书等类型 |
| `src/data/worldLoader.ts` | 内置 + localStorage 世界加载、模块规范化、草稿生命周期 |
| `src/data/worldArtwork.ts` | 世界展示资源映射 |
| `src/data/customWorldLifecycle.ts` | 自定义世界创建/导入/编辑/导出 |

`worlds.json` 当前直接保存 canonical 数据：

- 世界书只使用 `worldBookEntries`；
- 模块使用 `moduleConfig + initialState`；
- 武侠世界职业体系直接引用 `wuxia-core` 职业包；
- 内置卡片 `choice.static.options` 是有效 JSON；
- `effect.stat.statKey` 使用 `attrA/attrB/dim*` canonical ID。

运行时不再对内置世界做“先加载旧数据，再现场修补”的转换。

## 12.2 世界模块迁移边界

`src/modules/normalizeModule.ts` 是旧 `WorldModule.data` 的唯一历史兼容入口。加载旧自定义世界时一次性转换为 `moduleConfig + initialState`；引擎、UI、玩法层不再各自 `moduleConfig ?? data` 双读。

这是当前保留的直接上一代兼容。新建/保存的数据必须写 canonical 字段。

## 12.3 预设

| 文件 | 职责 |
|---|---|
| `src/data/builtinPresets.ts` | 内置 API / 提示词预设 |
| `src/data/presetDrcV12.ts` | DRC v12 预设内容 |
| `src/utils/presetIO.ts` | 外部预设导入导出与字段兼容 |

`presetIO.ts` 对 SillyTavern 等外部格式的 v1/v2 字段兼容属于外部协议兼容，不属于项目内部 schema 迁移链。

## 12.4 职业数据

`src/data/professions/` 保存职业包与典藏。当前 canonical 职业包 schema 为 v2，保留 v1→v2 的直接导入/校验路径；更旧链路不应继续向运行时扩散。
