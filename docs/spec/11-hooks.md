> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（11、React Hooks 集合 — `src/hooks/`）。
> 总索引见 `../PROJECT_FUNCTIONAL_SPEC.md`。

## 11、React Hooks 集合 — `src/hooks/`

### 11.1 AI 填充/生成

| 文件                  | 职责                     |
| ------------------- | ---------------------- |
| `useAiFill.ts`      | AI 自动填充表单字段(角色创建/玩家画像) |
| `useImageGen.ts`    | 头像/场景图像生成              |
| `useNpcFill.ts`     | NPC 数据填充               |
| `npcFillMapping.ts` | NPC 字段映射规则             |

### 11.2 角色相关

| 文件                        | 职责           |
| ------------------------- | ------------ |
| `useCharacterHistory.ts`  | 角色历史文本的 CRUD |
| `useCharacterPortrait.ts` | 角色头像加载/缓存    |

### 11.3 UI 工具

| 文件                         | 职责                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `useBodyScrollLock.ts`     | body 滚动锁(对话框/全屏时)                                                                    |
| `bodyScrollLockManager.ts` | 滚动锁管理器(避免冲突)                                                                         |
| `useIsMobile.ts`           | 响应式 hook 集合：`useBreakpoint` / `useIsPhone` / `useMediaQuery`；已移除无人使用的旧 `useIsMobile` 包装层 |

### 11.4 向导 — `useWizard.ts`

多步表单向导 hook(角色创建/世界选择/试玩配置)。

---

