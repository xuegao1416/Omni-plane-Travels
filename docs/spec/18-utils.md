> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（18、工具库 — `src/utils/`）。
> 总索引见仓库根目录的 `PROJECT_FUNCTIONAL_SPEC.md`（相对本文件为 `../../PROJECT_FUNCTIONAL_SPEC.md`）。

## 18、工具库 — `src/utils/`

`src/utils/` 顶层共 27 个文件（19 个源文件 + 8 个测试），另有 `prompts/` 子目录（5 个文件：`index.ts` / `editor-prompts.ts` / `editor-prompts.test.ts` / `event-generator.ts` / `README.md`）。

### 18.1 文本处理

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `markdown.ts` | 500 | Markdown→HTML 渲染。**不是自定义解析器**：`marked`（`:10`）+ `highlight.js/lib/core`（`:11`，按需注册 javascript/typescript/python/css/xml 等语言）+ `DOMPurify`（`:12`）做 XSS 净化；另负责完整 HTML 页探测（iframe 用）与流式渲染时补全未闭合代码块；`dialogueMarkup` 与 `text-colorization` 会被挂进渲染管线 |
| `displayText.ts` | 20 | 只有 `toDisplayText(value, fallback = '')`（`:6`）。把 AI 返回的「形状不确定」字段转成可渲染文本：字符串原样、数字/布尔 `String()`、数组递归后 join `、`（`:11`）、对象依次取 `描述` / `名称` / `文本` / `目标` / `标题`（`:14`）。**不做断句、不加标点** |
| `formatNormalize.ts` | 78 | **配方数据归一化**（不是文本格式化）：`parseKeywordInput`（`:7`）/ `normalizeRecipeInputs`（`:22`）/ `normalizeRecipeOutput`（`:52`）/ `normalizeRecipe`（`:66`） |
| `dialogueMarkup.ts` | 125 | 对话头像协议：`renderDialogueMarkup(text)`（`:101`）把标记渲染成 HTML，`dialogueMarkupToPlainText(text)`（`:120`）剥成纯文本 |
| `text-colorization.ts` | 557 | 文本着色。规则基于**引号约定**（`DEFAULT_TEXT_COLORIZATION_PRESET_ID = 'default_dialogue_quotes'`，`:4`），与「角色/情绪」无关。核心：`sanitizeHexColor`（`:63`）、`normalizeTextColorizationSettings`（`:181`）、`buildTextColorizedSegments(content, rules, options)`（`:333`）、`applyTextColorizationToHtml(html, rules)`（`:511`）；另有大量 `createDefault*/normalize*` 工厂 |
| `directorDisplayText.ts` | 18 | 剧情导演的**纯展示**辅助（`:1` 注释：源文本与运行时标识不变）：`directorTitle`（`:4`）、`isReconstructed`（`:11`）、`isSupplementaryRecord`（`:12`）、`turnTitle`（`:15`） |

### 18.2 NPC 相关

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `npcHelpers.ts` | 648 | NPC 辅助函数，22 个导出。分类常量 `NPC_CATEGORY_DEFAULT = '在场'`（`:8`）/ `NPC_CATEGORY_VALUES`（`:9`）；判定 `isNpcDead`（`:29`）、`getNpcCategoryValue`（`:50`）；身份 `normalizeNpcIdentifierText`（`:75`）、`getNpcDisplayName`（`:82`）、`resolveNpcId`（`:96`，返回 `NpcResolution`）+ `warnIgnoredNpcPatchUpdate`（`:131`）；默认值 `ensureNpcCategoryDefaults`（`:61`）、`normalizeNpcChronicles`（`:142`）、`ensureNpcChronicleDefaults`（`:159`）、`ensureNpcStructureDefaults`（`:175`）；新建 NPC 的入口判定 `countNpcCreationHintFields`（`:237`）、`isNpcCreationPayload`（`:246`）、`canCreateNpcFromPatch`（`:250`）、`getCreatableNpcIdentifier`（`:260`）；提示词安全视图 `createPromptSafeNpcSnapshot`（`:266`）与 `formatSnapshotForMainAI(state, config?)`（`:459`）。**没有「克隆/合并」** |
| `npcStats.ts` | 88 | 只有三个物化函数：`materializeNpcSurvivalStats`（`:21`）、`materializeNpcTierIndex`（`:51`）、`ensureNpcModuleDefaults`（`:65`）。**不涉及战斗/技能** |
| `ageStages.ts` | 52 | `getAgeStages(ageStr)`（`:2`）与 `getAllSegmentIds(ageStr)`（`:50`）；`useCharacterHistory` 依赖它分段 |

