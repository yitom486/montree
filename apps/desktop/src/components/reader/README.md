# src/components/reader

电子书阅读 UI：EPUB / PDF / MOBI（含 AZW3）与**在线文档**。

| 文件 | 功能 |
|------|------|
| `WebDocViewer` | 在线文档阅读（iframe 阅读模式、划词批注、标记侧栏与导出、本页标题大纲） |
| `FoliateReaderViewer` | EPUB / MOBI / AZW3 统一阅读（foliate 后端：章节导航、划词批注、标记侧栏与导出） |
| `PdfViewer` | PDF 主 Viewer（Agent 正文走 WASM 结构化阅读顺序，失败回退 pdf.js；UI/选区坐标系不动；已入库 Agent 正文只读库，缺文抛错不回退 OCR） |
| `PdfPageView` | PDF 单页（渲染 + text layer + 批注 overlay） |
| `PdfOcrBanner` / `PdfOcrTocEditor` | 扫描版 OCR 提示与目录校正（含偏移自动推算、AI 整理槽位） |
| `TocAiPolishControl` | 目录 AI 整理：目录副会话 + 模型/思考档选择 + JSON 解析回填草稿 |
| `ReaderContentShell` / `ReaderToolbarShell` / `ReaderFooterNav` | 阅读区壳、工具栏（纯粹目录/加书签导航 + 右侧卡片流/札记箱/「考考我」智考一级入口）、底栏翻页 |
| `ReaderUnitOutline` / `EpubChapterOutline` | 目录大纲 |
| `FloatingTtsPlayer` | 自由拖拽微晶悬浮球与展开控制面板（默认停靠书本右上角、可自由拖拽记忆坐标、微晶悬浮球与卡片双态平滑切换、视口顶部正文智能起读与一键对齐当前屏幕、全章句子抽屉点选跳转、实时分句滚动高亮、正文 DOM 跟随与语速调节） |
| `ReaderTypographyControls` | 阅读排版控件（字号 / 行距） |
| `ReadingMarkPanel` / `ReadingMarkPopover` | 书签/批注底层面板与点击编辑浮层 |
| `FlashcardReviewDialog` | 沉浸式 3D 闪卡复习弹窗（挖空遮罩、正反翻转、原书一键秒回与记忆打分） |
| `SelectionToolbar` | 划选工具条（划重点、问 Agent、从此句朗读、批注、AI 制卡预设菜单等） |
| `SelectionBubble` | 就地划选悬浮微晶气泡（解释/摘要/制卡/对比/追问五大动作、莫兰迪柔光高亮与复制） |
| `CardPresetMenu` | AI 制卡预设菜单内容（6 方向点选 + 更多要求次级入口，工具条与气泡共用） |
| `DeepAnswerMenu` | 一键深度问答菜单内容（三方向点即直答 + composer 追问入口保留） |
| `DeepAnswerDialog` | 一键深度问答对话框（同会话直答选段、不进右侧时间线，可存为卡片批注） |
| `MarginaliaBar` | 右侧知识卡片轨（分类药丸筛选、全部/单项折叠、AI 智能制卡、智考与闪卡控制台、时序图联动） |
| `KnowledgeCardItem` | 知识卡片单项（批注/概念/引用/方法/图谱/思考微晶卡片、单行与多功能态切换、考考我/闪卡抽认/AI润色） |
| `LibraryDrawer` | 馆藏书卷与在线规范侧拉抽屉（本地书库、在线规范快速切换、检索） |
| `NotesDrawer` | 全书札记中心与知识卡片箱（富文本 Markdown/Mermaid 拓扑渲染、资产盘点看板、彩色分类胶囊、宽屏自适应、一键 AI 智考出卷与闪卡复习） |
| `BracketConnector` | 细线分支抱合括号引线（正文锚点与知识卡片间的发丝级微光连线） |
| `AnnotationNoteDialog` | 批注输入；可选 AI 意图/结果 chip 与草稿确认 |
| `BodyWatermarkPreviewDialog` | 正文水印清洗预览 + 二次确认应用（只读计数/样例 + 签名展示，确认态展示统计/签名，确认后调应用通道，成功展示备份路径/结果；确认前不写库；另有自定义水印文本仅预览区，无应用入口） |
| `PdfBookSearch` | 手动正文搜索（工具栏紧凑触发按钮 + 独立浮层结果面板；已入库 PDF 走 `queryBook(kind='search')` 点击跳页，EPUB/MOBI/AZW3 走内存 `iterateUnits` 点击按章节跳章，扫描未入库仍提示建索引；≥3 字才请求，输入即清旧结果，最多 20 条；逻辑在 `src/lib/reader/pdf/pdf-book-search`） |
| `PdfToolbarMoreMenu` | PDF 工具栏“更多工具”下拉菜单 + 罗盘徽章判定（`resolvePdfIndexBadge`：未入库提示仅扫描版；缩放/适合宽度/单页识别/目录重识/识别印刷目录/清缓存/建索引/重新建索引/水印预览等低频操作收进菜单，工具栏只留导航/搜索/徽章；`resolveRosettaIndexMenuAction`：未入库建、已入库重建，两按钮互斥，导入中都不出现） |
| `ProposeMarkChatBlock`（经 Agent 气泡内嵌） | 正式 Agent / 批注助手会话内批注提议 |
| `EpubMarkTooltip` / `ReadingProgressRing` | EPUB 批注提示、进度环 |

导航状态在 `reader-navigation-store`；纯逻辑在 `src/lib/reader/`（按域分子目录）与 `@montree/reader-core`（`packages/reader-core/src/`，导航/选区/标记/排版等 27 模块已迁入）。
