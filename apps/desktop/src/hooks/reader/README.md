# hooks/reader

电子书阅读 Hook。含 `useWebDocPage`（在线文档页面；优先使用页面声明的 Markdown 源，失败回退 HTML）、`useWebDocToc`（目录发现）、`useFeed`（通用资讯流：HN / Lobsters / RSS / arXiv，无限分页与来源级缓存、localStorage 快照）、`useHnDiscussionLookup`（手动打开文章时按 URL 反查 HN 讨论，24 小时缓存、失败静默）、`useOcrComponent`（OCR 语言包状态与下载）、`useReaderSelectionActions`（三阅读器划选工具条共享动作）、`useReaderExportMenu`（三阅读器笔记与 Anki 导出菜单共享外壳）、`usePdfPageOcr`（PDF 单页 OCR：页缓存/识别去重/统一正文读取）。文件说明见 [../README.md](../README.md) 的 **reader/** 节。

增删或改名后，更新上级 README。
