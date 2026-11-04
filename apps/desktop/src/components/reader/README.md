# src/components/reader

电子书阅读 UI：EPUB / PDF / MOBI（含 AZW3）与**在线文档**。

| 文件 | 功能 |
|------|------|
| `WebDocViewer` | 在线文档阅读（iframe 阅读模式、划词批注、卡片流与导出、本页标题大纲；拆量子目录 `web-doc/`：`useWebDocNavigation`、`useWebDocInteractions`、`useWebDocSession`：含图片 error/已失败图片的受限恢复，离开文档后忽略迟到资源） |
| `FoliateReaderViewer` | EPUB / MOBI / AZW3 统一阅读（foliate 后端：章节导航、划词批注、卡片流与导出；拆量子目录 `foliate/`：`foliate-theme`、`useFoliateHighlights`、`useFoliateInteractions`、`useFoliateBookSession`） |
| `PdfViewer` | PDF 主 Viewer（Agent 正文走 WASM 结构化阅读顺序，失败回退 pdf.js；UI/选区坐标系不动；已入库 Agent 正文只读库，缺文抛错不回退 OCR；拆量子目录 `pdf/`：`usePdfDocumentSession`、`usePdfRosettaIndex`、`usePdfAgentRegistry`、`usePdfOcrTocManager`、`usePdfInteractions`） |
| `PdfPageView` | PDF 单页（渲染 + text layer + 批注 overlay；原生文字层含替换字符、异常控制字符或私用字形编码时自动 OCR 并切换词层） |
| `PdfOcrBanner` / `PdfOcrTocEditor` | 扫描版 OCR 提示与目录校正（含偏移自动推算、AI 整理槽位） |
| `TocAiPolishControl` | 目录 AI 整理：独立副会话 + 运行时/模型/思考档三级级联选择 + 专属提示词与 montree-toc 工具隔离 + JSON 解析回填草稿 |
| `TocAiLiveDashboard` | 目录 AI 整理实时动态面板：4 阶段进度条、脉冲指示灯、流式思考与工具调用终端卡片、计时器与取消控制 |
| `ReaderContentShell` / `ReaderToolbarShell` / `ReaderFooterNav` | 阅读区壳（卡片通过 WorkspaceCardRail 进入外壳共享辅助区；companionOnly 复用于 Markdown，保留测验/复习/导出；引用待确认提示由调用方提供）、精简工具栏（目录、翻页/缩放、搜索与单一更多菜单；书签/朗读/沉浸等低频操作收进菜单）、底栏翻页 |
| `ReaderUnitOutline` / `EpubChapterOutline` | 目录大纲（支持层级树折叠、双轨目录切换、目录校正与 Markmap 全景思维导图视图） |
| `FloatingTtsPlayer` | 自由拖拽微晶悬浮球与轻量展开控制面板（主体小球稳固锚定、紧凑卡片智能停靠侧翼展开收起、本章第0秒从头完整合成与自由拉动进度条、快退快进15秒与从头重播、无冗余文字干扰、纯净沉浸听书） |
| `ReaderTypographyControls` | 阅读排版控件（字号 / 行距） |
| `ReadingMarkPopover` | 正文标记点击编辑浮层（共享 Morph 壳、边缘避让、键盘关闭）；列表统一由卡片流管理 |
| `FlashcardReviewDialog` | 沉浸式 3D 闪卡复习弹窗（挖空遮罩、正反翻转、原书一键秒回与记忆打分） |
| `SelectionToolbar` | 划选工具条（复制、高亮色板+写批注、翻译、朗读、单一 AI 菜单；AI 菜单内含制卡预设、快速问答与去 Agent 面板） |
| `SelectionAiMenu` | 划选 AI 菜单内容（生成卡片 6 预设 + 更多要求、快速问答 3 方向、去 Agent 面板细问） |
| `TranslationSurface` | 复用 Dialog 的非模态翻译浮窗，D3 拖动/方向键移动；关闭位置过渡，按帧写入 transform，尺寸变化时更新边界缓存；最大高度与固定操作区；浮窗位置写回 Zustand，焦点移出/窗口状态变化不关闭，仅 × 或正文空白点击关闭 |
| `TranslationCard` | 划词翻译非模态锚定卡：assistant-ui 流式译文、语言方向、关键短语/专有名词说明、复制/重试/存为批注；译文字段按真实文本增量持续显示，短语/术语工具事件逐项显示，ScrollArea 限高滚动；不展示普通消息/思考/JSON；三阅读器锁定原选区新增批注，PDF OCR 换层保留原页几何；`foliate/translation-note-anchors.test` 覆盖 EPUB/MOBI 的 CFI/章节与已有笔记保护 |
| `DeepAnswerDialog` | 一键深度问答对话框（同会话直答选段、不进右侧时间线，可存为卡片批注） |
| `MarginaliaBar` | 右侧知识卡片轨（统一管理批注/划线/书签；单一类型筛选菜单、全部/单项折叠、AI 智能制卡；测验/闪卡/导出集中在卡片操作菜单、时序图联动） |
| `KnowledgeCardItem` | 知识卡片单项（批注/概念/引用/方法/图谱/思考微晶卡片、单行与多功能态切换、考考我/闪卡抽认/AI润色） |
| `LibraryDrawer` | 馆藏书卷与在线规范侧拉抽屉（旧版抽屉组件，保留兼容） |
| `LibraryWorkspaceMain` | 阅读馆主工作区完整页面：发现（通用资讯流：Hacker News / Lobsters / 精选 RSS，来源切换、频道、搜索与未读筛选、稍后读/书架快捷操作）、书架、稍后阅读、最近阅读；列表数据由主进程适配器拉取，点击条目才抓取正文 |
| `library/` | 阅读馆子组件：`FeedStream`（来源/频道切换、加载/错误/空态与刷新）、`FeedRow`（条目行与快捷操作）、`ShelfView` / `ReadLaterView` / `RecentView`（书架、待读与足迹视图）、`format`（相对时间/域名/文件名） |
| `NotesDrawer` | 全书札记中心与知识卡片箱（富文本 Markdown/Mermaid 拓扑渲染、资产盘点看板、彩色分类胶囊、宽屏自适应、一键 AI 智考出卷与闪卡复习） |
| `BracketConnector` | 细线分支抱合括号引线（正文锚点与知识卡片间的发丝级微光连线） |
| `AnnotationNoteDialog` | 批注输入；可选 AI 意图/结果 chip 与草稿确认 |
| `BodyWatermarkPreviewDialog` | 正文水印清洗预览 + 二次确认应用（只读计数/样例 + 签名展示，确认态展示统计/签名，确认后调应用通道，成功展示备份路径/结果；确认前不写库；另有自定义水印文本仅预览区，无应用入口） |
| `PdfBookSearch` | 手动正文搜索（工具栏紧凑触发按钮 + 独立浮层结果面板；已入库 PDF 走 `queryBook(kind='search')` 点击跳页，EPUB/MOBI/AZW3 走内存 `iterateUnits` 点击按章节跳章，扫描未入库仍提示建索引；≥3 字才请求，输入即清旧结果，最多 20 条；逻辑在 `src/lib/reader/pdf/pdf-book-search`） |
| `PdfZoomControls` | PDF 顶栏一体化微晶缩放胶囊（步进缩小/放大、百分比下拉预设菜单与一键适合宽度，支持 Ctrl+滚轮与快捷键联动） |
| `PdfToolbarMoreMenu` | 阅读器共用“更多工具”下拉菜单 + PDF 罗盘徽章判定（`resolvePdfIndexBadge`：未入库提示仅扫描版；缩放/适合宽度/单页识别/目录重识/识别印刷目录/清缓存/建索引/重新建索引/水印预览等低频操作收进菜单，工具栏只留导航/搜索/徽章；`resolveRosettaIndexMenuAction`：未入库建、已入库重建，两按钮互斥，导入中都不出现） |
| `ProposeMarkChatBlock`（经 Agent 气泡内嵌） | 正式 Agent / 批注助手会话内批注提议 |
| `EpubMarkTooltip` / `ReadingProgressRing` | EPUB/PDF/网页批注和重点预览（延迟打开、鼠标移入保持、离开收起）、进度环 |
| `EpubMarkTooltip.test.ts` | 悬停延迟、纯重点预览、移入保持与操作浮层互斥回归 |

导航状态在 `reader-navigation-store`；纯逻辑在 `src/lib/reader/`（按域分子目录）与 `@montree/reader-core`（`packages/reader-core/src/`，导航/选区/标记/排版等 27 模块已迁入）。

WebDoc 的 Agent provider 以 documentId 注册（与目录/批注一致），提供 getUnits/getCurrentUnitIndex；跨文章读取复用 web-doc-agent-content，不导航当前阅读页，不吞取文错误。
