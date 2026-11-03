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
| `src/data/presetDeepSeekStyles.ts` | DeepSeek 专用的七种可选文风正文 |
| `src/data/presetDrcV12.ts` | 双人成行（适配版）预设内容，当前对齐上游 V14.1 |
| `src/data/presetDrcJcz.ts` | 双星纪·江城子（Gemini 特供）预设内容，与 V14 同源 |
| `src/data/presetControls.ts` | 图形配置分组与互斥更新，直接投影条目 `enabled` |
| `src/data/presetParameters.ts` | DRC 字数宏的结构化读取与修改 |
| `src/utils/presetIO.ts` | 外部预设导入导出与字段兼容 |

`presetIO.ts` 对 SillyTavern 等外部格式的 v1/v2 字段兼容属于外部协议兼容，不属于项目内部 schema 迁移链。

DeepSeek 专用预设 v1.5.0 覆盖默认文风及全部七种可选文风（日系轻小说、轻松吐槽、校园青春、白描、古风武侠、散文小说、自由随性），不再复用默认 / Gemini 预设的可选文风正文。每套保留自身叙事特色，独立调整规则与示例；沿用原条目 ID、名称、顺序、默认开关和 `base_writing` 单选机制，其他预设继续使用原文。针对 2026-10-17 更新后的文风反馈强化具体行为、有限感知、自然对白和段落节奏；常驻纠偏条目约束“不争、不抢、不急”“稳稳地接住情绪”等安抚模板及近似句式，保留有事实含义的动作和对白。v1.5.0 把默认文风改为完整正向样本驱动，正文下限提到 1200 字并移除反向压缩正文的指令，其余六种可选文风不变。选项块之后允许宿主要求的唯一 `<TimeAdvance>` 回执，不与宿主尾部协议冲突。未引入 SPreset 脚本或缓存搬运机制。

两个上游预设同属 DRC 系：`双人成行（适配版）` 由 `presetDrcV12.ts` 提供，`双星纪·江城子（Gemini 特供）` 由 `presetDrcJcz.ts` 提供。两者共用同一套宿主适配规则——删酒馆专属条目与状态槽位、只重写机制条目、其余原文保留，输出契约、思维链、世界时间与玩家视角统一交给宿主。`双星纪` 的上游「破甲0」条目涉及未成年条款，已整条删除；主提示中的保护性红线保留。

DRC 当前基于秋信来迟 v1.1 本土化：删除酒馆前端、状态栏、札记、重复摘要/变量更新、旧视角、草稿与空装饰，并清理对应宏读写。Core 直接使用 `<contenttext>`、行动选项和 `<TimeAdvance>`；文风、人物、节奏、情感及纠偏模块仍使用原有 ID/宏和相对顺序。保留旧正文的标签清洗兼容，删除酒馆 MoM 摘要过滤规则，记忆压缩仍归宿主所有。

快捷配置、高级条目、运行时和导出共用 `PresetPack`。内置编辑通过 `presetStore.saveBuiltinEdits` 一次计算相对 canonical 默认值的开关/内容覆盖；保存失败不发布状态，恢复默认复用同一写入路径。用户的明确内容覆盖继续保留，不自动覆盖为新版正文。外部导入遵循 `prompt_order` 的排序与开关，导出保留禁用项、关键词触发及深度注入元数据。

## 12.4 职业数据

`src/data/professions/` 保存职业包与典藏。当前 canonical 职业包 schema 为 v2，保留 v1→v2 的直接导入/校验路径；更旧链路不应继续向运行时扩散。
