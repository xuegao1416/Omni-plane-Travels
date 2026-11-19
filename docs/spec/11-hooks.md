> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（11、React Hooks 集合 — `src/hooks/`）。
> 总索引见仓库根目录的 `PROJECT_FUNCTIONAL_SPEC.md`（相对本文件为 `../../PROJECT_FUNCTIONAL_SPEC.md`）。

## 11、React Hooks 集合 — `src/hooks/`

### 11.0 创建草稿单例 — `creationDraftOwner.ts`

149 行。角色创建流程的**唯一草稿持有者**，`useWizard` / `useAiFill` / `useCharacterHistory` 全部通过它读写同一份 `CreationDraft`，避免多个 hook 各持一份状态。

- `creationDraftOwner`：模块级单例；`subscribe` / `getSnapshot` 供 `useSyncExternalStore` 订阅。
- `beginOperation(kind)`：发起一次可取消的异步操作（`'history'` 等），返回带 `signal` 的 `CreationDraftOperation`；同 kind 的旧操作会被 abort，保证「重新生成」不会有两个流同时写回。
- `edit(patch)` / `reset(worldId)`：唯一写入口；schema 由 zod 校验。

### 11.1 AI 填充/生成

| 文件                  | 职责                     |
| ------------------- | ---------------------- |
| `useAiFill.ts`      | AI 自动填充表单字段(角色创建/玩家画像)，187 行 |
| `useImageGen.ts`    | 头像/场景图像生成，78 行 |
| `useNpcFill.ts`     | NPC 数据填充，129 行 |
| `npcFillMapping.ts` | NPC 字段映射规则，57 行 |

### 11.2 角色相关

| 文件                        | 职责           |
| ------------------------- | ------------ |
| `useCharacterHistory.ts`  | 按年龄段流式生成角色经历并写回草稿（311 行）：`getAgeStages()` / `getAllSegmentIds()`（`src/utils/ageStages.ts`）决定分段，`draftOwner.beginOperation('history')`（`:38`）发起可取消的流式生成，结果写入 `draft.segments`；不是通用 CRUD |
| `useCharacterPortrait.ts` | 角色头像：加载/缓存 + 提示词构建与翻译。`buildPortraitPrompt(npc)`（`:73`）、`translatePromptWithLLM(npc)`（`:89`）、`useCharacterPortrait()`（`:123`） |
| `useStoredImageUrl.ts`    | 从 `storage/imageDb` 取图的 blob URL lease（67 行）：`imageUrls.acquire(key)` 借用、旧 lease 进 `retired` 后释放；URL 只给显示用，不进存档状态（`:5` 注释） |

### 11.3 UI 工具

| 文件                         | 职责                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `useBodyScrollLock.ts`     | body 滚动锁(对话框/全屏时)                                                                    |
| `bodyScrollLockManager.ts` | 滚动锁管理器(避免冲突)，40 行                                                                         |
| `useIsMobile.ts`           | 响应式 hook 集合：`useBreakpoint`（`:10`）/ `useIsPhone`（`:35`）/ `useMediaQuery`（`:44`）；已移除无人使用的旧 `useIsMobile` 包装层 |

### 11.4 向导 — `useWizard.ts`

149 行，多步表单向导 hook。视图三态 `view: 'main' | 'wizard' | 'saves'`（`:18`），大厅当前世界 `hallWorld`（`:19`，与草稿里的 `selectedWorld` 分离——只有进入向导才切草稿）。

自建世界的增删改与持久化（`:84-122`）：

- `handleSaveWorld(world)`（`:89`）：按 id 覆盖或追加。
- `handleDeleteWorld(worldId, referencedWorldIds)`（`:101`）：先调 `deleteCustomWorldFromList(...)` 校验（内置世界与实际引用不可删），失败原样返回结果。
- `handleImportWorld(world)`（`:115`）、`handleCancelWorldEditor()`（`:109`）。
- `CREATED_WORLDS_KEY` 落 localStorage（`:85`）。

> 说明：本 hook **不含「试玩配置」**概念——试玩/开局走 `resetForNewJourney()`（`:40`）与 `resumeCreationDraft()`（`:41`）。

---
