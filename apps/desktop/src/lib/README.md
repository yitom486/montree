# src/lib

渲染进程**纯逻辑**（无 React Hook）。按产品域分子目录；通过 `@/lib/<域>/模块` 引用；通用导航/选区/标记逻辑走 `@montree/reader-core`（`packages/reader-core/src/`）。  
**不要**在根目录再堆新文件。例外：`utils.ts` 是 shadcn 的 `cn()`，必须留在 `@/lib/utils`。

组件胶水在 `src/hooks/`，IPC 在 `src/api/`，UI 状态在 `src/stores/`。

| 目录 | 管什么 |
|------|--------|
| `editor/` | Markdown 解析/编辑/导出、CodeMirror、草稿、换行规范化 |
| `preview/` | 预览 DOM：代码块复制、消毒、Mermaid hydrate |
| `reader/` | EPUB / PDF / MOBI / **在线文档 HTML** 渲染端专属逻辑，按域分子目录（`adapter/` `pdf/` `pdf-ocr/` `rosetta/` `marks/` `web-doc/`，详见该目录 README） |
| `quiz/` | AI 伴读考官出题、自动判卷打分、JSONL 知识库与仓储抽象（`parse`/`serialize` 已下沉 `@montree/contracts`） |
| `workspace/` | 文件树、对话框路径、全局错误上报 |
| `agent/` | ACP 会话辅助；`context/` 为 Montree 注入 Agent 的 Skill / 快照 / 选区（协议/传输/认证/MCP 纯逻辑已独立至 `@yitom/acp-client`） |

---

## 根目录

| 文件 | 功能 |
|------|------|
| `utils.ts` | `cn()`（clsx + tailwind-merge）。shadcn 组件依赖此路径，勿移动 |

## editor/

| 文件 | 功能 |
|------|------|
| `markdown` | markdown-it 解析器（预览与导出同源） |
| `markdown-parts` | 把 Markdown 拆成普通段 / Mermaid 块 |
| `markdown-headings` | 标题大纲、滚动比例 |
| `markdown-images` | 本地图片路径 ↔ data URL |
| `markdown-editing` / `markdown-editor-commands` | 编辑器格式化与快捷键 |
| `code-highlight` / `code-block-lines` | 代码高亮与行号 |
| `codemirror-theme` / `codemirror-syntax-linter` / `codemirror-paste-image` | CodeMirror 主题、语法 gutter、粘贴图 |
| `export-document` / `export-document-styles` | 导出 HTML/PDF 的文档与样式 |
| `deep-link` | 跨格式深度回跳协议解析与构建（`montree://open`） |
| `markdown-it-wikilinks` | 双向链接 `[[target\|label]]` markdown-it 扩展 |
| `markdown-it-page-marker` | OCR 页标记 chip 插件（独立成行 `<!-- Page N -->`→分页 chip，`data-page` 预留跳原图页） |
| `wikilink-completion` | CodeMirror 6 `[[` 实时自动补全源 |
| `draft-utils` | 草稿 key 与可恢复草稿挑选 |
| `editor-focus` | 判断 Markdown 编辑器是否聚焦 |
| `text-normalize` | 换行规范化 |

## preview/

| 文件 | 功能 |
|------|------|
| `preview-sanitize` | 预览 HTML 消毒选项 |
| `code-block-copy` / `code-block-chrome` | 代码块「复制」按钮 DOM 与共享工具栏 HTML |
| `mermaid-hydrate` / `mermaid-debug` / `mermaid-repair` | 在容器内渲染 Mermaid、错误容错与源码断行自愈 |

## reader/

通用导航/选区/标记/排版等 27 模块已迁 `@montree/reader-core`（`packages/reader-core/src/`，见该包 `packages/reader-core/src/index.ts` 分组注释）。
本目录已按域分子目录（2026-09 重构），逐文件说明见 [reader/README.md](./reader/README.md)：

| 子目录 | 管什么 |
|--------|--------|
| `adapter/` | 统一阅读后端契约与 foliate 实现（EPUB/MOBI/AZW3）、阅读文件内容指纹 |
| `pdf/` | PDF 打开/渲染/文字层、WASM 结构化解析（inspector/structure）、扫描探测、导入模式、Agent 搜索闸门与手动全书搜索 |
| `pdf-ocr/` | PDF OCR：页缓存 hydrate/预取/文字层挂载、目录缓存/门控/租约锁、自动页 OCR、探测反馈 |
| `rosetta/` | 罗盘：目录归一/签名状态、块转 Agent 文本、只读取卫、目录 AI 整理（`toc-ai`） |
| `marks/` | 阅读标记渲染/命中（PDF/MOBI/Web）、划词匹配、Anki 与读书笔记导出 |
| `web-doc/` | 在线文档：正文提取、页头剥离、链接、本页大纲、公式/代码块/iframe、Agent 按页抓文 |

根目录留跨格式骨架：`reader-adapter` / `reader-unit-tree` / `scroll-anchor` / `reader-viewport-*`（测试助手）/ `wait-for-dom`。

## workspace/

