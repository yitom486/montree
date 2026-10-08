# lib/reader/tts — 语音朗读与音频对齐模块

本目录包含 Montree 桌面端阅读器（EPUB / PDF / MOBI / WebDoc）专属的文本清洗、声学对齐与流式音频底层逻辑。

## 模块清单

| 模块 | 核心职责 | 当前工作模式与状态说明 |
|------|----------|------------------------|
| `text-sanitizer.ts` | 正文智能降噪清洗器 | 提取章节正文时剥离 URL、Markdown 语法标记、角标与纯控制字符；保留可读文本；根据视口正文首句智能定位起读起始句索引。 |
| `audio-aligner.ts` | 声学 VAD 与时序对齐器 | **【保留算法 / 技术储备】**<br>包含基于字数动态加权与短时能量/过零率（VAD）声学静音波谷检测的时间轴对齐算法。<br>**当前用途**：为单章节整音频提供分句估算 `startTime`，仅用于悬浮播放器卡片内部的“当前句文字预览”以及“全章句子列表抽屉”的点选跳转（Seek）。正文 DOM 临时高亮目前已主动暂停。 |
| `pcm-player.ts` | Web Audio 流式 PCM 播放器 | 基于原生 AudioContext 的低延迟流式 PCM 音频播放器，用于首包快速起播与实时音频缓冲。 |

---

## 关于正文高亮与对齐算法的保留说明

### 1. 为什么暂停正文 DOM 实时高亮？
- **单章整音频与免费额度保护**：为避免频繁发起小段请求触发 API 速率与额度限制（如 Gemini Flash TTS 每日配额限制），Montree 采用“一章一次性合成完整音频”的方案。
- **声学停顿 vs 标点语义**：端侧纯声学 VAD（能量波谷检测）可以精准捕捉无声段，但在面对学术长难句（包含破折号、逗号、多层从句停顿）时，声学静音难以百分之百区分句内停顿与句尾句号，容易在特定长句中提前跳句，产生视觉干扰。
- **降噪决策**：为了保证读者专注沉浸阅读，正文 DOM 高亮（`CSS.highlights` / `.montree-tts-highlight`）已暂时切断发射，书籍正文保持绝对纯净。

### 2. 为何完整保留对齐算法与阅读器接收管道？
- **播放器内部功能依赖**：[audio-aligner.ts](./audio-aligner.ts) 仍然稳定支持播放器卡片内部的分句展示、全句列表查看与点击单句跳转音频；
- **阅读器接收管道保留**：
  - [useFoliateHighlights.ts](../../../components/reader/foliate/useFoliateHighlights.ts) 与 [usePdfInteractions.ts](../../../components/reader/pdf/usePdfInteractions.ts) 中的 `subscribeTtsHighlight` 管道已全部打通并保留在静默状态；
- **后续演进路线**：后续若接入自带精确词级时间戳的模型服务（如 Azure Speech `WordBoundary` 事件、OpenAI / Whisper 本地对齐器、或带有对齐元数据的批处理服务），只需在发射端重新广播事件，阅读器高亮与滚动联动即可无缝瞬间复活，无需重构底层。
