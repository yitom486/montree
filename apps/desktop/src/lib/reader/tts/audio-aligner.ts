import type { SentenceItem } from './text-sanitizer'
import { base64ToBytes } from './pcm-player'
import type { TtsSpeechBoundary } from '@montree/contracts'

/**
 * 音频-文本静态时间标记（AudioTextCueMarker）
 * 每一项代表一段完全确定的静态时间区间，数量与文本句子严格 1:1 恒等对齐。
 */
export interface AudioTextCueMarker {
  /** 唯一标记 ID（与句子 ID 严格 1:1 绑定） */
  id: string
  /** 全局句子序号（0 到 N-1） */
  index: number
  /** 对应正文 */
  text: string
  /** 字符字数 */
  charCount: number
  /** 静态物理起始时间（秒） */
  startTime: number
  /** 静态物理结束时间（秒） */
  endTime: number
  /** 静态发声持续时长（秒，endTime - startTime） */
  duration: number
  /** 句末检测到的声学真实物理停顿时长（秒，连读为 0） */
  detectedPauseSec: number
  /** 标记类型：声学物理停顿锚定 | 客观字符比例插值 | 微软官方时间轴 */
  alignmentType: 'acoustic-vad' | 'proportional' | 'azure-boundary'
}

/**
 * 音频对齐配置项
 */
export interface AlignmentOptions {
  /** 期望的分析帧步长（秒，默认 10ms） */
  hopSizeSec?: number
  /** 期望的分析窗长度（秒，默认 20ms） */
  frameSizeSec?: number
  /** 单句最小物理持续时间（秒，防止过度挤压，默认 0.18s） */
  minSentenceDurationSec?: number
  /** 判定为物理发音停顿的最小静音时长（秒，默认 0.10s） */
  minSilenceDurationSec?: number
}

/**
 * 真实声学物理停顿区间
 */
export interface SilenceInterval {
  startSec: number
  endSec: number
  durationSec: number
  midSec: number
  avgEnergy: number
}

/**
 * 计算 PCM 采样的 RMS（均方根）振幅能量流与自适应物理静音评估
 */
export function computeRmsEnergyContour(
  samples: Float32Array,
  sampleRate: number,
  hopSizeSec = 0.01,
  frameSizeSec = 0.02,
): { energies: Float32Array; hopSizeSec: number; silenceThreshold: number } {
  const hopSamples = Math.max(1, Math.round(hopSizeSec * sampleRate))
  const frameSamples = Math.max(hopSamples, Math.round(frameSizeSec * sampleRate))
  const numFrames = Math.max(1, Math.floor((samples.length - frameSamples) / hopSamples) + 1)
  const energies = new Float32Array(numFrames)

  let sumEnergy = 0
  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSamples
    const end = Math.min(samples.length, start + frameSamples)
    let sumSquares = 0
    for (let i = start; i < end; i++) {
      const val = samples[i]
      sumSquares += val * val
    }
    const rms = Math.sqrt(sumSquares / (end - start || 1))
    energies[f] = rms
    sumEnergy += rms
  }

  const avgEnergy = sumEnergy / numFrames

  // 自适应双门限计算：提取底噪水平（低分位数）与平均发音能量的几何平衡点
  const sorted = energies.slice().sort()
  const lowNoisePercentile = sorted[Math.floor(sorted.length * 0.15)] || 0.001
  const silenceThreshold = Math.max(0.003, Math.min(avgEnergy * 0.20, lowNoisePercentile * 3.0 + 0.005))

  return { energies, hopSizeSec, silenceThreshold }
}

/**
 * 从音频波形能量流中提取所有真实物理发生的停顿与静音段（Real Acoustic Silence Detection）
 */
