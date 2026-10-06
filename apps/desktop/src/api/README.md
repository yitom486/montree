# src/api

渲染端 **IPC 客户端**。组件 / Hook **禁止**直接调 `window.electronAPI` 的文件类 API；一律走这里。

有返回值的调用对应主进程 `Result<T, AppError>`；用户取消为 `CANCELLED`（一般不弹错误）。

| 文件 | 功能 |
|------|------|
| `file-api.ts` | 打开/保存/读写文件、工作区、导出、粘贴图等 |
| `app-api.ts` | 应用级：窗口/标题/关闭确认、更新、外部文件与链接、日志、E2E 门控、工作区监听等 |
| `acp-api.ts` | ACP Agent：连接、prompt、权限、配置（IPC 薄封装；类型单一源 `@montree/contracts`，传输/认证/MCP 纯逻辑已独立至 `@yitom/acp-client`，主进程留守见 `apps/desktop/electron/services/acp/`） |
| `reading-marks-api.ts` | 书签 / 高亮 / 批注 CRUD + 本书全文搜 + 按章查询 |
| `flashcards-api.ts` | 记忆卡片：待复习列表、复习评分落盘 |
| `ai-session-api.ts` | AI 会话指针（一书一会话）：行存取，轮转决策在调用方 |
| `quiz-api.ts` | AI 测验与答题打分记录持久化（全局 `montree.db`，API 签名自 JSONL 时代未变） |
| `sync-api.ts` | 云端同步（WebDAV 配置、连接测试、双向同步） |
| `web-doc-api.ts` | 在线文档：抓取页面、发现目录 |
| `bun-api.ts` | Bun 运行时状态查询与一键安装 |
| `ocr-api.ts` | OCR 组件状态、单页识别、目录识别与目录页范围探测（只建议范围） |
| `rosetta-api.ts` | 罗盘索引：扫描书一键导入、进度订阅、书信息、统一读查询、纯本地目录重建、正文水印只读预览、备份并应用正文水印（二次确认后调用，空计划 noop）、已入库内容只读取证 |
| `pdf-inspect-api.ts` | pdf-inspector 主进程分类与整档 Markdown |
| `query-keys.ts` | TanStack Query key 工厂 |

新增能力顺序（见 AGENTS.md）：`packages/contracts`（`@montree/contracts`，原 `shared/`）→ `apps/desktop/electron/services` → IPC 注册 → preload → **本目录** → hooks。
