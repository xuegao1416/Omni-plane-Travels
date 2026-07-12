# 贡献指南（CONTRIBUTING）

感谢你考虑为 **世界漫游指南 (Omniplane Travels)** 做出贡献！这是一个本地优先、用户自带 API Key 的「可玩 AI 互动小说引擎」，面向硬核叙事 + 游戏化玩家（工具向）。我们欢迎一切能让引擎更强大、更可靠的贡献。

> 本指南只覆盖协作流程。技术架构与本地构建请先阅读 [README.md](README.md) 与 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

---

## 1. 行为准则（Code of Conduct）

- 以尊重、建设性的方式交流；不接受骚扰、歧视、人身攻击。
- 分享内容须遵守 [docs/content-policy.md](docs/content-policy.md)（NSFW 边界、合规要求）。
- 争议以 Issue / Discussion 公开讨论解决，避免私下升级。

## 2. 提交流程

1. **先开 Issue 讨论**：新功能、破坏性改动、依赖升级请先提 Issue（或 Discussion），对齐范围再动手，避免重复劳动。
2. **Fork + 分支**：从 `main` 切出描述性分支，如 `fix/api-key-storage`、`feat/world-export`。
3. **本地验证**：
   - `bun install`
   - `bun run dev`（开发联调）
   - `bun run build`（确认生产构建通过、多 chunk 正常输出）
   - 涉及纯函数（variableManager / responseExtractor / rateLimiter / db 迁移）请补或更新单测。
4. **提交信息**：使用清晰的中文或英文描述，**说明「为什么」而非仅「改了什么」**。例如：
   - `fix: 加密 API Key 存储，消除明文 localStorage 泄露`
   - `feat: 世界 JSON 导入导出，支持跨设备迁移`
5. **PR**：
   - 关联对应 Issue，填明改动点、验证方式、截图（如有 UI 改动）。
   - 通过 CI 与必要的代码评审后方可合并。
   - 大 PR 请拆小，便于评审。

## 3. 改动范围约定

- **安全 / 稳定（G0）**：API Key 存储、iframe 净化、CSP、流式超时、依赖钉定——任何相关改动需同侪评审 + 实测验证，不得静默降级。
- **发布就绪（G1）**：文档、法律、引导、主题一致性、a11y、核心单测——随 PR 一起补齐。
- **生态 / 增长（G2）**：社区、跨端、度量、i18n——在 Backlog 中按 RICE 排期，鼓励认领。

## 4. 文档贡献

- 教程、FAQ、隐私政策、内容政策、治理文档位于 `docs/` 或仓库根目录（如 `PRIVACY.md`、`CONTRIBUTING.md`）。
- **文档项不要求改动应用代码**。修正错别字、补充示例、翻译均可直接提 PR。
- 改完文档请同步确认 README / 落地页的链接仍然有效。

## 5. 许可

- 本项目以 [MIT License](LICENSE) 发布。
- 提交贡献即表示你同意以相同许可授权你的改动。
- 第三方移植/授权部分（如记忆系统）已在 README「致谢」中标注，引用请保留原作者署名。

## 6. 安全披露

- 若发现安全漏洞（尤其是 API Key 泄露、iframe 沙箱逃逸、CSP 配置缺失），**请勿公开 Issue**。
- 通过私有渠道或 GitHub Security Advisory 上报，我们将优先处理。
