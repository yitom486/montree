# src/lib

渲染进程**纯逻辑**（无 React Hook）。按产品域分子目录；通过 `@/lib/<域>/模块` 引用；通用导航/选区/标记逻辑走 `@yitom/reader-core`（`node_modules/@yitom/reader-core/dist/`）。  
**不要**在根目录再堆新文件。例外：`utils.ts` 是 shadcn 的 `cn()`，必须留在 `@/lib/utils`。

组件胶水在 `src/hooks/`，IPC 在 `src/api/`，UI 状态在 `src/stores/`。

聊天消息经 `chat-session-authority` 交由包 `dispatchFeedEvent` 单次归约；消息列表只订阅包 feed，宿主只留业务元数据与兼容投影，退役的双写镜像已移除。

`agent/acp-turn-controller.ts` 按窗口持有包 `createChatTurnController`，以宿主线程/运行时/会话代际守卫发送和取消的异步结果；连接、认证、产品提示与错误展示仍由 `useAcpSession` 负责。

| 目录 | 管什么 |
|------|--------|
| `editor/` | Markdown 解析/编辑/导出、CodeMirror、草稿、换行规范化 |
| `preview/` | 预览 DOM：代码块复制、消毒、Mermaid hydrate |
| `reader/` | EPUB / PDF / MOBI / **在线文档 HTML** 渲染端专属逻辑，按域分子目录（`adapter/` `pdf/` `pdf-ocr/` `rosetta/` `marks/` `web-doc/` `tts/`，详见该目录 README） |
| `quiz/` | AI 伴读考官出题、自动判卷打分、JSONL 知识库与仓储抽象（`parse`/`serialize` 已下沉 `@montree/contracts`） |
| `workspace/` | 文件树、对话框路径、全局错误上报 |
| `agent/` | ACP 会话辅助；`context/` 为 Montree 注入 Agent 的 Skill / 快照 / 选区（协议/传输/认证/MCP 纯逻辑已独立至 `@yitom/acp-client`） |
| `data/` | CSV/TSV 表格数据集、JSON 树形模型与 LOG 日志流数据解析与 CRUD（纯逻辑模型层） |

---

## 根目录

| 文件 | 功能 |
|------|------|
| `utils.ts` | `cn()`（clsx + tailwind-merge）。shadcn 组件依赖此路径，勿移动 |

## editor/

| 文件 | 功能 |
|------|------|
| `markdown` | markdown-it 解析器（预览与导出同源）；沿用社区脚注插件，补充原始定义范围供实时预览编辑 |
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
| `markdown-it-alerts` / `.test.ts` | 社区 `@mdit/plugin-alert` 接入：GitHub 风格提示卡片与嵌套支持 |
| `wikilink-completion` | CodeMirror 6 `[[` 实时自动补全源 |
| `markdown-it-artifacts` | Markdown 数据组件入口：montree-diagram/montree-ui 围栏或静态图片＋隐藏 JSON 注释；保留源行映射，64KiB 限制，参数经组件二次校验 |
| `live-preview/` (内含 `index`, `live-preview-inline`, `live-preview-blocks`, `live-preview-theme`, `task-checkbox-widget`, `quote-mark-widget`, `horizontal-rule-widget`, `image-widget`, `.test.ts`) | CodeMirror 6 实时预览：行内光标感知装饰、任务复选框与 StateField 多行块；复用 markdown-it/KaTeX/highlight.js/Mermaid 的表格、代码、公式、HTML/图片渲染及源单元格定位；列表内代码保留容器上下文，成对且一致空格缩进的围栏由共享解析器兼容，原文不改写 |
| `draft-utils` | 草稿 key 与可恢复草稿挑选 |
| `editor-focus` | 判断 Markdown 编辑器是否聚焦 |
| `text-normalize` | 换行规范化 |
| `text-document` / `.test.ts` | Markdown/TXT 原始缓冲区行/章节/范围查询、版本与原文校验的原子编辑、精确多选区；Typst 复用文本与跨视图撤销历史，源码按行保留，不解析为 Markdown 章节 |
| `theme-transition` / `.test.ts` | View Transitions 原生主题平滑切换（GPU 贴图合成、180ms 交叉淡化、两帧延迟卸载屏蔽类） |
| `typst-lsp` / `.test.ts` | Typst UTF-16 位置/文本修改/诊断映射、预览 loopback URL 校验；按 Windows/POSIX 路径边界选择项目根，独立文件与跨目录另存为回落自身目录 |
| `typst-session` / `.test.ts` | Typst 会话生命周期与有序内存同步：版本守卫、初始诊断缓存、过期请求丢弃、显式导出与延迟打开清理 |

