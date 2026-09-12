> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（18、工具库 — `src/utils/`）。
> 总索引见 `../PROJECT_FUNCTIONAL_SPEC.md`。

## 18、工具库 — `src/utils/`

### 18.1 文本处理

| 文件                     | 职责                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| `markdown.ts`          | Markdown 渲染(自定义解析器)                                                                                            |
| `displayText.ts`       | 文本显示格式化(断句/标点)                                                                                                 |
| `formatNormalize.ts`   | **配方数据归一化**(不是文本格式化)— 导出 `parseKeywordInput`/`normalizeRecipeInputs`/`normalizeRecipeOutput`/`normalizeRecipe` |
| `dialogueMarkup.ts`    | 对话头像协议 JSON 解析                                                                                                 |
| `text-colorization.ts` | 文本着色(基于角色/情绪)                                                                                                  |

### 18.2 NPC 相关

| 文件              | 职责                 |
| --------------- | ------------------ |
| `npcHelpers.ts` | NPC 辅助函数(查找/克隆/合并) |
| `npcStats.ts`   | NPC 属性计算(战斗/技能)    |
| `ageStages.ts`  | 年龄阶段映射             |

### 18.3 网络/IO

| 文件               | 职责                                                              |
| ---------------- | --------------------------------------------------------------- |
| `nativeFetch.ts` | 原生 fetch 封装(超时 abort,54 行,**无重试**)                              |
| `download.ts`    | 仅 export `downloadJSON`,15 行(**无图片保存**)                         |
| `presetIO.ts`    | 预设导入导出                                                          |

### 18.4 角色认知防火墙 — `src/utils/roleCognitionFirewall.ts`

防止 AI 在多角色场景下混淆身份(注入到 system prompt 的规则块)。

### 18.5 正则脚本 — `src/utils/regexScripts.ts`

用户自定义正则脚本(替换/抽取/装饰文本)。

### 18.6 提示词子模块 — `src/utils/prompts/`

按场景分类的提示词片段(供 promptAssembler 引用)。

### 18.7 世界书导入/IO

| 文件                   | 职责                 |
| -------------------- | ------------------ |
| `worldBookImport.ts` | SillyTavern 兼容格式导入 |

### 18.8 音频/年龄

| 文件             | 职责     |
| -------------- | ------ |
| `hallAudio.ts` | 大厅音频控制 |
| `ageStages.ts` | 年龄阶段   |

---

