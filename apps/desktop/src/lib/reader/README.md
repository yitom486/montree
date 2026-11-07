# lib/reader

在线文档中的 Mermaid 代码块由宿主 Pele 管线出图，并保留折叠源码和复制按钮。公式使用随应用打包的 KaTeX 样式/字体，兼容 Sphinx 公式编号；真实网页与断网资源验证见 `../../../e2e/web-doc-rendering.spec.ts`。

EPUB / PDF / MOBI / 在线文档 渲染端专属逻辑，按域分子目录（2026-09 由平铺重构）。
通用导航/选区/标记/排版等 27 模块已迁至外部包 `@yitom/reader-core`；标注合并/纯核/Anki 构建见 `@yitom/annotations`；在线文档目录抽取/站点谓词见 `@montree/web-doc`。

| 子目录 | 管什么 |
|--------|--------|
| `adapter/` | 统一阅读后端适配（foliate 实现 EPUB/MOBI/AZW3）、阅读文件内容指纹 |
| `pdf/` | PDF 打开/渲染/文字层/窗口/worker、WASM 结构化解析（inspector/structure）、扫描探测、导入模式、Agent 搜索闸门、手动全书搜索 |
| `pdf-ocr/` | PDF OCR：页缓存 hydrate/预取/文字层挂载、目录缓存/可用性门/租约锁、自动页 OCR、探测反馈；`pdf-ocr-selection` / `.test` 按原选区矩形恢复文字，支持词内截取且不扩大到整页 |
| `rosetta/` | 罗盘：目录归一与签名状态、块转 Agent 文本、只读取卫、目录 AI 整理（`toc-ai`） |
| `marks/` | 阅读标记渲染/命中（PDF/MOBI/Web 复用）、Markdown 文本引用快照与严格定位（`markdown-preview-reference` / `.test`：上下文/章节消歧、改写或删除不模糊错跳）、划词匹配、启发式智能制卡（`heuristic-card-classifier`）、卡片元数据智能反序列化（`resolve-card-meta`）、图谱卡片解析提取（`diagram-mark-parser`）、导出 Anki/读书笔记 |
| `web-doc/` | 在线文档：`web-doc/web-doc-images.ts`（含 `.test.ts`） 在原图加载失败后调用主进程恢复受保护图片，保留原始 URL/alt、处理 picture/srcset、限制并发并防止重试循环；优先渲染页面声明的 Markdown 源（`buildWebDocPageContentFromMarkdown`，复用编辑器 Markdown 管线，失败回退 HTML 正文提取）、页头剥离、URL/链接、本页大纲、可信 Tab/Playground 脚本集中于 `web-doc/web-doc-runtime-scripts.ts`（供渲染和 CSP/XSS 校验共用）、静态 Tabs 只读降级、公式/代码块（复用本地 highlight.js 语法与 GitHub 亮暗主题）/iframe 白名单、图片 object 降级与论文表格排版、MDN Baseline 状态卡、BCD 浏览器兼容性补表（`web-doc/web-doc-compat.ts`，失败保留原文占位）与文章底部元信息卡、一键转 Markdown 导出、Agent 统一目录索引跨页读取/锚点小节提取与 URL 来源，失败不伪装正文 |
| `tts/` | 独立播放引擎（`tts/playback-engine.ts`，以 `tts/playback-types.ts` 的状态端口与 store 解耦）与音频对齐（详见 [tts/README.md](tts/README.md)）：正文智能降噪清洗（`tts/text-sanitizer.ts`）、端侧声波静音波谷与分句对齐算法（`tts/audio-aligner.ts`，保留用于播放器卡片内部句览与跳转）、Web Audio 实时流式 PCM 播放器（`tts/pcm-player.ts`） |

根目录仅留跨格式骨架：`reader-adapter`（后端契约）、`reader-unit-tree`（目录树）、`scroll-anchor`（视口防抖锚点锁）、`reader-viewport-*`（视口测试助手）、`wait-for-dom`、`text-quality`（替换字符、控制字符、私用字形和孤立代理项检测，保留正常排版字符）、`library-mock-data`（阅读馆 Hacker News 首期频道示例数据与元数据结构）、`azw3-toc-anchor.test`（测 `@yitom/reader-core` 的 azw3 锚定）。

增删或改名后，更新本 README 与上级 [../README.md](../README.md) 的 **reader/** 节。

`reader-blank-click.ts` / `.test.ts`：只识别正文范围内的空白点击，排除文字命中、选区、链接/控件/媒体与滚动条；用 iframe 自身文档坐标判断，不响应窗口其余区域点击。
