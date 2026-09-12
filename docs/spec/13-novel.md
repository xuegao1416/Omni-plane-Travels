> 本文档为 PROJECT_FUNCTIONAL_SPEC.md 的小说系统分册，以当前源码为准。

## 13、小说拆解与世界书

世界大厅顶部和世界浏览页复用 NovelImportWorkbench。五个页面为来源与章节、分析任务、世界资料、剧情资料、创建世界。v2.8.3 已接通世界书与固定导演主线：剧情材料经定义编译、人工修订和版本保存后，在开局绑定；不会直接创建数值规则。

### 导入与来源

- plainText.ts：按字节识别 UTF-8/BOM/GB18030，可手选编码；识别章、卷、番外、序章及粘连在上一段末尾的连续编号标题。保留前文与疑似非正文，报告疑似缺章。
- epubImport.ts：按 OPF spine 阅读，用 NCX/nav 标题和锚点补充章节边界；报告缺失资源、图片章节和加密内容。
- datasetImport.ts：导入原生数据集或中文拆解档案，校验版本、ID、关联和来源，允许仅静态资料。普通世界 JSON 仍走原世界导入。同 ID 导入默认副本。
- segmentation.ts / workbenchState.ts：默认约 6,000 估算 token，支持按章及自定义范围。章节、分析段、检索块分开保存；来源使用章节内偏移和版本，结构调整后保留未变化结果。

### 分析与检索

analysisRunner.ts 执行逐段证据提取、完整档案归并和顺序剧情编译。archiveCompiler.ts 为实体生成稳定 ID，先确定性去重，再按候选组归并；失败保留候选。完整人物、势力、地点、物品不依赖最后一次总览响应；总览分层、有预算并保存检查点。

analysisClient.ts / analysisSchema.ts 约束结构化输出，允许一次格式修复，证据及剧情截断时拆小输入重试。每个事件必须有自己的原文引用，不能用章首摘录替代事件证据；当前分析版本为 4，重新分析淘汰旧缓存但不自动改写已保存固定主线。弱推断不能成为硬约束。requestScheduler.ts 按端点共享并发上限 2；429 后降低并发，遵守 Retry-After；配额、认证错误立即返回，临时故障有限重试。

semanticIndex.ts 同时实现基础检索和批量向量索引（没有独立 embeddingBatches.ts）。默认约 500 token 一块，每批 8 块保存；标题、内容、模型、服务参与缓存身份。真实请求验证向量，支持取消、超时及基础检索降级。关闭向量不重做有效证据提取。最多检索 8 块，输入渲染另设预算。

novelConfigStore.ts 保存独立生成 API 配置并复用项目密钥库。embedding 可关闭、继承项目配置或指定本地服务，不依赖聊天记忆开关。

### 存储与任务

src/storage/db.ts 当前数据库为 v10，支持上一正式版 2.8.2 的 DB v5 及中间 v6～v9 直接升级：在同一事务中补齐缺失表和索引、修正分段复合索引，不改写既有记录；新安装直接创建当前结构。升级失败时回滚并允许重试。novelStore.ts 是 IndexedDB 访问层，不是 Zustand store。原文、材料、章节、分段、分块、任务、档案和归并检查点分表；资料列表仅读头部与计数。迁移实现在 db.ts，没有独立 storageMigration.ts。

同一数据集仅一个分析写入者，支持 Web Locks。关闭工作台取消在途请求并保存检查点，恢复继续未完成单元。部分范围、失败和读取错误不标为全书完成。getNovelPlotRange(datasetId,start,end) 按分析分段索引范围返回剧情；getNovelRuntimeWindow 保留原有邻段读取。导演基于事件及全局结构编译阶段，不将分析段直接用作游戏阶段。

### 世界接入

worldFactory.ts 区分不可用、仅静态、部分、完整资料。worldBookAdapter.ts 将精简概览和规则常驻，人物、势力、地点、物品按名称别名触发。条目有 novelProvenance，世界有 novelSource；世界实际叙事源仍是其 worldBookEntries。

世界详情、表单、世界书编辑器支持物品分类并保留绑定。重生成只替换未手工修改条目；手工修改、冲突及此次缺失条目保留待复核。小说世界资料包包含数据集、世界及绑定的导演定义依赖，不含 API 密钥，向量可重建。世界兼容逻辑在工厂、适配器及表单，没有独立 worldCompatibility.ts。

存在剧情分段时，创建小说世界前必须通过 DirectorAuthorEditor 整理并保存主线版本。开局提供自创角色、原作角色及起点选择；固定版本、阶段与导演状态随存档携带，世界模板后续修改不自动替换已开始的旅程。

### 开发验证

bun test src/novel 覆盖导入、来源、迁移、批次恢复、取消、档案保留及原生世界兼容。scripts/novel-validate.ts 从环境变量读取真实 API；scripts/novel-retrieval-validate.ts 接收外部标注，验证基础、真实向量和降级检索。脚本不包含指定小说或密钥特判。

本机 LM Studio 服务为 http://127.0.0.1:1234/v1，模型 ID novel-bge-m3，BGE-M3 Q8_0，1024 维，GPU 加载约 605 MiB。服务开启 CORS 供浏览器调用。用户可直接关闭 embedding，不要求安装 LM Studio。

2026-09-12：小说拆解与剧情导演已完成本次交付。用户确认小说世界开局、剧情绑定和首轮回复正常，并确认跨设备导入续玩、新回复落盘后主线版本和阶段保持。