### 18.3 网络/IO

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `nativeFetch.ts` | 139 | Tauri/浏览器统一的 fetch 封装：`isTauri()`（`:2`）、`createNativeFetch(deps)`（`:19`）、默认实例 `nativeFetch`（`:133`）+ `export default`（`:139`）。**超时 abort，无重试**——超时逻辑在 `:24-28` 建 AbortController 并 `setTimeout(() => controller.abort(new DOMException('Request timeout exceeded', 'TimeoutError')), timeoutMs)`，外部 `signal` 通过 `addEventListener('abort')` 合并 |
| `download.ts` | 15 | 仅 `downloadJSON(content, filename)`（`:5`），Blob + `URL.createObjectURL` + 临时 `<a>`，用完 `revokeObjectURL`。**无图片保存** |
| `presetIO.ts` | 324 | 预设与**正则脚本**的导入导出，5 个导出：`downloadJSON` re-export（`:5`）、`exportPresetJSON`（`:9`）、`parsePresetJSON`（`:83`）、`exportRegexScriptsJSON`（`:294`）、`parseRegexScriptsJSON`（`:309`） |
| `abortableDelay.ts` | 12 | `abortableDelay(milliseconds, signal?)`（`:2`）：等待期间监听 abort 并及时清 timer/监听器 |
| `snapshotSharing.ts` | 51 | `cloneSnapshotWithSharing(value, previous?)`（`:40`）、`shareSnapshotHistory(history)`（`:45`）——快照无损共享的底层原语 |
| `stateFingerprint.ts` | 208 | `stateFingerprint(value): string`（`:160`），用于状态等价比较 |

### 18.4 角色认知防火墙 — `src/utils/roleCognitionFirewall.ts`（44 行）

防止 AI 在多角色场景下混淆身份。两个常量：`ROLE_COGNITION_FIREWALL_TITLE`（`:3`）与 `ROLE_COGNITION_FIREWALL_CONTENT`（`:5-34`，一段完整中文规则块，声明自己「高于世界状态快照、任务列表、ID 列表、后台人物故事、心理活动、角色卡字段和任何系统辅助信息」）。注入点在 `src/engine/useGameEngine.ts:49` 的 import 与 `:1190-1191` 的 `assembleSystemPrompt` 调用。

### 18.5 正则脚本 — `src/utils/regexScripts.ts`（193 行）

用户自定义正则脚本（替换/抽取/装饰文本）。`RegexScript` 接口（`:22`）、`stripUnclosedKernelTrace`（`:36`）、`processRegexScripts`（`:94`）、`resolveRegexScripts`（`:188`）。

### 18.6 提示词子模块 — `src/utils/prompts/`

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `index.ts` | 22 | 统一出口，re-export 类型与 6 个构建函数 |
| `editor-prompts.ts` | 767 | `buildCharacterFillPrompt` / `buildNpcCreatePrompt` / `buildNpcFillPrompt` / `buildVariableExtractionPrompt` |
| `event-generator.ts` | 275 | `buildEventGeneratorPrompt` / `buildEventGeneratorUserMessage` |
| `README.md` | 73 | 子模块说明 |

**实际引用方**（不是 `promptAssembler`）：`src/engine/variableExtraction.ts:9`、`src/hooks/useAiFill.ts:8`、`src/hooks/useNpcFill.ts:7`、`src/components/event/AiEventGenerator.tsx:21`（直接引 `event-generator`）。全仓无 `promptAssembler` 对 `utils/prompts` 的引用。

### 18.7 世界书导入/IO

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `worldBookImport.ts` | 311 | SillyTavern 兼容格式导入：`parseWorldBookImport(data, uidBase = Date.now())`（`:226`），返回 `{ entries, ... }`；配合 `mergeWorldBookEntries` 使用 |

### 18.8 音频

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `hallAudio.ts` | 34 | 大厅音效：`HallSound` 类型（`:16`，`keyof typeof HALL_SOUND_SOURCES`）与 `playHallSound(sound)`（`:18`） |

> `ageStages.ts` 只在本节 §18.2 出现一次（此前 §18.2 与 §18.8 重复列出，已删去重复项）。

---