| 文件 | 功能 |
|------|------|
| `file-tree-ops` | 文件树路径、剪贴板、粘贴目标 |
| `quick-open` | 全局快速切换（扁平化文件树、模糊匹配与评分排序） |
| `resolve-wikilink` | 工作区双链目标解析（相对路径/文件名/同名推断与缺省笔记创建） |
| `dialog-default-path` | 打开/保存对话框默认目录 |
| `workspace-session` | 启动时恢复上次文件 / 在线文档 |
| `report-error` / `error-reporter` | AppError 与运行时错误上报 |
| `path-utils.test` / `document-types.test` | 测的是 `@montree/contracts`（原 `@shared`）路径与文档类型，放在工作区侧 |

## quiz/

| 文件 | 功能 |
|------|------|
| `quiz-repository` | 统一测验仓储抽象契约（`IQuizRepository`） |
| `quiz-storage-jsonl` | 基于 JSON Lines（`.jsonl`）的追加型流式存储实现 |
| `quiz-evaluator` | AI 出题 Prompt 构造、解析、批量多题判卷打分与离线启发式考官 |
| `quiz-acp-session` | 持续性考官独立副会话管理（2小时生命周期轮转、物理流式拦截与分流隔离） |

`parseQuizJsonl` / `serializeQuizSession` 已下沉 `@montree/contracts`（`packages/contracts/src/types/quiz.ts`）。

## agent/

| 文件 | 功能 |
|------|------|
| `acp-composer` | 输入框附件、工作区路径拖入 |
| `acp-permission` / `acp-permission-ui` | 权限请求与卡片展示 |
| `acp-plan` | 计划条目解析与进度摘要 |
| `acp-config-preferences` | Mode/Model 等配置记忆 |
| `acp-config-menu` | Agent 配置项下拉分类与 primary/secondary 切分（含 boolean 开关直通 secondary；fast 类 boolean 由 `findFastToggle` 单列 `fastToggle` 并从 secondary 摘出，`selectFastDefaultOffTarget` 给首次连接默认关一次） |
| `acp-model-thinking` | 模型值尾缀思考档提取与只读徽标条件 |
| `acp-session-restore` / `acp-thread-prune` / `acp-prune-agent-replies` | 会话恢复与线程修剪 |
| `acp-dev-log` / `acp-layout-probe` | 开发日志与布局探测 |
| `agent-markdown` | Agent 气泡 Markdown（与预览同源解析；流式尾部轻渲染跳过未闭合围栏高亮） |
| `stream-coalescer` | 流式正文 chunk 缓冲合并（32ms 一刷，非文本事件立即冲刷） |
| `streaming-split` | 流式稳定区/尾部分割（围栏外最后段落边界冻结复用） |
| `throttled-storage` | persist 节流写入（1.5s 合并落盘） |
| `annotation-note-prompts` | 批注 AI 意图/改写 chip 与草稿抽取 |
| `toc-ai-session` | 目录 AI 整理专用副会话（每次新建防跨书串扰、无头累积、不进时间线） |
| `acp-stream-host` | ACP 流式推送应用级宿主（单订阅单合并器 + 认证清理回调注册表；`acp-transport` 直连等待） |
| `acp-transport` | 子会话传输等待器（未连发直连信令，等 connected/auth-required，无驱动 1s 收兵） |
| `card-studio-session` / `card-studio-presets` / `card-studio` | AI 制卡一书一会话 + 六预设拼装 + 结果校验（失败无卡，不兜底） |
| `deep-answer` | 一键深度问答三方向拼装（答案落对话框，不进时间线） |
| `enrich-tool-message` | tool 消息 enrich（提议卡 + 章级建议） |
| `tool-failure-message` | 工具失败 → 聊天气泡内业务说明（折叠标题 + 展开正文） |
| `parse-chapter-mark-plan` / `promote-chapter-mark-plans` | 章级划重点 tool 解析与 promote |
| `mark-proposal-failure` | 提议/采用失败分类与「打开该章 / 去划词」引导 |

`agent/context/`（原 `agent-context/`）：静态 Skill、turn-context、阅读器内容/选区/标记 registry、MCP 快照序列化；标记提议统一走 `propose-mark`（`montree_propose_mark`）；目录 Agent 草稿走 `toc-draft`（`toc_*` 工具经快照回路写入，人点保存才进缓存）；已入库内容审计走 `inspect-indexed-content`（`montree_inspect_content` 经快照回路只读取证）；编辑器内存审计走 `inspect-editor-buffer`（当前 .md 未保存修改可见，`editor-buffer` 来源；有工作区根时再合并其他已保存 markdown，`workspace-file` 来源，相对路径）；EPUB/MOBI 章节审计走 `inspect-ebook-sections`（`ebook-section` 来源，章节标题定位，不持久入库）；已入库 PDF 章节迭代走 `rosetta-chapter-units`（chapters 失败/空/零产出直接抛错，禁止回退逐页 OCR）。

---

新模块先对号入座。预览 DOM 行为放 `preview/`，不要在 `agent/` 再复制一份。  
各子目录另有短 README，文件表以**本文件**为准。
