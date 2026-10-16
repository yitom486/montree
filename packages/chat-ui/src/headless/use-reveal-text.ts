import { useEffect, useRef, useState } from 'react'

export interface RevealOptions {
  /**
   * backlog 在多少毫秒内排空（目标时长）：长 backlog 自动加速。
   * 中文单字信息密度高，默认取参考值。
   * @default 250
   */
  drainMs?: number
  /**
   * backlog 很短时每字最大间隔（即最慢揭示速度），保证一直在动，
   * 尾部保持小步着陆。过大会拖尾。
   * @default 3
   */
  maxCharIntervalMs?: number
  /**
   * 每帧揭示上限：按剩余量动态收缩（`clamp(ceil(remaining/20), 6, 40)`），
   * backlog 大时大步追赶（2400 字约 70 帧 ≈ 1.2s 排空，不无限拖尾）、
   * 收尾 6 字级小步高频提交——“滑出来”的体感来自小步高频而非大步 burst。
   * 上限 40 同时封顶单帧解析量（尾部有界 ≤4000 字，提高提交频率的
   * 解析成本可忽略）。
   */
  maxCharsPerFrame?: number
  /**
   * 可见文本最短提交间隔：揭示推进每帧不停，但 setState（及下游
   * 重解析）最多按此频率提交。最后一次永远提交。
   * 32ms ≈ 30fps 提交：配合小步长即 Telegram 级“滑出”感；
   * 尾部解析有界，提高频率不增加可感知的解析成本。
   * @default 32
   */
  minCommitMs?: number
}

const DEFAULTS = {
  drainMs: 250,
  maxCharIntervalMs: 5,
  maxCharsPerFrame: 40,
  minCommitMs: 32,
} as const

function positiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && value > 0 ? value : fallback
}

/**
 * 流式打字机揭示（对标 @assistant-ui useSmooth 的时间算法，无外部依赖）：
 * 基于流逝时间计算每帧字数（drainMs 内排空 backlog），而非固定每帧 N 字——
 * 前者是“匀速打字”体感，后者是大段 burst。现在短 backlog 约 200 字/秒打底、
 * 收尾 6 字级小步高频提交；backlog 越大越快，且被 maxCharsPerFrame 封顶。
 *
 * 只做文本切片，不碰解析与渲染：下游保持单个 Streamdown 实例，
 * 消毒/URL 策略/脚注隔离/货币配对等语义不受影响。
 * 落定/`prefers-reduced-motion`/改写对齐语义见内联注释。
 */
export function useRevealText(source: string, streaming: boolean, opts?: RevealOptions): string {
  const drainMs = positiveOr(opts?.drainMs, DEFAULTS.drainMs)
  const maxCharIntervalMs = positiveOr(opts?.maxCharIntervalMs, DEFAULTS.maxCharIntervalMs)
  const maxCharsPerFrame = positiveOr(opts?.maxCharsPerFrame, DEFAULTS.maxCharsPerFrame)
  const minCommitMs = positiveOr(opts?.minCommitMs, DEFAULTS.minCommitMs)

  const [revealed, setRevealed] = useState(source)
  const sourceRef = useRef(source)
  sourceRef.current = source
  const revealedRef = useRef(source)
  const reduceMotionRef = useRef(
    typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    if (!streaming || reduceMotionRef.current) {
      revealedRef.current = sourceRef.current
      setRevealed(sourceRef.current)
      return
    }
    let raf = 0
    let lastUpdateTime = performance.now()
    let lastCommitTime = -Infinity
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(tick)
    }
    const tick = () => {
      const target = sourceRef.current
      const shown = revealedRef.current
      if (target === shown) return
      // 改写（非追加）：从空起播，避免旧文残留闪烁
      if (!target.startsWith(shown)) {
        revealedRef.current = ''
        setRevealed('')
        lastCommitTime = -Infinity
        lastUpdateTime = performance.now()
        schedule()
        return
      }
      const now = performance.now()
      const deltaTime = now - lastUpdateTime
      let timeToConsume = deltaTime
      const remaining = target.length - shown.length
      const baseTimePerChar = Math.min(maxCharIntervalMs, drainMs / Math.max(1, remaining))
      // 动态封顶：剩余量越大步子越大，收尾越小步（打字感来自小步高频）
      const dynamicCap = Math.min(maxCharsPerFrame, Math.max(6, Math.ceil(remaining / 20)))
      const frameLimit = Math.min(remaining, dynamicCap)
      let charsToAdd = 0
      while (timeToConsume >= baseTimePerChar && charsToAdd < frameLimit) {
        charsToAdd += 1
        timeToConsume -= baseTimePerChar
      }
      // 被上限封顶的帧丢弃结余时间：结余只在“时间不够”时才有意义；
      // 封顶帧若把结余存入下帧，等于变相冲破上限（大 backlog 下出现
      // burst 台阶）。未封顶时结余不足一字，保留以维持字符节奏。
      if (charsToAdd === frameLimit) {
        timeToConsume = 0
      }
      const isComplete = charsToAdd === remaining
      if (charsToAdd === 0) {
        // 时间不够：下帧继续（不推进、不提交、不停调度）
        schedule()
        return
      }
      const next = target.slice(0, shown.length + charsToAdd)
      revealedRef.current = next
      lastUpdateTime = now - timeToConsume
      if (isComplete || now - lastCommitTime >= minCommitMs) {
        lastCommitTime = now
        setRevealed(next)
      }
      if (!isComplete) schedule()
    }
    schedule()
    return () => cancelAnimationFrame(raf)
  }, [source, streaming, drainMs, maxCharIntervalMs, maxCharsPerFrame, minCommitMs])

  return revealed
}