export function detectAcousticSilenceIntervals(
  energies: Float32Array,
  hopSizeSec: number,
  silenceThreshold: number,
  minSilenceDurationSec = 0.10,
): SilenceInterval[] {
  const minFrames = Math.max(1, Math.round(minSilenceDurationSec / hopSizeSec))
  const intervals: SilenceInterval[] = []

  let inSilence = false
  let silenceStartFrame = 0
  let energySum = 0

  for (let f = 0; f < energies.length; f++) {
    const e = energies[f]
    if (e <= silenceThreshold) {
      if (!inSilence) {
        inSilence = true
        silenceStartFrame = f
        energySum = 0
      }
      energySum += e
    } else {
      if (inSilence) {
        inSilence = false
        const durationFrames = f - silenceStartFrame
        if (durationFrames >= minFrames) {
          const startSec = silenceStartFrame * hopSizeSec
          const endSec = f * hopSizeSec
          intervals.push({
            startSec,
            endSec,
            durationSec: endSec - startSec,
            midSec: (startSec + endSec) / 2,
            avgEnergy: energySum / durationFrames,
          })
        }
      }
    }
  }

  if (inSilence) {
    const durationFrames = energies.length - silenceStartFrame
    if (durationFrames >= minFrames) {
      const startSec = silenceStartFrame * hopSizeSec
      const endSec = energies.length * hopSizeSec
      intervals.push({
        startSec,
        endSec,
        durationSec: endSec - startSec,
        midSec: (startSec + endSec) / 2,
        avgEnergy: energySum / durationFrames,
      })
    }
  }

  return intervals
}

/**
 * 构建完全静态、确定性的音频-文本标记列表（Static Cue Markers）：
 * 1. 严格数量守恒：生成的 Marker 数量绝对 100% 等于输入的句子数量 N；
 * 2. 静态固化时间：利用声学物理停顿为锚点，将全量句间切分点完全固化为不可变静态数组；
 * 3. 彻底消除动态探测带来的时钟抖动与混乱。
 */
