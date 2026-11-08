# lib/reader/tts — 语音朗读与音频对齐模块

本目录包含 Montree 桌面端阅读器（EPUB / PDF / MOBI / WebDoc）专属的文本清洗、声学对齐与播放引擎。引擎通过 `playback-types.ts` 定义的快照端口读取配置、回写状态，不导入 React、Zustand 或任何 store；音频、流订阅、计时器与播放代际均归实例管理。

## 模块清单

| 模块 | 核心职责 | 当前工作模式与状态说明 |
|------|----------|------------------------|
| `playback-engine.ts` / `playback-engine.test.ts` | 独立播放引擎与生命周期回归 | `createTtsPlaybackEngine` 接收 `getState` / `setState` 端口，负责流式/缓存/系统语音播放、暂停、跳转、接收中断、播放位置保存、正文高亮与下一章预取；`dispose` 保存位置、取消流、释放音频并清理计时器。 |
| `playback-types.ts` | 播放状态与操作契约 | `TtsPlaybackState` / `TtsPlaybackActions` / `TtsPlaybackStatePort`；不依赖具体状态库。 |
| `text-sanitizer.ts` | 正文智能降噪清洗器 | 提取章节正文时剥离 URL、Markdown 语法标记、角标与纯控制字符；保留可读文本；根据视口正文首句智能定位起读起始句索引。 |
| `audio-aligner.ts` | 声学 VAD 与时序对齐器 | 支持微软 Azure 官方 Speech SDK 实时 `SentenceBoundary` / `WordBoundary` 精确时间轴对齐（`alignSentencesWithBoundaries`），实现毫秒级绝对同步；同时保留基于字数动态加权与短时能量/过零率（VAD）声学静音波谷检测的时间轴对齐算法兜底。 |
| `pcm-player.ts` | Web Audio 流式 PCM 播放器 | 首包快速起播、分片调度、累计已接收时长与播放队列耗尽状态；耗尽时由播放引擎区分等待新分片与真正播放完成。 |
| `playback-progress.ts` | 播放进度计算 | 尚未接收完成时按已验证、可播放音频计算进度；整章完成后按实际总时长计算，避免正文估算时长让进度条几乎不移动。回归测试见 `playback-progress.test.ts`。 |

---

## 关于正文高亮与对齐算法的说明

### 1. 来源分化的正文高亮策略（Azure / 完整缓存启用，Gemini 纯净）
- **微软 Azure 语音与本地已存音频**：使用微软 Azure 官方 Speech SDK 引擎合成，实时捕获官方 `SentenceBoundary` 边界事件并持久化保存为 `.timeline.json` 磁盘缓存。播放时直接基于官方精确时间轴对齐，向阅读器（EPUB / PDF）广播 `emitTtsHighlight` 事件，按边界时间戳驱动正文句子高亮跟随与平滑居中滚动。支持在悬浮播放器顶部按钮及设置面板中随时一键开关。
- **Google Gemini 在线流式**：在线实时请求时采用 800 字分段流式切片与动态时长拼接，为避免长难句能量停顿判断带来的跳句干扰，接收期间自动保持静默纯净阅读，书籍页面完全不添加干扰标记；整章接收完毕落盘后，再次播放即可基于完整音频享受平滑高亮。

### 2. 阅读器接收管道打通状态
- [useFoliateHighlights.ts](../../../components/reader/foliate/useFoliateHighlights.ts) 与 [usePdfInteractions.ts](../../../components/reader/pdf/usePdfInteractions.ts) 中的 `subscribeTtsHighlight` 管道全量打通，使用 CSS Custom Highlight API（`::highlight(montree-tts-active)`）提供原生高性能半透明高亮，超出可视区时平滑平移居中。
- 微软 Azure Speech SDK 官方 `SentenceBoundary` 毫秒级时间戳已全链路贯通（上游 `gemini-tts-studio@0.3.3` -> 主进程 [tts-service.ts](../../../../electron/services/tts/tts-service.ts) 本地时间轴缓存 -> 渲染端 [playback-engine.ts](./playback-engine.ts)），优先使用服务端返回的边界时间戳对齐。

## 与 store 的职责边界

- [tts-store.ts](../../../stores/tts-store.ts)（见 [stores/README.md](../../../stores/README.md)）保留公开选择器与动作、设置校验、配置同步、播放器位置和持久化快照；组件调用方式不变。
- 引擎持有 `Audio`、`PcmStreamPlayer`、系统语音对象、取消函数与计时器，通过状态端口发布播放快照；关闭播放器、切章及热更新时释放旧资源，迟到回调不覆盖新播放。
- `montree_tts_preferences` 的存储键和原有持久化字段保持兼容；配置仍由 store 保存偏好并同步主进程，本次拆分不改变配置存储策略。
- 原有接收/播放/恢复用例见 `../../../stores/tts-store-stream.test.ts`；引擎实例隔离与资源释放用例见 `playback-engine.test.ts`。
