> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（15、世界生成 — `src/worldgen/`）。
> 总索引见仓库根目录的 `PROJECT_FUNCTIONAL_SPEC.md`（相对本文件为 `../../PROJECT_FUNCTIONAL_SPEC.md`）。

## 15、世界生成 — `src/worldgen/`

`src/worldgen/` 共 4 个文件：

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `src/worldgen/types.ts` | 6 | 只有一行类型：`export type CallAI = (messages: Array<{ role: string; content: string }>) => Promise<string>;`（`:6`）——不是「世界生成器类型定义」 |
| `src/worldgen/choice/types.ts` | 28 | 选择式生成器类型：`DimensionChoice`（`:5`）、`DimensionGeneration`（`:13`）、`DimensionSelection`（`:19`） |
| `src/worldgen/choice/index.ts` | 13 | 纯 re-export（`:4-8` 类型、`:10-13` 两个生成函数） |
| `src/worldgen/choice/choicePipeline.ts` | 297 | 两段式生成实现 |

### 15.1 选择式生成管线（`choice/choicePipeline.ts`）

文件头注释即设计说明（`:1-3`）：**2 次调用版本**——

1. 第 1 次：生成所有维度的选项（粗纲）。
2. 第 2 次：根据选择生成完整世界（细纲）。

两个导出：

- `generateWorldFromSelections(...)`（`:25`）——把用户的 `DimensionSelection[]` 合成为 `WorldDef`。
- `generateModuleEntries(...)`（`:245`）——为选中的基础模块生成世界书条目与模块配置（`:236-243` 有模块 ID → 中文名的映射）。

`CallAI`（`worldgen/types.ts:6`）是这里的注入点：管线本身不关心底层是哪家 Provider，由调用方传入 `(messages) => Promise<string>`。

### 15.2 生成结果落盘（不在 `src/worldgen/` 内）

`src/worldgen/` 只产出 `WorldDef` 对象，持久化在数据层：

| 函数 | 位置 | 职责 |
| --- | --- | --- |
| `forkWorld(world, draftName)` | `src/data/worldLoader.ts:77` | 以已有世界为基底派生草稿：深拷贝后改 id 为 `${world.id}_fork_${now}`，打上 `isDraft` / `forkedFrom` / `draftName` / `draftCreatedAt` / `draftUpdatedAt` |
| `saveWorldDraft(draft)` | `src/data/worldLoader.ts:94` | 按 id 覆盖或追加，整体写入 localStorage `STORAGE_KEYS.WORLD_DRAFTS` |
| `listWorldDrafts()` | `src/data/worldLoader.ts:103` | 读 localStorage；JSON 损坏时返回 `[]` 而非抛错 |
| `deleteWorldDraft(draftId)` | `src/data/worldLoader.ts:110` | 按 id 过滤后回写 |
| `promoteDraftToCustomWorld(draft)` | `src/data/worldLoader.ts:116` | 剥掉 `isDraft` / `forkedFrom` / `draftName` / `draftCreatedAt` / `draftUpdatedAt` 五个草稿标记，写入 `CUSTOM_WORLDS` |

自建世界的增删改与生命周期（含「被存档引用则不可删」这类约束）在 `src/data/customWorldLifecycle.ts`，UI 侧入口是 `useWizard` 的 `handleSaveWorld` / `handleDeleteWorld`（见 `11-hooks.md` §11.4）。

> 注：另有一套面向上层的「AI 编织世界」交互（四阶段：世界种子 → 世界法则 → 世界编年 → 降临预览），实现在组件层 `src/components/start/WorldEditorForm.tsx:28` 的 `WEAVE_STEPS`，不属于 `src/worldgen/` 的选择式管线。

---
