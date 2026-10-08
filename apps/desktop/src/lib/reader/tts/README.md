# lib/reader/tts — 语音朗读与音频对齐模块

本目录包含 Montree 桌面端阅读器（EPUB / PDF / MOBI / WebDoc）专属的文本清洗、声学对齐与流式音频底层逻辑。

## 模块清单

| 模块 | 核心职责 | 当前工作模式与状态说明 |
|------|----------|------------------------|
| `text-sanitizer.ts` | 正文智能降噪清洗器 | 提取章节正文时剥离 URL、Markdown 语法标记、角标与纯控制字符；保留可读文本；根据视口正文首句智能定位起读起始句索引。 |
| `audio-aligner.ts` | 声学 VAD 与时序对齐器 | 支持微软 Azure 官方 Speech SDK 实时 `SentenceBoundary` / `WordBoundary` 精确时间轴对齐（`alignSentencesWithBoundaries`），实现毫秒级绝对同步；同时保留基于字数动态加权与短时能量/过零率（VAD）声学静音波谷检测的时间轴对齐算法兜底。 |
| `pcm-player.ts` | Web Audio 流式 PCM 播放器 | 首包快速起播、分片调度、累计已接收时长与播放队列耗尽状态；耗尽时由 store 区分等待新分片与真正播放完成。 |
| `playback-progress.ts` | 播放进度计算 | 尚未接收完成时按已验证、可播放音频计算进度；整章完成后按实际总时长计算，避免正文估算时长让进度条几乎不移动。回归测试见 `playback-progress.test.ts`。 |

---

## 关于正文高亮与对齐算法的说明

### 1. 来源分化的正文高亮策略（Azure / 完整缓存启用，Gemini 纯净）
- **微软 Azure 语音与本地已存音频**：使用微软 Azure 官方 Speech SDK 引擎合成，实时捕获官方 `SentenceBoundary` 边界事件并持久化保存为 `.timeline.json` 磁盘缓存。播放时直接基于官方精确时间轴对齐，向阅读器（EPUB / PDF）广播 `emitTtsHighlight` 事件，实现**100% 毫秒级零漂移的正文句子高亮跟随与平滑居中滚动**。支持在悬浮播放器顶部按钮及设置面板中随时一键开关。
- **Google Gemini 在线流式**：在线实时请求时采用 800 字分段流式切片与动态时长拼接，为避免长难句能量停顿判断带来的跳句干扰，接收期间自动保持静默纯净阅读，书籍页面完全不添加干扰标记；整章接收完毕落盘后，再次播放即可基于完整音频享受平滑高亮。

### 2. 阅读器接收管道打通状态
- [useFoliateHighlights.ts](../../../components/reader/foliate/useFoliateHighlights.ts) 与 [usePdfInteractions.ts](../../../components/reader/pdf/usePdfInteractions.ts) 中的 `subscribeTtsHighlight` 管道全量打通，使用 CSS Custom Highlight API（`::highlight(montree-tts-active)`）提供原生高性能半透明高亮，超出可视区时平滑平移居中。
- 微软 Azure Speech SDK 官方 `SentenceBoundary` 毫秒级时间戳已全链路贯通（上游 `gemini-tts-studio@0.3.3` -> 主进程 [tts-service.ts](../../../../electron/services/tts/tts-service.ts) 本地时间轴缓存 -> 渲染端 [tts-store.ts](../../../stores/tts-store.ts)），实现零额外费用、零时间漂移的官方绝对词句对齐。