export function buildStaticCueMarkers(
  sentences: SentenceItem[],
  totalDurationSeconds: number,
  samples?: Float32Array,
  sampleRate?: number,
  options?: AlignmentOptions,
): AudioTextCueMarker[] {
  const n = sentences.length
  if (n === 0) return []

  const dur = Math.max(0.1, totalDurationSeconds)
  if (n === 1) {
    const s = sentences[0]
    return [
      {
        id: s.id,
        index: 0,
        text: s.text,
        charCount: Math.max(1, (s.cleanText ?? s.text ?? '').length),
        startTime: 0,
        endTime: dur,
        duration: dur,
        detectedPauseSec: 0,
        alignmentType: 'proportional',
      },
    ]
  }

  const nSplits = n - 1

  // 1. 计算以字数为坚实主干的先验权重与预期时长
  const charCounts = sentences.map((s) => Math.max(1, (s.cleanText ?? s.text ?? '').length))
  const weights = sentences.map((s, idx) => {
    const chars = charCounts[idx]
    const trimmed = (s.text ?? '').trim()
    const pauseBonus = s.isParagraphEnd
      ? 1.5
      : /[。！？!?]$/.test(trimmed)
        ? 1.0
        : /[；;，,]$/.test(trimmed)
          ? 0.3
          : 0.1
    return chars + pauseBonus
  })
  const totalWeight = weights.reduce((acc, w) => acc + w, 0)

  // 2. 注入物理语速铁律（物理硬下限与硬上限）：
  // 支持最高约 14.0 字/秒（涵盖快语速与英文多音节），杜绝挤压崩塌的同时保留充裕吸附空间。
  const rawMinDurations = charCounts.map((chars) => Math.max(0.2, chars / 14.0))
  const totalRawMin = rawMinDurations.reduce((sum, d) => sum + d, 0)
  const minScale = totalRawMin > 0 ? Math.min(1.0, (dur * 0.75) / totalRawMin) : 1.0
  const minDurations = rawMinDurations.map((d) => d * minScale)

  // 计算后缀累积最小物理时长与后缀权重，确保当前切分点绝不挤爆后面的句子，且始终自适应剩余时长
  const suffixMinRemaining = new Float64Array(n)
  const suffixWeights = new Float64Array(n)
  let sumSuffixMin = 0
  let sumSuffixWeight = 0
  for (let i = n - 1; i >= 0; i--) {
    suffixMinRemaining[i] = sumSuffixMin
    sumSuffixMin += minDurations[i]

    sumSuffixWeight += weights[i]
    suffixWeights[i] = sumSuffixWeight
  }

  // 3. 提取高置信度声学真实物理停顿（过滤微小逗号、爆破音与换气噪音）
  let candidatePauses: SilenceInterval[] = []
  if (samples && sampleRate && samples.length > 0) {
    const contour = computeRmsEnergyContour(samples, sampleRate, options?.hopSizeSec, options?.frameSizeSec)
    const minSilence = options?.minSilenceDurationSec ?? 0.12 // 识别 >= 0.12s 的物理停顿
    const rawPauses = detectAcousticSilenceIntervals(
      contour.energies,
      contour.hopSizeSec,
      contour.silenceThreshold,
      minSilence,
    )
    candidatePauses = rawPauses.filter((p) => p.midSec >= 0.2 && p.midSec <= dur - 0.2)
  }

  // 4. 动态递推自适应对齐（Adaptive Progressive Alignment）：
  // 核心突破：每一句的目标时间点基于「上一句真实结束点 + 当前句在剩余时间中的自适应权重比例」，
  // 绝不受限于全局静态未位移坐标，彻底消除长音频中局部语速波动导致的全局累积脱靶！
  const splitPoints: number[] = []
  const pauseDurs: number[] = []
  const alignTypes: ('acoustic-vad' | 'proportional')[] = []
  let lastTime = 0

  for (let i = 0; i < nSplits; i++) {
    const curMinDur = minDurations[i]
    const minAllowedTime = lastTime + curMinDur
    const maxAllowedTime = Math.max(minAllowedTime, dur - suffixMinRemaining[i])

    // 自适应剩余时长与动态目标时间点
    const remainingTime = Math.max(0, dur - lastTime)
    const remainingWeight = suffixWeights[i]
    const adaptiveDur = remainingWeight > 0 ? (weights[i] / remainingWeight) * remainingTime : curMinDur
    const targetTime = Math.min(maxAllowedTime, Math.max(minAllowedTime, lastTime + adaptiveDur))

    // 动态弹性磁吸窗口（允许真实口语中高达 2x 语速/停顿起伏，最小 ±2.5s，最大 ±5.0s）
    const snapTolerance = Math.min(5.0, Math.max(2.5, adaptiveDur * 0.85))
    const snapWindowStart = Math.max(minAllowedTime, targetTime - snapTolerance)
    const snapWindowEnd = Math.min(maxAllowedTime, targetTime + snapTolerance)

    let chosen = targetTime
    let chosenPauseDur = 0
    let chosenAlignType: 'acoustic-vad' | 'proportional' = 'proportional'

    if (snapWindowStart < snapWindowEnd && candidatePauses.length > 0) {
      const matching = candidatePauses.filter(
        (p) => p.midSec >= snapWindowStart && p.midSec <= snapWindowEnd,
      )
      if (matching.length > 0) {
        // 在自适应窗口内挑选与目标时间最近、停顿最清晰（能量低、时长足）的声学锚点
        let best = matching[0]
        let bestScore = Number.POSITIVE_INFINITY
        for (const p of matching) {
          const diff = Math.abs(p.midSec - targetTime)
          const clarity = Math.max(0.1, p.durationSec)
          const score = diff / clarity + p.avgEnergy * 15
          if (score < bestScore) {
            bestScore = score
            best = p
          }
        }
        chosen = Math.min(maxAllowedTime, Math.max(minAllowedTime, best.midSec))
        chosenPauseDur = best.durationSec
        chosenAlignType = 'acoustic-vad'

        // 丢弃所有已过时停顿，保证单调递增
        candidatePauses = candidatePauses.filter((p) => p.midSec > chosen + 0.05)
      }
    }

    splitPoints.push(chosen)
    pauseDurs.push(chosenPauseDur)
    alignTypes.push(chosenAlignType)
    lastTime = chosen
  }

  // 4. 将区间打包为严格等于 n 的静态不可变标记列表
  const markers: AudioTextCueMarker[] = []
  let prevTime = 0

  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1
    const endTime = isLast ? dur : splitPoints[i]
    const s = sentences[i]
    markers.push({
      id: s.id,
      index: i,
      text: s.text,
      charCount: charCounts[i],
      startTime: prevTime,
      endTime,
      duration: endTime - prevTime,
      detectedPauseSec: isLast ? 0 : pauseDurs[i],
      alignmentType: isLast ? 'proportional' : alignTypes[i],
    })
    prevTime = endTime
  }

  return markers
}

