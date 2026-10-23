# E2E 测试（Playwright + Electron）

Playwright 驱动**已构建**的 Electron 应用（`out/main/main.js`）。运行前需先 `bun run build`。

`terminal.spec.ts`：用户终端面板的真实 PTY 输入、Git 命令、新文件落盘、标签切换、隐藏保留和关闭释放，使用独立临时工作区。Agent 原生工具实测另见 `scripts/probe-opencode-native-tools.mjs`（可选，需安装 OpenCode 2.0.22）。

```bash
bun run doctor            # 检查本地 Node/原生模块/Typst/xvfb 是否就绪
bun run build
bun run test:e2e          # 全部 E2E
bun run test:e2e:web-doc  # 仅在线文档 fixture 冒烟
```

高 DPI：`E2E_DEVICE_SCALE_FACTOR=1.5 bun run test:e2e …` 以 `--force-device-scale-factor` 启动（CI 的 Windows 作业跑 1x 与 1.5x）。截图请用 `helpers/screenshot.ts` 的 `screenshotWithoutToasts`（样式隐藏 toast，**不要删除 toast DOM**，会让 React 崩溃）。

## 用例

| 文件 | 说明 |
|------|------|
| `chat-links.spec.ts` | 聊天链接：http(s) 交系统浏览器，`file:`/自定义协议、主框架跳转与 `window.open` 被拦截 |
| `agent-terminal-approval.spec.ts` | Agent `terminal/create` 审批卡：拒绝 / 允许一次 / 信任此工作区，审计日志与信任文件 |
| `ai-edit-lifecycle.spec.ts` | 修改建议按 MCP `_meta.toolCallId` 去重；审阅模式拦截直接编辑；清空对话撤回全部建议 |
| `agent-epipe.spec.ts` | 回合中杀掉 Agent 进程后再写 stdin（EPIPE）：主进程无未捕获异常/错误框，可重连 |
| `ime-composition.spec.ts` | CDP 真实输入法组合（`Input.imeSetComposition`）：编辑器实时预览行与聊天输入框，组合中 Enter 不发送 |
| `window-width-stability.spec.ts` | 奇数窗口宽度、滚动条临界内容、拖动分隔条后外框宽度静置不抖动；`E2E_DEVICE_SCALE_FACTOR` 模拟 125%/150% |
| `workspace-render-isolation.spec.ts` | md→PDF→在线文档→本地 md 切换与 Mermaid 渲染时，聊天面板零重渲染（渲染计数探针）、聊天/工作区外框零位移 |
| `markdown-mermaid-stability.spec.ts` | 实时预览 Mermaid：上方输入不重建 SVG、不跳高度；源码/预览切换命中缓存首帧出图 |
| `react-dev-sandbox.spec.ts` / `fixtures/react-dev-sandbox.html` | 独立 Vite 开发服务 + Electron：React 开发版收到沙盒 iframe 的 Window/DOM 属性后，初次挂载、切换、点击和输入仍可用，无渲染异常 |
| `annotations-react-docs.spec.ts` | React 官方文档（在线文档快照 + 扫描版 PDF/OCR，mock Agent）：划重点、批注、智能制卡、Agent 经 MCP 提议 AI 笔记并采用，重载后持久化与重新锚定 |
| `ai-edit-review-tools.spec.ts` / `ai-edit-multiwindow.spec.ts` | 逐句审阅、审阅面板、选区工具栏、行内补全；修改建议多窗口隔离 |
| `inline-completion-settings.spec.ts` | 设置页单独配置补全 provider（预设/Base URL/模型/本地空 Key）与 ChatGPT 登录入口，保存/清除状态切换 |
| `app-smoke.spec.ts` | 启动、欢迎页、菜单；真实 IPC 拒绝未绑定窗口凭 workspaceId 访问远端 |
| `agent-community.spec.ts` | 社区滚动跟随/上滑逃离、历史窗口与位置恢复回归 |
| `agent-panel.spec.ts` | Agent 面板壳；mock ACP 的 320/390/480 输入栏布局、选区复制/引用与输入框粘贴/剪切（剪贴板边界桩）；Code mode 开关经真实 IPC 透传 `_meta.toolsMode=ptc` 到下一次新会话 |
| `agent-resources.spec.ts` | 真实 mock Agent 经 stdio 发现工具后查看 MCP 健康/工具 schema；独立临时用户目录的 Skills 搜索、完整说明/原文、代码与示例复制、受控打开位置、Escape/焦点、深浅色及窄窗口截图；建会话前也能打开 Skills/MCP 且不误报会话切换；不调用真实模型 |
| `agent-wsl-opencode.spec.ts` | 可选真实 Windows→WSL OpenCode 连接验证（设置 E2E_WSL_OPENCODE_CWD）：加载 Ubuntu 用户登录 shell、独立认证、stdio 工具发现；不发送模型 prompt |
| `agent-window-isolation.spec.ts` / `fixtures/mock-window-agent.cjs` | 模拟 ACP Agent 经真实子进程/SDK/IPC/stdio MCP 验证多窗口聊天、制卡指针、权限、取消、恢复、关闭和 iframe 原生快捷键隔离；同时验证独立聊天包的窗口存储分区、主窗口旧历史迁入及副窗口重载不继承主历史；不调用真实模型；HTTP 仅保留专用测试钩子兼容 |
| `agent-tool-timeline.spec.ts` | 聊天展示层定向回归：种子时间线（单回合一条工作记录/失败摘要/图表独立入口紧凑态/长内容，浅色+深色截图与默认态高度测量）、10 调用收敛基线（一条记录+2 结果入口）、流式工作记录（运行收起·展开后落定保持，需 mock `worklog`/`worklog-done` 台本）、真实 mock 审批 Allow/Reject 全链路（唯一可见·幂等消失）、分隔线三档宽度（约 320/390/480）与 JSON 内部滚动；不调用真实模型 |
| `agent-streamdown.spec.ts` | Streamdown 正文链路：原生字符淡入的中间透明度与减少动态效果验证、完成态无动画包装；真实 mock 流式中间态占位与完成态（表格/代码/数字公式/Mermaid/链接）、脚注引用和返回实际点击、社区代码复制、代码头标签与动作浮层无重叠、Shiki token 高亮生效、无面板溢出截图；agy 思考→工具名与绘图主题→组织回答→完成的真实 IPC 状态切换；不调用真实模型 |
| `agent-bubble-scrollbar.spec.ts` | 流式正文与工作记录的真实界面回归：浅/深色、320/480/800px 及小数宽度下无多余内部纵向滚动条，光环启停不挤压正文，列表正常滚动；不调用真实模型 |
| `agent-rich-check.spec.ts` | 富文本核验单：mock `rich-check` 台本一次回放 mark/上标/脚注成对/行内公式/原生 details 点开展示/只读任务列表/kbd 键帽；附截图；不调用真实模型 |
| `agent-details-anchor.spec.ts` | 折叠锚定回归：mock `details-anchor` 台本回放消息末尾长折叠块，贴底展开 summary 零位移（assistant-ui 展开暂停经 `data-message-id` 生效），底部“收起”按钮直接关闭；不调用真实模型 |
| `agent-details-expand.spec.ts` | 展开宽度与胎内解析回归：mock `details-expand` 台本回放长历史 + 原生 details 块，展开前后消息列宽极差 ≤3px，胎内 markdown 二次解析成段落（非源码裸奔）；不调用真实模型 |
| `agent-mermaid.spec.ts` | Mermaid 双修：深色主题节点深底（相对亮度断言）+ 深→亮切换旧图重绘（themeKey remount）+ 普通滚轮不劫持列表滚动（合成滚轮缩放纹丝不动、且不被 preventDefault）+ ±按钮缩放可用；附深/浅截图；不调用真实模型 |
| `agent-rich-result.spec.ts` | 富结果生产链路：真实 MCP `montree_present` 调用→回放→章节比较卡筛选/证据（Markdown 编辑/预览实际章节滚动与原文选区、跨文档禁止）；EPUB 目录就绪、真实跨章节滚动及选区可见；HTML 预览交互/隔离探针（前置脚本禁网、脚本与链接/改名自导航阻止）、静默取消及真实点击导出逐字回读、深色壳截图和主题变化保持 iframe；发现/复放/拒绝回归；不调用真实模型 |
| `agent-generative-ui.spec.ts` | 生成式 UI 生产链路：SVG 图解（真实输入框→模拟模型参数→真实 MCP→内联 SVG，流程/时序/架构/思维导图/泳道图/时间线/鱼骨图/循环图/ER、缩放/节点键盘、亮暗主题不重建、320/390/480 容纳、固定区/浮窗、居中放大同一 iframe、输入拒绝与隔离）+ React artifact 内联（真实工具结果经 codex-acp rawOutput.result→同卡构建→聊天内直接 iframe 可交互，计数/输入状态在宿主更新及放大弹窗中保持，iframe 内 Esc 关闭后状态保留，同一镜像单实例，固定区与悬浮窗均验证点击；编译/运行错误卡内降级，晚到 ready 不覆盖失败；伪造挂载/超高钳制 640/320-390-480 无溢出/超高内部滚动/亮暗截图）+ component-ui 全流程（选维度提交→原 session 回显→证据定位；内置章节对比、单章引用导航与阅读测验经真实工具生成，定位/选择提交均实测）+ 线程隔离；不调用真实模型 |
| `export-pdf.spec.ts` | Markdown 导出 PDF（`E2E_AUTO_EXPORT_PATH`） |
| `typst-editor.spec.ts` | 真实随包 Tinymist：中文路径/CRLF 打开、LSP 补全/诊断修复、未保存 SVG 文字标记及同修订 PDF 回读、iframe 无 preload/无浏览器错误、原生缩放、三种视图宽度、撤销/保存重开/端口释放；另验证工作区 A 保持打开时独立文件 B、另存为 C 的各自根目录与相对 include（仅桩原生对话框）；运行前须准备锁定版本 `apps/desktop/resources/typst/tinymist(.exe)`，缺失会失败，不静默跳过 |
| `quick-open.spec.ts` | 打开文件夹（`E2E_AUTO_OPEN_PATH` 跳过原生对话框）→ Ctrl+P 搜索打开；路径栏定位/窄栏/未保存提示；右键菜单、Shift+F10、禁用项、Escape 与复制路径参数（剪贴板边界桩） |
| `document-tools.spec.ts` | JSON/LOG/HTML/DOCX 通用读取、CSV选区/筛选编辑、XLSX公式保存/外部冲突、PPT元素查询/删改/撤销与保存及原稿段落样式回归（`E2E_DOCUMENT_TOOLS`） |
| `internal-document-links.spec.ts` | HTML 侧栏相对链接、跨文件/同页锚点与 Markdown 相对内链在应用内切换文档；断言不会把应用入口载入 HTML iframe（preload 缺失页） |
| `html-reader-content.spec.ts` | 本地 HTML 阅读 MCP：脚本执行后的可见纯文本、隐藏节点过滤、标题 TOC 与搜索回归，确保返回渲染正文而非 HTML 源码 |
| `text-tools-integration.spec.ts` | mock 模型输出 → 真实 HTTP MCP → IPC → Markdown/TXT/**Typst** 缓冲区；精确选区、重复原文、批量拒绝原子性、全部视图/共享撤销、未保存手动输入、CRLF 保存重开、跨文档及外部冲突校验；Typst 验证 `format=typst`、行分段、选区和保存/撤销 |
| `ppt-tools-integration.spec.ts` | mock 模型工具调用输出 → 真实 HTTP MCP → IPC → PPT 模型/预览/磁盘保存与重开；局部样式保留、拒绝原子性、外部冲突、可见页/选区页和按需检查器，附前后截图与工具记录 |
| `ppt-advanced-tools.spec.ts` | mock 工具输出经真实 MCP 编辑嵌套组合、图表及内嵌工作簿、现有母版/版式、基础动画；预览/放映/定时翻页/退出清理/撤销/保存重开与拒绝原子性，附截图及调用记录 |
| `ppt-slideshow.spec.ts` | 真实全屏单页放映、键盘/鼠标翻页、退出按钮/Esc/系统退出、AI 当前页同步、阅读模式与缩放恢复及全屏拒绝回退和宽高适配 |
| `reader-foliate.spec.ts` | foliate 统一阅读器：EPUB/MOBI 章节可读（`E2E_FOLIATE_READER` 门控测试钩子） |
| `reader-foliate-marks.spec.ts` | foliate 标注链路：划重点/批注/检查器/删除（EPUB+MOBI）；真实文字悬停预览、移入保持、Escape 与连续打开浮层 |
| `reader-footer-nav.spec.ts` | 底栏翻页：收进正文列（不横跨卡片轨）+ 上下单元与正文同步（真实多章节 EPUB） |
| `reader-smoke.spec.ts` | Markdown 预览（Mermaid/公式/高亮）+ PDF 画布文字层（自研最小 fixture） |
| `markdown-live-preview.spec.ts` | 实时预览真实 Electron 回归：表格对齐与精确源单元格、HTML/Markdown 本地图片、KaTeX、Mermaid、代码复制、嵌套引用/提示块、跨空行 details 和内嵌 Mermaid 展开/收起（含独立预览）、XSS 清理、自动链接/引用定义、脚注编号与跨视口回链/长脚注编辑、暗色对比度、源码切换/撤销及新文档默认/TXT 保留原文；附截图 |
| `reader-pdf-structure.spec.ts` | PDF 结构化 WASM：生产包真加载（非回退）+ Agent 正文走结构化（`E2E_PDF_STRUCTURE` 门控测试钩子） |
| `reader-pdf-ocr.spec.ts` | 扫描版 PDF 单页 OCR：「更多工具 → 识别本页」落缓存 + 文字层可读（当前页无文字层会自动识别；`apps/desktop/e2e/fixtures/ocr/scanned-hello.pdf`） |
| `sync-webdav.spec.ts` | 本地内存 WebDAV stub → 设置页测试连接 + 一次同步落数 |
| `web-doc-smoke.spec.ts` | 在线文档：正文选段批注保存及重载恢复、优先渲染 `rel=alternate` Markdown 源（失败回退 HTML）、真实 localhost HTTP 服务读取 mdBook/目录/跨章导航，Rust 代码语法高亮/亮暗主题/逐字复制、mdBook 独立 toc.html 章节树/子章跳转/底栏返回、打开、地址栏换页、目录跳转、论文 SVG 图片与表格对齐/合并/横向滚动 |
| `web-doc-xss.spec.ts` | 在线文档 XSS 回归（真浏览器）：恶意载荷不执行、正文完好 |
| `web-doc-rendering.spec.ts` | Markdown 优先读取后的 Pele 流程/时序图、源码复制、亮暗主题、KaTeX 行内/分式/矩阵与离线本地字体；`E2E_WEB_DOC_RENDERING_LIVE=1` 额外实测 MkDocs Math 与 D2L 线性代数真实网页，并输出截图和公式数量 |
| `reader-visual-context.spec.ts` | 网页/Markdown/EPUB/PDF 图片发现、图片地址和图注、主进程阅读区 PNG 截图（`E2E_READER_VISUAL` 门控，不连接 AI） |

## 在线文档 Fixture

不依赖外网。主进程在设置 `E2E_WEB_DOC_FIXTURE_DIR` 时，对 `e2e.montree.test` 域名从本地 HTML 返回页面：

```
apps/desktop/e2e/fixtures/web-doc/
  manifest.json      # URL → 文件名映射
  start.html
  installation.html
  academic.html      # 论文 object SVG 插图、LaTeXML 表格与宽表
  mdbook-primitives.html / mdbook-literals.html / mdbook-toc.html  # mdBook 独立章节树与深路径导航
  xss.html           # XSS 回归载荷（script / javascript: / 事件处理器）
```

实现：`apps/desktop/electron/services/web-doc/e2e-fixture.ts`（由 `fetchWebDocPage` 优先读取）。

## OCR Fixture

```
apps/desktop/e2e/fixtures/ocr/
  scanned-hello.pdf  # 无文字层单页（Hello Montree OCR），供 OCR 链冒烟只验链路不验精度
```

## 辅助

| 文件 | 说明 |
|------|------|
| `helpers/launch-app.ts` | 启动已构建应用；设置 `E2E_PACKAGED_EXE` 可对指定打包可执行文件运行相同测试 |
| `helpers/web-doc-fixture.ts` | fixture 目录与测试 URL 常量 |
| `helpers/ebook-fixture.ts` | 自研最小 PDF / EPUB / Markdown 生成器（无新依赖） |
| `../src/lib/data/presentation-test-fixture.ts` | 模型与 Electron 测试共用的真实 PPTX 图表/内嵌工作簿/母版/嵌套组合 fixture |

R3 生成式 UI 集成回归（`agent-generative-ui.spec.ts`）：真实 MCP 源码→iframe 提出请求→未确认不发送→宿主确认后原 session 回显；运行错误修复请求走同链。fixture `ARTIFACT_REPLY` 标记携带真实接收 sessionId，不调用真实模型。

历史图表恢复用真实 UI 产生空工具结果→断开重连→会话 `_meta.toolOutputRecovery` 补回原消息→真实图表 iframe 节点交互→页面重载保留且无重复。结果由真实 MCP 生成，Agent 恢复响应用 `mock-window-agent.cjs` 的 `E2E_ACP_TOOL_RECOVERY_FILE` 确定性回放。

Markdown 文档组件回归：markdown-live-preview.spec.ts 覆盖 ER 参数图解（字段与关系）iframe、本地选择汇总、非法源码拒绝、源码往返及阅读预览；agent-generative-ui.spec.ts 验证 montree_markdown_guide 真实 MCP 返回。

`agent-rich-result.spec.ts` 增加网页跨章节：真实 Electron/MCP→目录 href→后台读取另一篇文章→原文验证→mock Agent 回放比较卡 UI，当前阅读页保持不变；网络使用离线网页夹具，不调用真实模型。

`agent-generative-ui.spec.ts` 正文嵌入用例：模拟模型输出真实 MCP 工具结果 ID 引用，验证流式 BeUI 动态占位、原位单卡、落定段落间 SVG 交互、重复引用保护与重载恢复。
