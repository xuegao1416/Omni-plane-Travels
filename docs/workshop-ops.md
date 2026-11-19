# 创意工坊：部署与运维

本文说明创意工坊服务端怎么部署、升级、配置管理员和日常维护。服务端和网站部署在同一个 Cloudflare Pages 项目里，不需要单独的服务器。

## 1. 组成

| 部分 | 位置 | 说明 |
|---|---|---|
| API 入口 | `functions/api/[[route]].ts` | Pages Functions，把 `/api/*` 交给 Hono 应用 |
| 路由与中间件 | `src/server/index.ts` | 鉴权、CORS、请求体解析、全部工坊路由 |
| 工坊逻辑 | `src/server/workshop.ts` | 内容校验、列表/搜索、版本、评分、收藏、举报、安装计划、管理 |
| 客户端共用协议 | `src/workshop/protocol.ts` | 条目结构、排序、状态、版本号规则（服务端与网页共用） |
| 数据库 | D1，绑定名 `DB` | 表结构在 `migrations/`，工坊相关是 0005、0008、0010 |
| 网页端 | `src/components/workshop/`、`src/workshop/` | 界面、安装/卸载/更新流程、发布 |

`bun run dev` 启动的是只打包前端的 Bun 服务器，**没有 API**。要在本地调试工坊，按第 3 节用 `wrangler pages dev`。

## 2. 首次部署

以下命令在仓库根目录执行，需要 Node 和 `bunx wrangler`（`wrangler` 已在 devDependencies 里）。

1. 登录 Cloudflare：
   ```bash
   bunx wrangler login
   ```
2. 创建数据库（已有数据库就跳过），把输出里的 `database_id` 填进 `wrangler.toml` 的 `[[d1_databases]]`：
   ```bash
   bunx wrangler d1 create omni-travels
   ```
3. 执行全部迁移（0001 到 0010，按文件名顺序，执行过的会自动跳过）：
   ```bash
   bunx wrangler d1 migrations apply omni-travels --remote
   ```
4. 配置密钥（每条命令会提示输入值）：
   ```bash
   bunx wrangler pages secret put SESSION_SECRET --project-name omni-plane-travels   # openssl rand -hex 32
   bunx wrangler pages secret put BREVO_API_KEY --project-name omni-plane-travels
   bunx wrangler pages secret put EMAIL_FROM --project-name omni-plane-travels       # Brevo 里验证过的发件地址
   # 可选
   bunx wrangler pages secret put ALLOWED_ORIGINS --project-name omni-plane-travels
   bunx wrangler pages secret put WORKSHOP_ADMIN_IDS --project-name omni-plane-travels
   ```
5. 构建并发布：
   ```bash
   bun run build
   bunx wrangler pages deploy dist --project-name omni-plane-travels
   ```
6. 检查：打开 `https://<你的域名>/api/health`，应返回 `{"ok":true}`；再打开 `https://<你的域名>/api/workshop`，应返回 `{"items":[],...}`。

| 变量 | 必需 | 作用 |
|---|---|---|
| `SESSION_SECRET` | 是 | 会话令牌的 HMAC 密钥；也用来给匿名下载去重的摘要加盐。更换后所有人需要重新登录 |
| `BREVO_API_KEY` | 是 | 发送注册/重置密码的验证码邮件 |
| `EMAIL_FROM` | 是 | 验证码邮件的发件人 |
| `ALLOWED_ORIGINS` | 否 | 允许跨域访问的 Origin（逗号分隔）。`tauri://` 开头的桌面端 Origin 默认放行 |
| `WORKSHOP_ADMIN_IDS` | 否 | 工坊管理员的用户 id（逗号分隔），见第 5 节 |

## 3. 本地联调

```bash
cp .dev.vars.example .dev.vars          # 填入真实值；.dev.vars 不进仓库
bunx wrangler d1 migrations apply omni-travels --local
bun run build
bunx wrangler pages dev dist            # http://localhost:8788
```

