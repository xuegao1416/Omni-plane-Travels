> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（17、安全与基础设施）。
> 总索引见 `../PROJECT_FUNCTIONAL_SPEC.md`。

## 17、安全与基础设施

### 17.1 密钥保险库 — `src/security/keyVault.ts`

API Key / Token 的本地加密存储(使用 Web Crypto API)。

### 17.2 Schema — `src/schema/variables.ts`

变量系统的标准化 schema(用于跨模块数据交换)。

### 17.3 类型 — `src/types/worldbook.ts`

跨模块共享的类型(主要是世界书相关的扩展类型)。

### 17.4 配置 — `src/config/`

| 文件               | 职责                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `api.ts`         | **仅** `REQUEST_CONFIG` 常量:`credentials: 'include'` + `Content-Type` header — **没有**超时/重试/默认 baseUrl,这些都在 `src/api/client.ts` |
| `storageKeys.ts` | 存储键常量(localStorage/IndexedDB key 名)                                                                                          |

### 17.5 常量 — `src/constants/`

| 文件                      | 职责                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `breakpoints.ts`        | 响应式断点常量                                                                                        |
| `simulationDisplay.tsx` | export 4 个映射常量:`LEVEL_ICONS` / `LEVEL_COLORS` / `URGENCY_ICONS` / `URGENCY_LABELS`(**无格式化函数**) |

---

