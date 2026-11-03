> 本文档对应 `PROJECT_FUNCTIONAL_SPEC.md` §20。

# 20、文档系统

## 20.1 文档层级

- `PROJECT_FUNCTIONAL_SPEC.md`：当前代码总地图和 canonical 边界。
- `docs/spec/01-23*.md`：按子系统拆分的实现索引。
- `docs/ARCHITECTURE.md`：较完整的概念架构说明。
- `docs/GETTING_STARTED.md` / `docs/tutorial.md`：使用与入门。
- `docs/gameplay-system-guide.md` / `docs/reference-memory-system.md` / `docs/rule-canvas-workflow-spec.md`：专题参考。
- `docs/CHANGELOG.md`：历史发布记录，允许描述已经退出当前代码的旧机制。
- `docs/diagrams/`：流程/架构图。设计过程稿不入库。

## 20.2 维护规则

删除文件、替换 schema、切换 canonical 数据源时，应在同一次清理中同步总地图和受影响的 spec。文档中不应继续把已经删除的旧入口写成当前路径。

参考项目文档（如 `reference-memory-system.md` 中的外部工程路径）必须明确标注来源，不把参考项目的 `src/...` 路径当成本仓库文件。