/**
 * 纯静态标记二分查表器（Static Lookup）：
 * 确定性根据播放秒数定位当前激活的 Marker 索引，零动态抖动。
 */
export function findActiveMarkerIndex(
  markers: (AudioTextCueMarker | SentenceItem)[],
  currentTimeSeconds: number,
): number {
  if (markers.length === 0) return -1
  if (currentTimeSeconds <= (markers[0].startTime ?? 0)) return 0
  const last = markers[markers.length - 1]
  const lastEnd = last.endTime ?? 0
  if (lastEnd > 0 && currentTimeSeconds >= lastEnd) return markers.length - 1

  let low = 0
  let high = markers.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const m = markers[mid]
    const start = m.startTime ?? 0
    const end = m.endTime ?? start

    if (currentTimeSeconds >= start && currentTimeSeconds < end) {
      return mid
    }
    if (currentTimeSeconds < start) {
      high = mid - 1
    } else {
      low = mid + 1
    }
  }

  return Math.max(0, Math.min(markers.length - 1, low - 1))
}

/**
 * 将句子列表与解码后的单声道音频数据进行声学停顿检测与对齐，生成 1:1 真实物理时间轴
 */
export function alignSentencesWithAudioSamples(
  sentences: SentenceItem[],
  samples: Float32Array,
  sampleRate: number,
  totalDurationSeconds: number,
  options?: AlignmentOptions,
): SentenceItem[] {
  const staticMarkers = buildStaticCueMarkers(
    sentences,
    totalDurationSeconds,
    samples,
    sampleRate,
    options,
  )

  return sentences.map((s, idx) => {
    const m = staticMarkers[idx]
    return {
      ...s,
      startTime: m.startTime,
      endTime: m.endTime,
      detectedPauseSec: m.detectedPauseSec,
      alignmentType: m.alignmentType,
    }
  })
}

/**
 * 解码二进制音频并进行纯声学真实停顿对齐（浏览器 / Web Audio 环境）
 */
