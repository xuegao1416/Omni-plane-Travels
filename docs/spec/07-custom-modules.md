> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（7、自定义模块系统 — `src/custom-modules/`）。
> 总索引见 `../PROJECT_FUNCTIONAL_SPEC.md`。

## 7、自定义模块系统 — `src/custom-modules/`

允许用户/世界作者编写"独立模块"(自带状态/视图/能力),通过 `engineBridge` 接入游戏。

### 7.1 智能体与会话

| 文件                                   | 职责                     |
| ------------------------------------ | ---------------------- |
| `src/custom-modules/agent.ts`        | 自定义模块的智能体(响应用户输入/调用工具) |
| `src/custom-modules/agentSession.ts` | 智能体会话(对话状态 + 工具调用历史)   |

### 7.2 能力/上下文/桥接

| 文件                                   | 职责                                         |
| ------------------------------------ | ------------------------------------------ |
| `src/custom-modules/capabilities.ts` | 模块能力清单(`capability.read_world_state` 等白名单) |
| `src/custom-modules/context.ts`      | 模块运行上下文(权限/限制/数据访问)                        |
| `src/custom-modules/engineBridge.ts` | 自定义模块与 `§1 核心引擎` 的桥接(安全调用 + 类型适配)          |

### 7.3 运行时/Schema/视图

| 文件                                    | 职责                                                         |
| ------------------------------------- | ---------------------------------------------------------- |
| `src/custom-modules/runtime.ts`       | 仅 export `executeCustomModuleLifecycle`(无"加载/激活/暂停"独立 API) |
| `src/custom-modules/schema.ts`        | 模块 manifest 与配置 schema                                     |
| `src/custom-modules/viewRenderer.tsx` | 模块视图渲染(独立 React 树,可挂载到任意面板)                                |

### 7.4 状态/存储/校验/标准化

| 文件                                     | 职责                       |
| -------------------------------------- | ------------------------ |
| `src/custom-modules/stateStore.ts`     | 模块状态存储(独立于 varMgr,模块私有)  |
| `src/custom-modules/storage.ts`        | 模块持久化(IndexedDB 子分区)     |
| `src/custom-modules/validator.ts`      | 模块 manifest 校验(权限/字段/版本) |
| `src/custom-modules/normalize.ts`      | 模块数据标准化(版本兼容)            |
| `src/custom-modules/manifestSchema.ts` | 包清单 schema               |
| `src/custom-modules/actionExecutor.ts` | 模块动作执行(白名单)              |

**典型用法**:世界作者可以发布一个"修仙模块"(含炼丹/渡劫/宗门管理子系统),玩家加载后即可在游戏中使用,而无需修改核心引擎。

---

