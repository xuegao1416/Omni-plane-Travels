> 本文档对应 `PROJECT_FUNCTIONAL_SPEC.md` §3。实际实现以 `src/worldbook/`、`src/data/worlds-schema.ts`、`src/engine/worldPersonality.ts` 为准。

# 3、世界书系统

## 3.1 Canonical 世界来源

当前世界叙事条目统一存放于 `WorldDef.worldBookEntries`。`applyWorld()` 切换世界时先清除上一世界的临时条目，再将当前世界的 `worldBookEntries` 转成运行时 `WorldInfoEntry` 注入管理器。

历史 `WorldDef.entryId` 模式已从当前基线移除；运行时不再同时维护“全局条目 ID + 嵌入式条目”两条世界加载路径。

主要文件：

| 文件 | 职责 |
|---|---|
| `src/worldbook/worldInfoEngine.ts` | 关键词扫描、递归、概率、分组、注入顺序 |
| `src/worldbook/index.ts` | WorldBookManager、定义→运行时条目转换 |
| `src/worldbook/npcWorldbook.ts` | NPC 世界书生成 |
| `src/engine/worldPersonality.ts` | 将选中世界的 `worldBookEntries` 注入管理器 |
| `src/utils/worldBookImport.ts` | SillyTavern/角色卡等外部世界书格式导入 |

## 3.2 扫描语义

`scanWorldInfo()` 的核心规则：

1. `disable === true` 或 `enabled === false` 跳过。
2. `constant === true` 的条目无条件激活。
3. 非常驻条目必须有主关键词并命中。
4. `selective === true` 时再应用次级关键词逻辑。
5. `useProbability === true` 时应用概率门控。
6. `excludeRecursion` 控制后续递归参与；`preventRecursion` 终止递归链。
7. 同组条目通过分组裁决选出赢家，最终按发送顺序排序。

## 3.3 外部兼容边界

`src/utils/worldBookImport.ts` 中的 `id / uid / entryId` 等名称属于**外部世界书条目字段别名**，与已移除的 `WorldDef.entryId` 不是一回事。外部格式可以继续兼容，但转换后项目内部只消费 `WorldBookEntryDef[]`。
