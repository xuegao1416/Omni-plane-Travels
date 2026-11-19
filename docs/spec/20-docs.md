> 本文档对应 `PROJECT_FUNCTIONAL_SPEC.md` §20。
> 总索引见仓库根目录的 `PROJECT_FUNCTIONAL_SPEC.md`（相对本文件为 `../../PROJECT_FUNCTIONAL_SPEC.md`）。

# 20、文档系统

## 20.1 文档层级

- `PROJECT_FUNCTIONAL_SPEC.md`：当前代码总地图和 canonical 边界。
- `docs/spec/01-23*.md`：按子系统拆分的实现索引。
- `docs/ARCHITECTURE.md`：较完整的概念架构说明。
- `docs/GETTING_STARTED.md` / `docs/tutorial.md`：使用与入门；`docs/tutorial/` 下另有小说免费游玩、原作故事、快速上手三篇专题教程。
- `docs/gameplay-system-guide.md` / `docs/reference-memory-system.md` / `docs/rule-canvas-workflow-spec.md`：专题参考。
- `docs/content-policy.md` / `docs/governance.md` / `docs/native-build.md`：内容政策、治理与商业模式、原生（Tauri/Android）构建指南。
- `docs/CHANGELOG.md`：历史发布记录，允许描述已经退出当前代码的旧机制。
- `docs/diagrams/`：流程/架构图。设计过程稿不入库——过程稿写在 `docs/plans/`（空目录，不纳入版本管理）与 `docs/reviews/`（当前为未跟踪文件），定稿结论再回写 `docs/spec/`。

## 20.2 维护规则

删除文件、替换 schema、切换 canonical 数据源时，应在同一次清理中同步三处：总地图（`PROJECT_FUNCTIONAL_SPEC.md` 的 canonical 边界与路径）、受影响的 `docs/spec/` 子文档，以及 `docs/ARCHITECTURE.md` 中仍会误导开发的旧结构说明。文档中不应继续把已经删除的旧入口写成当前路径。

`docs/CHANGELOG.md` 属历史记录，不因现状清理而改写既有条目。

参考项目文档（如 `reference-memory-system.md` 中的外部工程路径）必须明确标注来源，不把参考项目的 `src/...` 路径当成本仓库文件。