改了前端要重新 `bun run build`；改了 `src/server` 下的代码，`wrangler pages dev` 会自动重载。

## 4. 从旧版本升级（迁移 0010）

0010 会重建 `workshop_items` 表：旧表的 `type` 列有 CHECK 约束，只允许 4 种类型，新类型以前只能伪装成 `world_package` 存储。SQLite 删不掉 CHECK，所以迁移会新建表、拷贝数据、替换旧表，并建立版本历史、评分、收藏、举报、下载去重几张新表，给 `users` 加上 `display_name`。

旧数据的处理方式：

- 真实类型取旧的 `content_type`。
- `draft` 状态改为 `unlisted`（不公开列出）。
- 人物预设、人生经历这两种私有类型一律改为 `hidden`，不会再被任何接口返回。
- 每个条目的当前内容写成版本历史里的第一个版本。
- 用户密码哈希保持不变。

### 发布顺序

- 如果 Pages 项目是 **Git 自动部署**，推送或合并到生产分支就等于开始部署。必须先完成下面的数据库迁移，再推送 `v3.0` 到生产分支；合并后等待部署完成。
- 如果是 **手动部署**，可以先提交或推送到非生产分支，先执行 `bun run build`，再迁移数据库，随后立刻 `wrangler pages deploy dist`。
- 从迁移完成到新版部署完成之间，旧服务端会继续查询即将被删除的 `content_type` 列，工坊列表、详情、发布和下载都会报错；登录和云存档不受影响。先把构建产物准备好，可以把这段时间压缩到一次部署的长度，并尽量选择低访问时段操作。

下面所有命令都在仓库根目录执行。

### 迁移前

1. 登录并确认目标库支持 Time Travel：

   ```bash
   bunx wrangler login
   bunx wrangler d1 info omni-travels      # version 应该是 production
   ```

2. **确认只剩 0010 没执行，这是最重要的一步：**

   ```bash
   bunx wrangler d1 migrations list omni-travels --remote
   ```

   列表里应该只有 `0010_workshop_v3.sql`。如果 `0001`–`0009` 也出现在待执行列表里，**立即停止，不要执行 apply**，并把输出发出来排查。原因是 `0002_email_auth.sql` 会重建 `users` 表，重跑会丢掉 `0003_password_login.sql` 加的 `password_hash` 列，所有人的密码都会失效。数据库当初如果是用 `wrangler d1 execute --file` 手动建的，就可能出现这种状态。

3. 先把网站构建好：

   ```bash
   bun run build
   ```

4. 导出备份并记录迁移前行数：

   ```bash
   bunx wrangler d1 export omni-travels --remote --output=../backup-before-0010.sql
   bunx wrangler d1 execute omni-travels --remote --command "SELECT status, COUNT(*) AS n FROM workshop_items GROUP BY status"
   ```

   备份写在仓库外，里面包含邮箱和密码哈希，**不要提交到 git**。导出期间数据库会暂停响应其他请求；库小的话通常只要几秒。

5. （建议）在本地彩排：

   ```bash
   bunx wrangler d1 execute omni-travels --local --persist-to=../d1-rehearsal --file=../backup-before-0010.sql
   bunx wrangler d1 migrations list omni-travels --local --persist-to=../d1-rehearsal   # 应只列出 0010
   bunx wrangler d1 migrations apply omni-travels --local --persist-to=../d1-rehearsal
   bunx wrangler d1 execute omni-travels --local --persist-to=../d1-rehearsal --command "SELECT status, COUNT(*) AS n FROM workshop_items GROUP BY status"
   ```

   预期结果：总行数不变，`draft` 变成 `unlisted`，人物预设和人生经历变成 `hidden`。

### 正式迁移

6. 记录回滚点，然后执行迁移：

   ```bash
   bunx wrangler d1 time-travel info omni-travels         # 复制输出里的 bookmark
   bunx wrangler d1 migrations apply omni-travels --remote # 提示确认时输入 y
   ```