## preview/

| 文件 | 功能 |
|------|------|
| `preview-sanitize` | 预览 HTML 消毒选项 |
| `render-preview` / `.test.ts` | 独立预览与实时预览共享 Markdown/DOMPurify/本地图片解析，HTML 属性经 DOM 解析，重复资源合并读取 |
| `code-block-copy` / `code-block-chrome` | 代码块「复制」按钮 DOM 与共享工具栏 HTML |
| `mermaid-hydrate` / `mermaid-debug` / `mermaid-repair` | 在容器内渲染 Mermaid、错误容错与源码断行自愈 |

## reader/

通用导航/选区/标记/排版等 27 模块已迁 `@yitom/reader-core`（`node_modules/@yitom/reader-core/dist/`，入口见该包 `node_modules/@yitom/reader-core/dist/index.js`；源码分组注释在 montree-chat 仓同路径文件）。
本目录已按域分子目录（2026-09 重构），逐文件说明见 [reader/README.md](./reader/README.md)：

| 子目录 | 管什么 |
|--------|--------|
| `adapter/` | 统一阅读后端契约与 foliate 实现（EPUB/MOBI/AZW3）、阅读文件内容指纹 |
| `pdf/` | PDF 打开/渲染/文字层、WASM 结构化解析（inspector/structure）、扫描探测、导入模式、Agent 搜索闸门与手动全书搜索 |
| `pdf-ocr/` | PDF OCR：页缓存 hydrate/预取/文字层挂载、目录缓存/门控/租约锁、自动页 OCR、探测反馈 |
| `rosetta/` | 罗盘：目录归一/签名状态、块转 Agent 文本、只读取卫、目录 AI 整理（`toc-ai`） |
| `marks/` | 阅读标记渲染/命中（PDF/MOBI/Web）、划词匹配、Anki 与读书笔记导出 |
| `web-doc/` | 在线文档：正文提取、页头剥离、链接、本页大纲、公式/代码块/iframe、一键转 Markdown 导出、Agent 按页抓文 |
| `tts/` | 语音朗读：正文智能降噪清洗（过滤 URL/角标/脚注并保留链接正文）、静态声学物理停顿对齐器（严格 1:1 数量守恒与静态二分查表）、Web Audio 实时流式 PCM 播放器 |

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

`parseQuizJsonl` / `serializeQuizSession` 已下沉 `@yitom/contracts`（`node_modules/@yitom/contracts/dist/types/quiz.js`）。

## agent/

生成式 UI 参数模板：`agent/context/present-presets.ts`（阅读对比/引用/测验）与 `agent/context/present-diagram.ts`（三类 SVG 图解），经 `agent/context/present-result-builder.ts` 统一验证与组装，不执行模型提供的模板源码。

Agent 正文分块由单个 Streamdown 实例维护，避免自研头尾渲染器迁移节点；入口见 `@montree/chat-ui` 包内 `chat-markdown`（M3a 由原 components/markdown 下 `AgentMarkdown` 入口整搬改名）。

