import { describe, expect, it } from 'vitest'
import type { SentenceItem } from './text-sanitizer'
import {
  alignSentencesWithAudio,
  alignSentencesWithAudioSamples,
  alignSentencesWithBoundaries,
  buildStaticCueMarkers,
  computeRmsEnergyContour,
  detectAcousticSilenceIntervals,
  findActiveMarkerIndex,
} from './audio-aligner'

describe('audio-aligner 纯声学物理停顿对齐', () => {
  const sampleSentences: SentenceItem[] = [
    {
      id: 's-0',
      index: 0,
      text: '在中国古代历史上，',
      rawSentence: '在中国古代历史上，',
      charCount: 9,
      cleanText: '在中国古代历史上，',
      weight: 10,
      startTime: 0,
      endTime: 0,
      isParagraphEnd: false,
    },
    {
      id: 's-1',
      index: 1,
      text: '春秋战国是一个百家争鸣的辉煌时代。',
      rawSentence: '春秋战国是一个百家争鸣的辉煌时代。',
      charCount: 17,
      cleanText: '春秋战国是一个百家争鸣的辉煌时代。',
      weight: 18,
      startTime: 0,
      endTime: 0,
      isParagraphEnd: true,
    },
    {
      id: 's-2',
      index: 2,
      text: '各派学者著作立说，留下了深远影响。',
      rawSentence: '各派学者著作立说，留下了深远影响。',
      charCount: 17,
      cleanText: '各派学者著作立说，留下了深远影响。',
      weight: 18,
      startTime: 0,
      endTime: 0,
      isParagraphEnd: false,
    },
  ]

  it('应当能从音频采样中真实检测出物理静音停顿区间', () => {
    const sampleRate = 1000
    const totalDuration = 6.0
    const samples = new Float32Array(totalDuration * sampleRate)

    // 构建模拟发音与停顿：
    // 0.0s ~ 2.0s 发音
    // 2.0s ~ 2.5s 物理停顿（静音）
    // 2.5s ~ 4.2s 发音
    // 4.2s ~ 4.8s 物理停顿（静音）
    // 4.8s ~ 6.0s 发音
    for (let i = 0; i < samples.length; i++) {
      const sec = i / sampleRate
      if ((sec >= 2.0 && sec <= 2.5) || (sec >= 4.2 && sec <= 4.8)) {
        samples[i] = 0.0001 // 静音
      } else {
        samples[i] = 0.5 * Math.sin(2 * Math.PI * 40 * sec) // 真实发声
      }
    }

    const { energies, hopSizeSec, silenceThreshold } = computeRmsEnergyContour(samples, sampleRate)
    const silences = detectAcousticSilenceIntervals(energies, hopSizeSec, silenceThreshold, 0.1)

    // 应当准确识别出这 2 段物理停顿
    expect(silences.length).toBeGreaterThanOrEqual(2)
    const pause1 = silences.find((p) => p.midSec >= 2.1 && p.midSec <= 2.4)
    const pause2 = silences.find((p) => p.midSec >= 4.3 && p.midSec <= 4.7)
    expect(pause1).toBeDefined()
    expect(pause2).toBeDefined()
  })

  it('应当将分句切分点直接锁定在真实检测到的物理停顿中点', () => {
    const sampleRate = 1000
    const totalDuration = 6.0
    const samples = new Float32Array(totalDuration * sampleRate)

    // 两个明确物理停顿：2.25s 附近与 4.5s 附近
    for (let i = 0; i < samples.length; i++) {
      const sec = i / sampleRate
      if ((sec >= 2.0 && sec <= 2.5) || (sec >= 4.2 && sec <= 4.8)) {
        samples[i] = 0.0001
      } else {
        samples[i] = 0.4 * Math.sin(2 * Math.PI * 30 * sec)
      }
    }

    const aligned = alignSentencesWithAudioSamples(sampleSentences, samples, sampleRate, totalDuration)

    // 1. 严格 1:1 数量对齐
    expect(aligned.length).toBe(3)
    // 2. 切分点直接落在真实检测到的物理停顿区间内（而不是硬编码算出的数值）
    expect(aligned[0].endTime).toBeGreaterThanOrEqual(2.0)
    expect(aligned[0].endTime).toBeLessThanOrEqual(2.5)

    expect(aligned[1].endTime).toBeGreaterThanOrEqual(4.2)
    expect(aligned[1].endTime).toBeLessThanOrEqual(4.8)

    // 3. 时间轴完全连续
    expect(aligned[1].startTime).toBe(aligned[0].endTime)
    expect(aligned[2].startTime).toBe(aligned[1].endTime)
    expect(aligned[2].endTime).toBe(totalDuration)
  })

  it('在降级环境下应当平滑按字符比例分配，不抛出异常', async () => {
    const aligned = await alignSentencesWithAudio(sampleSentences, 'invalid-audio', 12.0)
    expect(aligned.length).toBe(sampleSentences.length)
    expect(aligned[0].startTime).toBe(0)
    expect(aligned[2].endTime).toBe(12.0)
  })

  it('buildStaticCueMarkers 必须对任意长度句子数组严格保证数量 1:1 守恒且时间轴单调连续', () => {
    for (const count of [1, 5, 20, 95]) {
      const testSentences: SentenceItem[] = Array.from({ length: count }, (_, i) => ({
        id: `test-s-${i}`,
        index: i,
        text: `这是测试句子第 ${i + 1} 句话，内容长度略有不同。`,
        rawSentence: `这是测试句子第 ${i + 1} 句话，内容长度略有不同。`,
        charCount: 20 + (i % 5),
        cleanText: `这是测试句子第 ${i + 1} 句话，内容长度略有不同。`,
        weight: 22,
        startTime: 0,
        endTime: 0,
        isParagraphEnd: i % 4 === 3,
      }))

      const totalDur = count * 2.5
      const markers = buildStaticCueMarkers(testSentences, totalDur)

      // 1. 严格 1:1 数量守恒
      expect(markers.length).toBe(count)

      // 2. 边界正确
      expect(markers[0].startTime).toBe(0)
      expect(markers[count - 1].endTime).toBe(totalDur)

      // 3. 严格单调连续递增，无重叠无空隙
      for (let i = 0; i < count; i++) {
        expect(markers[i].startTime).toBeLessThan(markers[i].endTime)
        expect(markers[i].duration).toBeGreaterThan(0)
        if (i > 0) {
          expect(markers[i].startTime).toBe(markers[i - 1].endTime)
        }
      }
    }
  })

  it('findActiveMarkerIndex 应当通过二分静态表准确定位任意播放时刻对应句子', () => {
    const markers = buildStaticCueMarkers(sampleSentences, 10.0)
    expect(markers.length).toBe(3)

    // 起点之前与起点
    expect(findActiveMarkerIndex(markers, -1)).toBe(0)
    expect(findActiveMarkerIndex(markers, 0)).toBe(0)

    // 各区间中点
    for (let i = 0; i < markers.length; i++) {
      const mid = (markers[i].startTime + markers[i].endTime) / 2
      expect(findActiveMarkerIndex(markers, mid)).toBe(i)
    }

    // 终点与终点之后
    expect(findActiveMarkerIndex(markers, 10.0)).toBe(2)
    expect(findActiveMarkerIndex(markers, 15.0)).toBe(2)
  })

  it('当发音发生局部停顿漂移时，动态递推自适应对齐仍能准确锁定后续句子的真实物理停顿', () => {
    const sampleRate = 1000
    const totalDuration = 10.0
    const samples = new Float32Array(totalDuration * sampleRate)

    // 句子 0 读得很慢且停顿长：0.0s ~ 3.5s 发音，3.5s ~ 4.2s 停顿 (midSec ~ 3.85s)
    // 句子 1 读得正常：4.2s ~ 6.8s 发音，6.8s ~ 7.4s 停顿 (midSec ~ 7.1s)
    // 句子 2 读完：7.4s ~ 10.0s 发音
    for (let i = 0; i < samples.length; i++) {
      const sec = i / sampleRate
      if ((sec >= 3.5 && sec <= 4.2) || (sec >= 6.8 && sec <= 7.4)) {
        samples[i] = 0.0001
      } else {
        samples[i] = 0.4 * Math.sin(2 * Math.PI * 30 * sec)
      }
    }

    const aligned = alignSentencesWithAudioSamples(sampleSentences, samples, sampleRate, totalDuration)
    expect(aligned.length).toBe(3)
    // 句子 0 的切分点吸附在 3.5s ~ 4.2s 区间内
    expect(aligned[0].endTime).toBeGreaterThanOrEqual(3.5)
    expect(aligned[0].endTime).toBeLessThanOrEqual(4.2)
    // 句子 1 的切分点吸附在 6.8s ~ 7.4s 区间内，没有因为首句变长而脱轨
    expect(aligned[1].endTime).toBeGreaterThanOrEqual(6.8)
    expect(aligned[1].endTime).toBeLessThanOrEqual(7.4)
    expect(aligned[2].endTime).toBe(totalDuration)
  })

  it('alignSentencesWithBoundaries 能高精度对应微软 Azure 官方 SentenceBoundary 事件', () => {
    const boundaries = [
      {
        text: '在中国古代历史上，',
        audioOffsetMs: 150,
        durationMs: 1800,
        boundaryType: 'SentenceBoundary',
      },
      {
        text: '春秋战国是一个百家争鸣的辉煌时代。',
        audioOffsetMs: 2200,
        durationMs: 2700,
        boundaryType: 'SentenceBoundary',
      },
      {
        text: '各派学者著作立说，留下了深远影响。',
        audioOffsetMs: 5100,
        durationMs: 2900,
        boundaryType: 'SentenceBoundary',
      },
    ]

    const aligned = alignSentencesWithBoundaries(sampleSentences, boundaries, 8.5)
    expect(aligned.length).toBe(3)
    expect(aligned[0].startTime).toBe(0.15)
    expect(aligned[0].endTime).toBe(1.95)
    expect(aligned[0].alignmentType).toBe('azure-boundary')

    expect(aligned[1].startTime).toBe(2.2)
    expect(aligned[1].endTime).toBe(4.9)
    expect(aligned[1].alignmentType).toBe('azure-boundary')

    expect(aligned[2].startTime).toBe(5.1)
    expect(aligned[2].endTime).toBe(8.0)
    expect(aligned[2].alignmentType).toBe('azure-boundary')
  })

  it('alignSentencesWithBoundaries 在空边界时平滑降级为比例对齐', () => {
    const aligned = alignSentencesWithBoundaries(sampleSentences, [], 6.0)
    expect(aligned.length).toBe(3)
    expect(aligned[0].alignmentType).toBe('proportional')
    expect(aligned[2].endTime).toBe(6.0)
  })
})