7. 立刻部署新版网站。

   如果 Pages 项目是 Git 自动部署，此时推送或合并 `v3.0` 到生产分支，等待部署完成。手动部署则执行：

   ```bash
   bunx wrangler pages secret put EMAIL_FROM --project-name omni-plane-travels   # 之前漏掉的必填项，只需设置一次
   bunx wrangler pages deploy dist --project-name omni-plane-travels
   ```

8. 检查结果：

   ```bash
   bunx wrangler d1 migrations list omni-travels --remote   # 应提示没有待执行的迁移
   bunx wrangler d1 execute omni-travels --remote --command "SELECT (SELECT COUNT(*) FROM workshop_items) AS items, (SELECT COUNT(*) FROM workshop_versions) AS versions"
   ```

   `items` 应等于第 4 步记录的总数，`versions` 应等于 `items`。最后打开 `https://<域名>/api/health` 和 `/api/workshop`，确认接口正常。

### 出问题时的回滚

```bash
bunx wrangler d1 time-travel restore omni-travels --bookmark=<第 6 步记下的书签>
```

然后在 Cloudflare 控制台把 Pages 回滚到上一次部署：项目 → Deployments → 上一个版本 → Rollback。

恢复会直接覆盖整个数据库，书签之后的所有写入都会丢失，包括新注册账号。书签保留 30 天（Workers 付费版）或 7 天（免费版）。如果 apply 中途报错，不要直接重跑：先用书签恢复，查清原因后再执行。

部署后旧版桌面端从工坊安装内容会失败，因为它调用的旧接口 `install-check` 已经删除；用户更新到新版桌面端后恢复正常。

参考资料：Cloudflare D1 Time Travel、D1 导入导出、D1 迁移。

## 5. 管理员

1. 查出管理员账号的用户 id：
   ```bash
   bunx wrangler d1 execute omni-travels --remote --command "SELECT id, email FROM users WHERE email = 'you@example.com'"
   ```
2. 把 id 写进 `WORKSHOP_ADMIN_IDS`（多个用逗号分隔），重新部署或在 Cloudflare 控制台保存后生效。
3. 管理员登录后，工坊里会多出“举报处理”分区；作品详情里会多出“设为精选 / 取消精选”和“下架 / 恢复上架”。

举报规则：每个账号对同一作品只能有一条待处理举报；不同举报人的待处理举报达到 5 条时，作品自动改为 `hidden`（下架），等待管理员复核。作者看得到自己被下架的作品、可以继续修改，但不能自己恢复上架。

## 6. 条目状态与规则

| 状态 | 发现页 | 凭链接/依赖安装 | 说明 |
|---|---|---|---|
| `published` | 显示 | 可以 | 默认 |
| `unlisted` | 不显示 | 可以 | 作者设置的“不公开列出” |
| `archived` | 不显示 | 不可以 | 作者归档；已安装的玩家能看到“作者已归档” |
| `hidden` | 不显示 | 不可以 | 被举报自动下架或管理员下架 |
| `deleted` | 不显示 | 不可以 | 作者删除（软删除）：保留标题等元数据，内容和历史版本立即清除，依赖它的作品会提示“依赖已删除” |

其他规则：

- 单个作品的内容不超过 1 MB（按 UTF-8 字节计算）。图片请用截图链接，不要内嵌进 JSON。
- 带新内容的修改就是发布新版本：版本号必须比当前高，否则返回 409 和建议的版本号。只改标题、说明、标签、截图、推荐搭配不需要升版本。依赖、最低应用版本、兼容信息属于版本内容，只能随新版本一起改。
- 每个作品保留最近 10 个版本，可以按版本下载。
- 发布时依赖必须指向仍可安装的作品，不能依赖自己，也不能形成循环。
- 下载次数按“同一账号或同一设备每天一次”计数。匿名用户按网页生成的随机设备 id 计；没有设备 id 时才用 IP+UA 的加盐摘要，数据库里不保存 IP 原文。去重标记两天后自动清理。
- 作者名显示 `users.display_name`（玩家在“我的发布”里设置）；没设置时显示“旅者·”加用户 id 前 6 位，不会暴露邮箱。

