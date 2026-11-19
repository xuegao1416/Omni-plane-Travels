> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（17、安全与基础设施）。
> 总索引见仓库根目录的 `PROJECT_FUNCTIONAL_SPEC.md`（相对本文件为 `../../PROJECT_FUNCTIONAL_SPEC.md`）。

## 17、安全与基础设施

### 17.1 密钥保险库 — `src/security/keyVault.ts`（123 行）

API Key / Token 的本地加密存储，方案是「**降低静态存储暴露**」而非「防御同源脚本」——文件头注释（`:3-4`）已明确这一点。

- 存储：IndexedDB `omni-plane-travels-keyvault`（`:7`）的 `keys` object store，固定记录 id `'api-encryption-key'`（`:9`）。
- 密钥：`crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt','decrypt'])`（`:38-42`），**`extractable: false`**，持久化在 IndexedDB（结构化克隆支持 `CryptoKey`）。密钥按源（origin）独立生成——Tauri webview / 浏览器 / 不同源各一套。
- 密文格式：`enc:v1:<base64(iv|cipher)>`，`ENC_PREFIX = 'enc:v1:'`（`:11`），IV 12 字节（`:12`）。
- **没有 KDF、没有口令**——密钥不可导出，所以也不存在「用口令派生密钥」这条路径。
- 导出面（`:17/:70/:80/:81/:83/:109`）：`ENC_PREFIX`、`isSealed(value)`、类型 `SealResult` / `UnsealResult`、`sealResult(plaintext)`、`unsealResult(sealed)`。降级时返回 `status: 'degraded'` 并带 `warning`，而不是抛错阻断主流程。

### 17.2 Schema — `src/schema/variables.ts`

变量系统的标准化 schema(用于跨模块数据交换)。438 行，全部是 `interface` / `type` 声明。

### 17.3 类型 — `src/types/worldbook.ts`

跨模块共享的类型(主要是世界书相关的扩展类型)。

### 17.4 配置 — `src/config/`

| 文件 | 职责 |
| --- | --- |
| `api.ts` | 后端 API 配置，**68 行、5 个导出**：`API_BASE_URL`（`:6`，同源部署为空字符串）、`API_ENDPOINTS`（`:9-36`：auth 6 个 / saves 4 个 / workshop 7 个）、`REQUEST_CONFIG`（`:39-44`：`credentials: 'include'` + `Content-Type: application/json`）、`fetchWithAuth(url, options)`（`:47`，401 抛 `未授权`）、`parseResponse<T>(response)`（`:61`，非 ok 时取 `error.message` 抛出）。超时/重试/模型端点仍在 `src/api/client.ts` |
| `storageKeys.ts` | 存储键常量(localStorage/IndexedDB key 名) |
| `version.ts` | `export const APP_VERSION = version;`（从 `package.json` 读入后转出） |

### 17.5 常量 — `src/constants/`

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `breakpoints.ts` | 22 | 响应式断点常量 |
| `simulationDisplay.tsx` | 41 | export 4 个映射常量：`LEVEL_ICONS`（`:12`）/ `LEVEL_COLORS`（`:21`）/ `URGENCY_ICONS`（`:30`）/ `URGENCY_LABELS`（`:37`）（**无格式化函数**） |

### 17.6 服务端认证与限流 — `src/server/`

后端认证面（此前文档缺失）：

- `src/server/crypto.ts`：`bytesToB64url`（`:31`）、`b64urlToBytes`（`:36`）、`strToB64url`（`:56`）、`randomBytes`（`:61`）、`randomToken(n = 32)`（`:68`）、`sha256Hex`（`:73`）、`sha256B64url`（`:79`）、`hmacSha256`（`:85`）、`timingSafeEqualStr`（`:97`，恒定时间比较）。
- `src/server/email-auth.ts`：`RATE_LIMIT_WINDOW = 60`（`:15`）秒同一邮箱冷却，命中返回 `429 { error: 'RATE_LIMITED', message: '请稍后再试' }`（`:104-105`）；验证码尝试超限返回 `429 '验证码尝试次数过多，请重新获取'`（`:139`）。
- `src/server/index.ts`：CORS 只放行白名单 Origin（`ALLOWED_ORIGINS` 默认 `tauri://localhost,http://localhost:8788`）与 `tauri://` 前缀（`:37-50`），`OPTIONS` 直接 204；统一 `app.onError` 返回 `500 { error: 'INTERNAL', message: '服务器内部错误' }`（`:56-59`）。

### 17.7 部署入口 — `functions/api/[[route]].ts`

Cloudflare Pages Functions 的 catch-all，只接管 `/api/*`（放在 `functions/api/` 而非 `functions/` 根，避免吞掉 SPA 的静态路由）。整个文件只有一个导出：

```typescript
export const onRequest = async (context: PagesFunctionContext): Promise<Response> =>
  app.fetch(context.request, context.env, context.executionCtx);   // :20-22
```

`env` 即 `wrangler.toml` 绑定；`app` 来自 `src/server/index.ts`，所以 Worker/Pages 与本地开发共用同一份 Hono 应用。

### 17.8 Trial 用量的实际状态

`migrations/` 里有 `0006_trial_usage.sql` / `0007_trial_usage_reservations.sql` / `0009_trial_reservation_leases.sql` 三张试用相关的表，但 `src/server/` 与 `functions/` 的 `*.ts` 中 **`trial` 零命中**——即：**DB 侧已预留，服务端尚未接线**。文档不应把它描述成已上线能力。

---
