# lib/reader

EPUB / PDF / MOBI / 在线文档 渲染端专属逻辑，按域分子目录（2026-09 由平铺重构）。
通用导航/选区/标记/排版等 27 模块已迁 `@montree/reader-core`（`packages/reader-core/src/`）；标注合并/纯核/Anki 构建见 `@montree/annotations`；在线文档目录抽取/站点谓词见 `@montree/web-doc`。

| 子目录 | 管什么 |
|--------|--------|
| `adapter/` | 统一阅读后端适配（foliate 实现 EPUB/MOBI/AZW3）、阅读文件内容指纹 |
| `pdf/` | PDF 打开/渲染/文字层/窗口/worker、WASM 结构化解析（inspector/structure）、扫描探测、导入模式、Agent 搜索闸门、手动全书搜索 |
| `pdf-ocr/` | PDF OCR：页缓存 hydrate/预取/文字层挂载、目录缓存/可用性门/租约锁、自动页 OCR、探测反馈 |
| `rosetta/` | 罗盘：目录归一与签名状态、块转 Agent 文本、只读取卫、目录 AI 整理（`toc-ai`） |
| `marks/` | 阅读标记渲染/命中（PDF/MOBI/Web 复用）、划词匹配、启发式智能制卡（`heuristic-card-classifier`）、卡片元数据智能反序列化（`resolve-card-meta`）、导出 Anki/读书笔记 |
| `web-doc/` | 在线文档：正文提取、页头剥离、URL/链接、本页大纲、公式/代码块/iframe 白名单、Agent 按页抓文 |

根目录仅留跨格式骨架：`reader-adapter`（后端契约）、`reader-unit-tree`（目录树）、`scroll-anchor`（视口防抖锚点锁）、`reader-viewport-*`（视口测试助手）、`wait-for-dom`、`azw3-toc-anchor.test`（测 `@montree/reader-core` 的 azw3 锚定）。

增删或改名后，更新本 README 与上级 [../README.md](../README.md) 的 **reader/** 节。