## 7. 常用维护 SQL

用 `bunx wrangler d1 execute omni-travels --remote --command "<SQL>"` 执行。

```sql
-- 待处理举报最多的作品
SELECT item_id, COUNT(*) AS reports FROM workshop_reports WHERE status = 'open' GROUP BY item_id ORDER BY reports DESC LIMIT 20;

-- 被下架的作品
SELECT id, title, owner_id, updated_at FROM workshop_items WHERE status = 'hidden';

-- 恢复上架（也可以在作品详情里用管理员按钮）
UPDATE workshop_items SET status = 'published' WHERE id = '<作品 id>';

-- 彻底清除 90 天前软删除的作品
DELETE FROM workshop_ratings   WHERE item_id IN (SELECT id FROM workshop_items WHERE status = 'deleted' AND deleted_at < (strftime('%s','now') - 90*86400) * 1000);
DELETE FROM workshop_reports   WHERE item_id IN (SELECT id FROM workshop_items WHERE status = 'deleted' AND deleted_at < (strftime('%s','now') - 90*86400) * 1000);
DELETE FROM workshop_items     WHERE status = 'deleted' AND deleted_at < (strftime('%s','now') - 90*86400) * 1000;

-- 占用空间最大的作品（含历史版本）
SELECT item_id, SUM(data_size) AS bytes, COUNT(*) AS versions FROM workshop_versions GROUP BY item_id ORDER BY bytes DESC LIMIT 20;
```

## 8. 接口一览

公开接口不需要登录；带“登录”的需要会话 Cookie 或 `Authorization: Bearer <令牌>`。

| 方法与路径 | 权限 | 作用 |
|---|---|---|
| `GET /api/workshop` | 公开 | 列表。参数：`q` 搜索、`type`、`tag`、`author`、`sort`（`latest` `updated` `downloads` `rating` `favorites` `featured`，旧值 `popular` 等同 `downloads`）、`page`、`pageSize`（≤50） |
| `GET /api/workshop/:id` | 公开 | 详情（含内容）。登录时附带 `viewer`：是否作者、我的评分、是否收藏、是否已举报 |
| `GET /api/workshop/:id/install-plan` | 公开 | 依赖在前、作品在后的安装顺序；有问题时返回 409 和 `errors`（`MISSING` `INCOMPATIBLE` `CYCLE` `UNAVAILABLE`） |
| `GET /api/workshop/:id/versions` | 公开 | 版本历史 |
| `GET /api/workshop/:id/download?version=` | 公开 | 下载内容（默认最新版本），计入下载次数 |
| `GET /api/workshop/updates?ids=a,b` | 公开 | 批量查最新版本与状态（最多 100 个），客户端用来提示更新 |
| `GET /api/workshop/mine` | 登录 | 我的作品（含不公开、归档、被下架） |
| `GET /api/workshop/favorites` | 登录 | 我的收藏 |
| `POST /api/workshop` | 登录 | 发布新作品 |
| `PUT /api/workshop/:id` | 作者 | 修改信息或发布新版本；支持 `expectedVersion` 或 `If-Match` 防止覆盖别处的修改 |
| `PATCH /api/workshop/:id/status` | 作者 | `published` / `unlisted` / `archived` |
| `DELETE /api/workshop/:id` | 作者 | 软删除 |
| `PUT` / `DELETE /api/workshop/:id/rating` | 登录 | 评分 1–5 / 清除评分（不能给自己评分） |
| `PUT` / `DELETE /api/workshop/:id/favorite` | 登录 | 收藏 / 取消收藏 |
| `POST /api/workshop/:id/report` | 登录 | 举报：`reason` 为 `spam` `offensive` `copyright` `malicious` `broken` `other`，可附 `detail` |
| `PUT /api/me/profile` | 登录 | 设置作者昵称 `displayName`（≤32 字） |
| `GET /api/workshop/admin/reports?status=` | 管理员 | 举报列表（`open` `resolved` `dismissed`） |
| `POST /api/workshop/admin/reports/:reportId` | 管理员 | `action`: `dismiss` 驳回 / `resolve` 属实；`hideItem: true` 同时下架 |
| `PATCH /api/workshop/admin/items/:id` | 管理员 | `featured`（精选）与 `status`（`published` / `hidden`） |

