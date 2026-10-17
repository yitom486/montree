# electron/services

主进程业务实现。IPC 只从这里调；根上文件平铺即可，不必再拆目录。ACP 已独立在 [`acp/`](./acp/)。

## 工作区与文件

| 文件 | 功能 |
|------|------|
| `file-service.ts` | 打开/保存对话框、读文本/二进制/图片、粘贴图、导出入口 |
| `workspace.ts` | 扫描工作区树（深度限制、忽略目录、无权限/受限目录容错、去掉空文件夹） |
| `workspace-fs.ts` | 工作区内新建/重命名/移动/复制/删除 |
| `workspace-md-search.ts` | 工作区 Markdown 字面检索（只读：根内断言 + symlink 跳过，仅 .md，200 文件/256KB/100 命中上限，仅 inspect 链调用；B3 分页 offset/limit/nextOffset） |
| `workspace-watcher.ts` | 监听工作区变更并通知渲染进程（事件带 workspaceId/代际/变化目录，旧事件不污染新状态；B3 忽略 node_modules/构建产物/Git 内部噪声，合并窗口截断回落全量） |
| `workspace-host.ts` / `.test.ts` | WorkspaceHost 抽象：本机宿主委托既有实现（行为零变化），远端占位显式拒绝（不回落 UNC）；分发只看描述符 kind |
| `workspace-bindings.ts` / `.test.ts` | 可信窗口绑定宿主与代际（event.sender 归属；connecting/connected/reconnecting/disconnected/error；销毁自清理） |
| `remote-workspace-host.ts` / `.test.ts` | B2/B3 远端宿主：实现 WorkspaceHost 接口，读写/CRUD/搜索/Git/图片经 workspace 协议在远端执行；expectedRevision 冲突、断线显式失败（buffer 留渲染端）、代际过期丢弃、跨宿主拒绝、订阅重建与 revision 重核；回环真实服务端验证（T4/T5/T6/T7），真机 WSL 端到端待 Linux Node |
| `export-save-path.ts` | 导出 HTML/PDF/Markdown 的保存路径 |
| `web-doc-service.ts` | 在线文档抓取与目录发现入口（mdBook 优先解析章节树或读取声明的同源 toc.html，避免正文参考链接冒充目录；支持显式 localhost / 127.0.0.1 / [::1] 本机文档，同源目录及重定向继承访问，公网转本机/跨端口仍拦截；网络边界留守：SSRF 策略与重定向校验见 `web-doc/url-policy.ts`；目录抽取/站点谓词已迁 `@montree/web-doc`，本树 `web-doc/` 仅留 `url-policy`/`site-registry`/`e2e-fixture`） |
| `reader-screenshot-service.ts` / `.test.ts` | Agent 按需截图 owner 窗口的阅读区，返回内存 PNG；裁剪与无文档保护 |
| `binary-document-service.ts` / `.test.ts` | XLSX/PPTX 保存：摘要冲突检测、同目录临时文件替换，避免覆盖外部修改 |

## Git 版本控制