| 文件 | 功能 |
|------|------|
| `acp-composer` | 输入框附件、工作区路径拖入与 ACP payload；通用发送判定已由包 `useChatComposerController` 持有 |
| `context/reader-visual-context` | 网页/EPUB DOM 与 Markdown 图片引用、图注/可见状态、当前阅读区裁剪范围；回归见同名 `.test.ts` |
| `context/document-tool-registry` / `.test.ts` | 当前 Markdown/TXT、表格/PPT 的结构化读写、撤销、保存桥接与 dirty 通知；空白选区回归 |
| `acp-permission` / `acp-permission-ui` | 权限请求与卡片展示（孤立审批兜底按时间线实际渲染判定：分组跳过/晚到/缺 ID/裁剪时才浮出）（`acp-permission-ui` 已迁 @montree/chat-core，见包内 `permission-ui`） |
| `permission-respond` | 审批响应宿主实现（跨卡幂等领取 + 清理 + `acpApi.respondPermission` 发送；包内审批卡经 `onRespond` 回调到此） |
| `chat-transport-port` / `.test.ts` | P0 宿主侧 `ChatTransportPort`（`sendText/cancel/respondPermission` 委托现有 `acpApi` 链路：工作区前缀 + bootstrap 一次语义 + 附件透传位；只 resolve/reject，不写时间线不弹 toast；P1 并跑用，现有调用链不动） |
| `acp-plan` | 计划条目解析与进度摘要（已迁 @montree/chat-core，见包内 `plan`） |
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
| `acp-update-adapter` / `.test.ts` | ACP `session/update` → 宿主分发意图的**纯适配**（C1）：标准成员经 `@yitom/chat-session` `mapSessionUpdate` 复用单表与 SDK 联合穷尽校验，宿主只保留 `montree_settle_complete`、`usage_update`（线程字段）、`tool_call_content_chunk`（camelCase-only）与无 id 工具调用（快照旁路）等独有语义；不读 store、不做回放清洗，线程归属/清洗时序仍在 `apps/desktop/src/stores/acp/chat-slice.ts` |
| `chat-session-owner` / `.test.ts` | 包会话单例与唯一消息历史持久化：按窗口分区，`authorityVersion` 标记旧宿主历史的一次性迁入；保留旧键，包历史后续优先，最近成功副本与坏数据备份支持恢复 |
| `chat-session-authority` / `.test.ts` | 宿主通用 feed 事件定向交给包单次归约；业务清洗/提议通过显式受控更新入口；线程元数据路由始终保留包 feed，宿主只读兼容投影不再反灌快照 |
| `acp-transport` | 子会话传输等待器（未连发直连信令，等 connected/auth-required，无驱动 1s 收兵） |
| `card-studio-session` / `card-studio-presets` / `card-studio` | AI 制卡一书一会话 + 六预设拼装 + 结果校验（失败无卡，不兜底） |
| `deep-answer` | 一键深度问答三方向拼装（答案落对话框，不进时间线） |
| `enrich-tool-message` | tool 消息 enrich（提议卡 + 章级建议）（已迁 @montree/chat-core，见包内同名模块） |
| `inline-present` / `.test.ts` | 聊天正文 montree-present 围栏分段与同回合结果关联；只引用此前已成功的校验结果，流式保留原卡片，分页与重复引用保护（已迁 @montree/chat-core，见包内同名模块） |
| `parse-present-result` / `.test.ts` | `montree_present` 结果 enrich；严格工具标识判定，不误报 schema 文件；恢复时仅为当前线程已有成功工具补充校验后的呈现正文，保持消息 ID、不新增历史（已迁 @montree/chat-core，见包内同名模块） |
| `generative-submit` / `.test.ts` | 生成式 UI 提交归属守卫纯函数（界面线程须等于活动线程，否则拒绝，防切线程串线）（已迁 @montree/chat-core，见包内同名模块） |
| `tool-failure-message` | 工具失败 → 聊天气泡内业务说明（折叠标题 + 展开正文）（已迁 @montree/chat-core，见包内同名模块） |
| `tool-display-model` / `.test.ts` | 工具纯展示适配：ACP → 中文标题/目标摘要/展示状态/错误摘要/可靠时长（取消·未知不进成功；无元数据不编造目标）（已迁 @montree/chat-core，见包内同名模块） |
| `chat-timeline` / `.test.ts` | 聊天时间线纯分组：按真实 user 回合归属（同一回合普通调用汇总一条工作记录，文本保序；无 user 前缀独立成段，scopeKey 按线程隔离）；整回合计数+窗口适配（未加载注记）；失败/待审批/富结果提升单条；稳定 key（`groupChatTimeline` / `isRichToolMessage`；组件旧实现已删，`AnnotationNoteDialog` 同走此分组）（已迁 @montree/chat-core，见包内同名模块） |
| `parse-chapter-mark-plan` / `promote-chapter-mark-plans` | 章级划重点 tool 解析与 promote（已迁 @montree/chat-core，见包内 `parse-chapter-mark-plan` / `chapter-mark-plans`） |
| `mark-proposal-failure` | 提议/采用失败分类与「打开该章 / 去划词」引导 |
| `acp-workspace-integration.test` | 工作区绑定会话全生命周期集成测试（跨工作区切换隔离、离线无感切换、Resume 对齐、WSL UNC 别名识别与历史菜单分桶） |