错误统一返回 `{ "error": "<错误码>", "message": "<中文说明>" }`；请求体不是合法 JSON 时返回 400 `INVALID_JSON`。

## 9. 桌面版（Tauri）

桌面版页面不在你的域名下，必须在打包前告诉它 API 地址：

```bash
OMNI_API_BASE=https://<你的域名> bun run build
# 然后按 docs/native-build.md 打包 Tauri
```

桌面端登录后，服务端把令牌放在响应体里，客户端存进本机并在之后的请求里带上 `Authorization: Bearer`。`tauri://` 开头的 Origin 默认允许跨域；如果你的桌面端 Origin 不是这种形式，把它加进 `ALLOWED_ORIGINS`。

已知限制：桌面版的事件包由原生端管理，从工坊安装的事件包、工作流包、冒险包写在网页端的事件库里，桌面版目前读不到；世界包、玩法模块、NPC 模板、视觉主题不受影响。

## 10. 内容格式速查（给作者）

世界包、NPC 模板、玩法模块、事件包、工作流包沿用游戏里导出的 JSON。下面两种是工坊专用格式。

**冒险包**（安装后编译成一组事件卡，默认停用，在“已安装”里启用）：

```json
{
  "id": "lost-temple",
  "name": "失落神殿",
  "description": "一段短冒险",
  "worldId": "可选：只在这个世界出现",
  "start": { "on": ["turn.ended"], "once": true },
  "scenes": [
    { "id": "gate", "title": "神殿大门", "text": "石门半掩。",
      "options": [
        { "label": "推门而入", "next": "hall", "effects": [{ "stat": "attrB", "delta": -5 }] },
        { "label": "离开" }
      ] },
    { "id": "hall", "title": "大厅", "text": "壁画在火光里晃动。" }
  ]
}
```

- `scenes` 也可以写成 `chapters` 或 `steps`，1 到 64 个场景，场景 id 用字母、数字、下划线、短横线。
- 第一个场景按 `start` 触发（默认：启用后的第一个回合结束时出现一次）；其他场景通过选项的 `next` 接续，不会进随机牌堆。
- 没写选项的场景会自动生成“继续”接到下一个场景；最后一个场景生成“结束这段冒险”。
- 选项支持与事件卡相同的 `effects`、`check`、`success`、`failure`、`requires`；场景也可以写自己的 `trigger`（例如某个旗标为真时开始第二章）。
- 没有任何选项通向、也没有自己触发器的场景会在安装时跳过并提示。

**视觉主题**（在“已安装”里“使用主题”，再点一次恢复默认）：

```json
{
  "id": "bronze-dusk",
  "name": "青铜暮色",
  "tokens": { "--d-gold": "#d9a55b" },
  "themes": {
    "night": { "--d-cream": "246, 230, 196" },
    "dawn":  { "--d-ink": "#2f3e46" }
  }
}
```

- 只能改 `--d-` 开头的颜色变量，值为 `#rgb`、`#rrggbb` 或 `r, g, b`。
- `tokens`（也可写 `variables`、`theme`）对两套主题都生效，`themes.night` / `themes.dawn` 分别覆盖。
