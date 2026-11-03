> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（16、主题与样式系统）。
> 总索引见 `../PROJECT_FUNCTIONAL_SPEC.md`。

## 16、主题与样式系统

### 16.1 主题系统 — `src/theme/`

| 文件                        | 职责                  |
| ------------------------- | ------------------- |
| `applyAdaptiveTheme.ts`   | 应用自适应主题(DOM/CSS 变量) |
| `resolveAdaptiveTheme.ts` | 根据世界/时间/玩家偏好解析主题    |
| `useAdaptiveTheme.ts`     | React Hook          |
| `registry.ts`             | 主题注册表               |
| `types.ts`                | 主题类型                |

### 16.2 样式系统 — `src/styles/`

17 个 CSS 文件按功能分类:

- 基础:tokens.css / base.css / responsive.css
- 战斗:combat-battle-v3.css / combat-formal.css / combat-wireframe.css
- 创建:creation-ritual.css / creation-tarot.css
- 布局:layout-game.css / layout-settings.css / layout-wizard.css
- 职业:profession-book.css / profession-library.css
- 其他:entry-crystal.css / game-journey.css / custom-modules.css

---

