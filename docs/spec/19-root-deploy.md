> 本文档对应 `PROJECT_FUNCTIONAL_SPEC.md` §19。实际文件存在性以当前仓库为准。

# 19、根目录与部署

## 19.1 Bun 开发/生产构建

| 文件 | 职责 |
|---|---|
| `server.ts` | Bun 本地开发服务器；按请求构建前端入口并提供静态资源 |
| `build.ts` | Bun production build，生成 `dist/` |
| `index.html` | SPA HTML 入口 |
| `package.json` | dev/build/test/typecheck/Tauri 脚本与依赖 |
| `bun.lock` / `bunfig.toml` | Bun 锁文件与配置 |

项目直接依赖 Bun API（`Bun.serve` / `Bun.build` / `Bun.file`），Node 不能等价替代运行时。

`devDependencies.bun = 1.3.14` 保留：在只提供 npm/Node 的 CI 或 Cloudflare 构建环境中，`npm run <script>` 会把 `node_modules/.bin` 加入 PATH，因此脚本内的 `bun` 仍可解析到 npm 安装的本地 Bun 二进制；无需额外套 `npx --no-install`。

## 19.2 Cloudflare

| 路径 | 职责 |
|---|---|
| `wrangler.toml` | Workers/Wrangler 配置 |
| `src/server/` | Worker 后端业务（认证、云存档、工坊等） |
| `functions/api/[[route]].ts` | Pages Functions 入口 |
| `migrations/` | D1 SQL 迁移历史（0001–0009） |

数据库迁移文件是部署历史，不能按“只留上一代运行时兼容”的规则删除。

## 19.3 PWA / 静态资源

`public/` 是静态资源唯一来源，包含 `manifest.json`、`icon.png`、音频和 UI 美术。`dist/` 是构建产物，不进入源码基线。

## 19.4 Tauri

`package.json` 提供 Tauri 2 桌面/Android 命令与依赖，仓库内包含 `src-tauri/` 原生工程，可直接执行构建。

## 19.5 工具脚本

`scripts/` 提供构建、静态资源复制、小说数据与检索校验、发布元数据和本地测试辅助脚本。