export async function alignSentencesWithAudio(
  sentences: SentenceItem[],
  audioBinaryOrUrl: ArrayBuffer | Uint8Array | string,
  totalDurationSeconds: number,
  options?: AlignmentOptions,
): Promise<SentenceItem[]> {
  if (sentences.length === 0) return []
  if (sentences.length === 1) {
    return [{ ...sentences[0], startTime: 0, endTime: totalDurationSeconds, detectedPauseSec: 0 }]
  }

  const fallbackWithProportional = (): SentenceItem[] => {
    const staticMarkers = buildStaticCueMarkers(sentences, totalDurationSeconds, undefined, undefined, options)
    return sentences.map((s, idx) => {
      const m = staticMarkers[idx]
      return {
        ...s,
        startTime: m.startTime,
        endTime: m.endTime,
        detectedPauseSec: m.detectedPauseSec,
        alignmentType: m.alignmentType,
      }
    })
  }

  if (typeof window === 'undefined') {
    return fallbackWithProportional()
  }

  try {
    let arrayBuffer: ArrayBuffer

    if (typeof audioBinaryOrUrl === 'string') {
      const bytes = base64ToBytes(audioBinaryOrUrl)
      if (bytes.length === 0) {
        return fallbackWithProportional()
      }
      arrayBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer
    } else if (audioBinaryOrUrl instanceof Uint8Array) {
      arrayBuffer = audioBinaryOrUrl.buffer.slice(
        audioBinaryOrUrl.byteOffset,
        audioBinaryOrUrl.byteOffset + audioBinaryOrUrl.byteLength,
      ) as ArrayBuffer
    } else {
      arrayBuffer = audioBinaryOrUrl as ArrayBuffer
    }

    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) {
      return fallbackWithProportional()
    }

    const ctx = new AudioContextClass()
    let audioBuffer: AudioBuffer
    try {
      audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
    } finally {
      if (ctx.state !== 'closed') {
        void ctx.close()
      }
    }

    const actualDuration = audioBuffer.duration || totalDurationSeconds
    const channelData = audioBuffer.getChannelData(0)
    const sampleRate = audioBuffer.sampleRate

    const aligned = alignSentencesWithAudioSamples(
      sentences,
      channelData,
      sampleRate,
      actualDuration,
      options,
    )
    console.log(
      `[Audio Aligner] 成功完成静态声波标记对齐：共 ${aligned.length} 句（数量 1:1 严格对齐），音频时长 ${actualDuration.toFixed(2)}s，首句 [${aligned[0]?.startTime.toFixed(2)}s ~ ${aligned[0]?.endTime.toFixed(2)}s]`,
    )
    return aligned
  } catch (err) {
    console.warn('[Audio Aligner] 离线声波对齐解码异常，已平滑降级至静态比例标记:', err)
    return fallbackWithProportional()
  }
}

/**
 * 使用官方语音引擎返回的精确实时时间轴边界（如微软 Azure Speech SDK 的 SentenceBoundary 事件）
 * 直接将阅读器句子与官方边界 1:1 对齐，达到毫秒级 100% 绝对同步
 */
export function alignSentencesWithBoundaries(
  sentences: SentenceItem[],
  boundaries: TtsSpeechBoundary[],
  totalDurationSeconds: number,
): SentenceItem[] {
  if (sentences.length === 0) return []
  if (!boundaries || boundaries.length === 0) {
    const staticMarkers = buildStaticCueMarkers(sentences, totalDurationSeconds)
    return sentences.map((s, idx) => ({
      ...s,
      startTime: staticMarkers[idx]?.startTime ?? 0,
      endTime: staticMarkers[idx]?.endTime ?? totalDurationSeconds,
      detectedPauseSec: staticMarkers[idx]?.detectedPauseSec ?? 0,
      alignmentType: 'proportional',
    }))
  }

  // 筛选出整句边界（若有 SentenceBoundary 优先使用，否则全量使用）
  const sentenceBoundaries = boundaries.filter((b) => b.boundaryType === 'SentenceBoundary')
  const activeBoundaries = sentenceBoundaries.length > 0 ? sentenceBoundaries : boundaries

  let prevEndTime = 0
  return sentences.map((s, idx) => {
    let b = activeBoundaries[idx]
    if (!b && activeBoundaries.length > 0) {
      b = activeBoundaries[activeBoundaries.length - 1]
    }

    if (b) {
      const start = Math.max(prevEndTime, b.audioOffsetMs / 1000)
      const dur = b.durationMs > 0 ? b.durationMs / 1000 : 0.5
      const end = Math.min(totalDurationSeconds, Math.max(start + 0.1, start + dur))
      prevEndTime = end
      return {
        ...s,
        startTime: start,
        endTime: end,
        detectedPauseSec: 0,
        alignmentType: 'azure-boundary' as const,
      }
    }

    return {
      ...s,
      startTime: prevEndTime,
      endTime: totalDurationSeconds,
      detectedPauseSec: 0,
      alignmentType: 'azure-boundary' as const,
    }
  })
}

