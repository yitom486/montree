# electron/services

主进程业务实现。IPC 只从这里调；根上文件平铺即可，不必再拆目录。ACP 已独立在 [`acp/`](./acp/)。

## 工作区与文件

| 文件 | 功能 |
|------|------|
| `file-service.ts` | 打开/保存对话框、读文本/二进制/图片、粘贴图、导出入口 |
| `workspace.ts` | 扫描工作区树（深度限制、忽略目录、去掉空文件夹） |
| `workspace-fs.ts` | 工作区内新建/重命名/移动/复制/删除 |
| `workspace-md-search.ts` | 工作区 Markdown 字面检索（只读：根内断言 + symlink 跳过，仅 .md，200 文件/256KB/100 命中上限，仅 inspect 链调用） |
| `workspace-watcher.ts` | 监听工作区变更并通知渲染进程 |
| `export-save-path.ts` | 导出 HTML/PDF/Markdown 的保存路径 |
| `web-doc-service.ts` | 在线文档抓取与目录发现入口（网络边界留守：SSRF 策略与重定向校验见 `web-doc/url-policy.ts`；目录抽取/站点谓词已迁 `@montree/web-doc`，本树 `web-doc/` 仅留 `url-policy`/`site-registry`/`e2e-fixture`） |

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

## ACP

见 [`acp/`](./acp/)。