| 文件 / 目录 | 功能 |
|------|------|
| `git/` (`git/git-service.ts` / `.test.ts`，`git/git-wsl.test.ts` 真机） | Git 状态查询、提交与推送服务；自动识别 Windows 与 WSL 路径，通过原生 `git` 或 `wsl.exe` 穿透执行；B3 加 diff/分支查询（截断标记/游离 HEAD），真机 Ubuntu 临时仓库验证（无真实远端 push） |

## 远程与 WSL（remote）

| 文件 | 功能 |
|------|------|
| `remote/remote-service.ts` / `.test.ts` | WSL 发行版动态探测（零硬编码）、Linux 家目录探测、~/.ssh/config 解析；目录浏览 B1 起经远端服务（须先建连，未连接报 `REMOTE_NOT_CONNECTED`，已移除 UNC/`readdir` 直读） |
| `remote/wsl-bootstrap.ts` / `.test.ts` | B1 WSL bootstrap：登录 shell/家目录/Node 探针（拒 Windows node 冒充）、经 stdin 管道传输安装（staging→双校验→原子 `mv`，目标按 buildId 存放，空格/非 ASCII 转义）、发行版+root 规划 |
| `remote/wsl-workspace-host.ts` / `.test.ts` | B1 WSL 宿主：复用 A2 `RemoteServerPipeClient`、经 `wsl.exe` 启动同一服务并握手（期望平台 linux）；浏览/stat 在 Ubuntu 原生执行；代际隔离；断线/版本/缺 Node 明确错误；含 fs UNC 动态拦截回归 |
| `remote/remote-server-client.ts` / `.test.ts` | A2 本地管道客户端：spawn 真实 Node 服务、长度分帧 stdio、hello 握手（协议版本/Node 22+/期望平台，防 Windows node.exe 冒充）、并行上限、取消、EOF/EPIPE 收尾、脱敏日志 |
| `remote/wsl-capabilities-live.test.ts` | B3 WSL 真机探针：home/shell 动态得出；无 Linux Node 时断言 `REMOTE_NODE_MISSING` + 安装说明（不 sudo/下载） |
| `remote/remote-server-host.ts` | A2 连接管理：连接归属调用窗口、代际隔离、窗口销毁回收（只杀本连接进程）；Node 解析与 manifest 校验失败给安装说明 |
| `remote/remote-server-paths.ts` | 服务产物定位（开发期仓库资源目录/打包后 `resources/remote-server`）与 manifest 校验（协议主版本 + sha256 + 尺寸） |

远端协议纯逻辑见 `packages/workspace-core/`（`@montree/workspace-core`，分帧/路径/revision），Node 服务实现见 `packages/remote-server/`（`@montree/remote-server`），产物构建见 `apps/desktop/resources/remote-server/README.md`（`bun run build:remote-server`）。

## PDF 解析（pdf-inspector）

| 文件 | 功能 |
|------|------|
| `pdf-inspector-service.ts` | 主进程 PDF 分类与按页 Markdown 抽取（薄封装：页码归一/分类映射/正文拼装走 `@montree/pdf`；页码对外 1-indexed；OCR 运行时另起任务） |

页码归一/分类映射/整档拼装（normalize/models/ports）见 `packages/pdf/`（`@montree/pdf`，PDF 原生结果归一与拼装）。

## 阅读标记与测验

| 文件 | 功能 |
|------|------|
| `reading-marks-service.ts` | 书签 / 高亮 / 批注 adapter（`userData`；默认走各书 `book.db` v5 `marks` 表，`MONTREE_MARKS_BACKEND=file` 回滚旧 JSON；纯核见 `@montree/annotations`：`marks-core`；提议模型同包：`mark-proposal` 单条·批量、`chapter-mark-plan` 章级建议） |
| `marks-db.ts` | 卡片 SQL 后端（各书库 `marks` 行映射/CRUD、`chapter_key` 索引查询、trigram FTS + 短词 LIKE 兜底、导出/导入/存量迁移，`resolveFingerprintForFile` 具备同路径精准指纹择优与副库数据自动合并；记忆卡回填与读写入口亦收敛于此，行操作见 `flashcards-db`；集成测试见 `mark-proposal-db.integration.test.ts`） |
| `flashcards-db.ts` | 记忆卡片行操作（本书库 `flashcards` 派生 upsert/标脏 + `review_log` 落盘/待复习查询；快照口径与 Anki 导出一致；userDataDir 感知入口在 `marks-db`，本模块无循环依赖；线上传输类型归 `@montree/contracts` 的 `types/flashcard`） |
| `quiz-service.ts` | AI 测验与答题打分记录 adapter（`userData`；默认走全局 `montree.db` v1，`MONTREE_QUIZ_BACKEND=file` 回滚旧 JSONL；`parse`/`serialize` 已下沉 `@montree/contracts`，本模块兼容再导出；`readQuizJsonlForSync`/`writeQuizJsonlForSync` 供同步传输层；集成测试见 `quiz-mcp-flow.integration.test.ts`） |
| `quiz-db.ts` | 测验 SQL 后端（全局库 sessions/questions 行映射·组装、幂等追加/灌库、导出/导入 JSONL，`correct_count` 按 60 分及格线派生；多题型与整卷建议 round-trip 验证） |
| `ai-session-service.ts` | AI 会话指针（一书一会话，`montree.db ai_sessions` 行存取；轮转决策在调用方） |

## 结构化索引（SQLite 罗盘，单书一库）

| 目录 | 功能 |
|------|------|
| `app-db/` | 全局库 adapter（`userData/montree.db` 跨书数据）：`schema` 建表 + migrate（`user_version`，v1 建 `quiz_sessions` + `quiz_questions` + 索引，v2 加 `ai_sessions` 一书一会话指针）；`open-app-db` 单库打开 + 句柄缓存 |
| `book-db/` | SQLite/文件 adapter（`schema`/`migrate` 不动）：`schema` 建表 + migrate（`user_version`，v2 加 `completed_pages` 续跑进度，v3 加 `toc_signature` + `toc_entries` 全量目录，v4 加 `blocks.source`/`extract_version` 来源标注并回填旧行，v5 加 `marks` + `marks_tombstones` + `marks_fts` 卡片住书库，v6 加 `flashcards` + `review_log` 记忆卡片复习态）；`import-book` 整书导入（book-index 章归属 + 行分类 + span 对齐 bbox，新书行同步落 `toc_entries`/签名）与块级原语（`ensureImportBookRow`/`importBookChunk`/进度标记，块事务原子、重复幂等、序号连续）；`toc-rebuild` 纯本地目录重建（已确认目录 → `toc_entries` 全量替换 + `chapters` level≤1 重建 + 存量块重归属 + 全页覆盖修 `completed_pages`，不调 OCR；`toc-rebuild.test` 204 条仿真目录重建回归）；`body-watermark-preview` 正文水印只读预览（`existsSync` 判存在 + `readOnly`/`query_only` 只读开库，调 `planBodyWatermarkPatches` 做删除/更新计数与最多 20 条截断样例 + `planSignature`，零写入）；`body-watermark-apply` 正文水印备份并应用（同连接重算签名/统计比对 → 同目录时间戳备份 + 只读校验 → 单事务条件写 `changes===1` 全回滚 → 提交后复验 blocks/目录/FTS，空计划 noop）；`queries` 章读块 / 目录项范围读块（`toc` 按起止页，一级整章、二三级小节）/ FTS trigram 中文搜（含 `countSearchBookBlocks` 精确总数）/ 块上下文 / 块定位 / 原生质量差页只读列表（P1.3，不触发 OCR）；`content-audit` 已入库内容只读取证（`existsSync` 判存在 + `readOnly`/`query_only` 只读开库，精确总数 + 至多 10 条位置/截断证据，不建库不迁移）；`open-book-db` 单书一库打开 + 句柄缓存；`import-service` 扫描书一键导入（单次 Auto 全量改为大块分段 ≤4 块：全量解析成本只与文件大小有关，17×20 小分批会 churn 到 abort；页数由渲染端给，不再 classify；取消/崩溃按 `completed_pages` 续跑；终端 `[rosetta]` 日志；进行中快照可轮询）；；`import-service` 支持 preferNative 纯文字直提（跳过 OCR 运行时，OcrMode.Off，全轮无字报错；差页只标记可手动识别）`query-service` 拆 `InDb`/`File`（`queryRosettaBookInDb`/`getRosettaBookInfoInDb`：调用方已开库；`queryRosettaBook`/`getRosettaBookInfo`：指纹开库薄封装，register-handlers 入口）；`rosetta-book.test` 王道整书回归、`rosetta-native.test` 原生分流回归（各需环境变量给数据） |

## 云端同步 (WebDAV)

| 目录 | 功能 |
|------|------|
| `sync/` | WebDAV 存储 adapter 与同步管理器整体留守；`mergers/` 仅留 `progress`/`quiz`，`marks` 合并已迁 `@montree/annotations` |

## 应用壳

| 文件 | 功能 |
|------|------|
| `app-service.ts` | 应用版本等 |
| `app-updater.ts` | 应用内更新（electron-updater） |
| `bun-runtime.ts` | Bun 运行时检测与安装 |
| `app-paths.ts` | 图标等资源路径 |
| `runtime-state.ts` | 进程内开关（如 verbose 渲染日志） |
| `error-log-service.ts` | 渲染端上报错误写入日志文件 |

## 语音朗读（TTS）

| 目录 | 功能 |
|------|------|
| `tts/` | `tts/tts-service.ts`：集成 `gemini-tts-studio`（模型/音色查询、Azure Speech SDK 官方 SentenceBoundary 毫秒级时间轴与 Local OpenAI TTS）、双 Key 容灾、WAV 音频与 `.timeline.json` 磁盘缓存；Gemini 长文本段落优先分段（保留自然段落完整性，超长段按句切分，最多 800 字符），逐段验证、缓存和播放，失败段按 Key 独立重试与敏感词/云端异常（OTHER）安全跳过自愈，支持可选的异步 Batch 批量任务模式；主 Key 遇到任意 429（含日额度）或异常优先切换不同的备用 Key 继续当前缺失段，主备均受限或没有可用备用时才报错；完整段落缓存跨退出复用，半段不保存。发送排队/接收/分段完成进度事件。`tts/gemini-stream.ts`：通过 Google SDK 接收全部分片并检查 `finishReason`、超时与 WAV 完整性/异常短音频；日志标记任务、段号、尝试次数、模型版本、响应编号、接收量及错误/取消结果，接收中日志每秒最多一次，不记录正文和密钥。`tts/gemini-queue.ts`：应用内统一串行队列，连续 60 秒最多 3 次合成请求（含重试、主备 Key 和密钥测试），播放优先于后台预取，排队可取消。`tts/gemini-quota.ts`：解析日额度与短期限流、保留云端 RetryInfo，按 Key 指纹与模型分别记录冷却，避免主 Key 的 429 阻塞备用；日额度恢复时间保存到用户数据目录的 tts-quota.json，只存哈希与时间。Batch API 使用其独立配额。回归测试见 `tts/tts-service.test.ts`、`tts/gemini-stream.test.ts`、`tts/gemini-queue.test.ts` 与 `tts/gemini-quota.test.ts`。 |

## ACP

见 [`acp/`](./acp/)。


## React artifact

| 文件 | 功能 |
|------|------|
| `react-artifact-service.ts` / `.test.ts` | 96KiB 单文件 JSX/TSX 离线转换；Sucrase 独立懒块内联打包，不执行模型源码；生成预置 React 运行库 HTML，由 iframe CSP 限制运行 |

## Typst

- `typst/typst-service.ts`：Tinymist 0.15.8 校验、窗口/项目语言进程、未保存文本同步、隔离预览与内存 PDF 导出；配置及包缓存位于 userData/typst。
- `typst/lsp-process.ts`：受限 Content-Length UTF-8 字节分帧、请求超时与进程清理。
- `typst/typst-live.test.ts`：有运行时时执行真实 Unicode 缓冲区、补全、诊断、预览和 PDF 内容回归；工具缺失时跳过，不能据此宣称真实验证通过。

- `typst/lsp-process.test.ts`：UTF-8 每字节断点、粘包、非法/超长消息、超时与子进程退出回归。
- `typst/typst-service.test.ts`：本机路径边界、缺失工具与损坏随包 manifest 拒绝。