`agent/context/`（原 `agent-context/`）：静态 Skill（含每 10 轮重贴的渲染速览，防长会话压缩丢失）、turn-context、阅读器内容/选区/标记 registry、MCP 快照序列化；标记提议统一走 `propose-mark`（`montree_propose_mark`）；目录 Agent 草稿走 `toc-draft`（`toc_*` 工具经快照回路写入，人点保存才进缓存）；已入库内容审计走 `inspect-indexed-content`（`montree_inspect_content` 经快照回路只读取证）；编辑器内存审计走 `inspect-editor-buffer`（当前 .md 未保存修改可见，`editor-buffer` 来源；有工作区根时再合并其他已保存 markdown，`workspace-file` 来源，相对路径）；EPUB/MOBI 章节审计走 `inspect-ebook-sections`（`ebook-section` 来源，章节标题定位，不持久入库）；已入库 PDF 章节迭代走 `rosetta-chapter-units`（chapters 失败/空/零产出直接抛错，禁止回退逐页 OCR）。

## data/

| 文件 | 功能 |
|------|------|
| `csv-dataset` | RFC 4180 兼容的 CSV/TSV 解析、行列与单元格 CRUD、排序检索与无损序列化 |
| `json-tree-model` | 树形 JSON 节点构建、JSONPath 寻址、节点 CRUD、容错解析与无损序列化 |
| `log-parser` | 高性能多行系统日志流解析、级别提取、堆栈行吸附、级别掩码过滤与日志条目 CRUD |
| `dataset-integration.test` | 真实商业报表 CSV、真实应用配置 JSON 与真实服务崩溃 LOG 的解析与增删改查集成测试 |
| `spreadsheet-document` / `.test.ts` | CSV/TSV/XLSX 原地址读写、区域和版本校验、批量撤销；XLSX 定点修改 XML 保留其他部件 |
| `formula-evaluator` / `.test.ts` | Excel 公式求值引擎（算术、统计、逻辑与文本函数、级联依赖与循环引用防护） |
| `presentation-document` / `.test.ts` | PPTX 原始元素 ID 查询/删改、关系排序、引用保护、撤销与保留未修改部件 |
| `presentation-preview` | PPTX 段落默认样式、文字块覆盖、换行、形状外观及原稿背景/主题颜色解析 |
| `presentation-xml` | PPT XML 严格解析、关系寻址、递归元素与原子批次参数校验 |
| `presentation-chart` | 二维基础图表读取与定点编辑，缓存和内嵌 XLSX 同步，复杂图表只读 |
| `presentation-design` | 现有母版/版式清单、影响范围核验、默认样式及元素文字编辑、应用现有版式 |
| `presentation-animation` | 基础出现/淡入动画时间线、触发关系与转场读写，复杂效果保留 |
| `presentation-advanced.test` | 真实嵌套组合/图表/内嵌工作簿/母版/动画的保存重开、保留部件及原子拒绝回归 |
| `presentation-test-fixture` | 仅供测试的真实 PPTX 图表/内嵌工作簿/母版/嵌套组合生成器，模型与 E2E 共用 |
| `presentation-text-edit` / `.test.ts` | PPT 段落/片段/UTF-16 范围原子编辑，原文/数量/重叠/字段校验，保留范围外样式 |
| `xml-test-dom` | Office 单元测试的标准 XML DOM 适配（只被测试引用） |

---

新模块先对号入座。预览 DOM 行为放 `preview/`，不要在 `agent/` 再复制一份。  
各子目录另有短 README，文件表以**本文件**为准。

