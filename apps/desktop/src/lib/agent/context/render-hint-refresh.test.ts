import { afterEach, describe, expect, it } from 'vitest'
import {
  nextRenderHintCount,
  RENDER_HINT_REFRESH_INTERVAL,
  resetRenderHintRefresh,
  shouldRefreshRenderHint,
} from './render-hint-refresh'
import { buildMontreePromptPrefix } from './build-prompt-prefix'
import {
  MONTREE_BOOTSTRAP_CLOSE_TAG,
  MONTREE_BOOTSTRAP_OPEN_TAG,
  MONTREE_RENDER_HINT_REFRESH,
  MONTREE_INTERACTIVE_GUIDANCE,
  MONTREE_STATIC_SKILL,
  MONTREE_TOOL_OVERVIEW,
} from './montree-static-skill'
import { stripReplayScaffolding } from './strip-replay-scaffolding'

const THREAD = 'render-hint-cadence'

afterEach(() => {
  resetRenderHintRefresh(THREAD)
})

describe('render-hint-refresh 长会话渲染速览节流', () => {
  it('首次完整说明、后续每轮轻量提醒，工具概览中只附一次交互策略', () => {
    const id = `${THREAD}-interactive`
    try {
      const first = buildMontreePromptPrefix(id)
      expect(first.some((b) => b.type === 'text' && b.text.includes(MONTREE_STATIC_SKILL))).toBe(true)
      for (const blocks of [first, buildMontreePromptPrefix(id, { includeBootstrap: false })]) {
        const text = blocks.map((b) => b.type === 'text' ? b.text : '').join('\n')
        expect(text.split(MONTREE_INTERACTIVE_GUIDANCE).length - 1).toBe(1)
        expect(blocks.some((b) => b.type === 'text' && b.text.includes(MONTREE_TOOL_OVERVIEW) && b.text.includes(MONTREE_INTERACTIVE_GUIDANCE))).toBe(true)
      }
      const later = buildMontreePromptPrefix(id, { includeBootstrap: false }).map((b) => b.type === 'text' ? b.text : '').join('\n')
      expect(later).not.toContain(MONTREE_STATIC_SKILL)
      expect(later).toContain('Simple facts need only text')
      expect(later).toContain('actual callable list')
    } finally { resetRenderHintRefresh(id) }
  })

  it('逐轮交互提醒在历史回放中剥离，不进入用户气泡', () => {
    const text = `${MONTREE_BOOTSTRAP_OPEN_TAG}\n${MONTREE_TOOL_OVERVIEW}\n${MONTREE_INTERACTIVE_GUIDANCE}\n${MONTREE_BOOTSTRAP_CLOSE_TAG}\n解释一下这章`
    expect(stripReplayScaffolding(text)).toEqual({ text: '解释一下这章', dangling: false })
  })
  it('默认每 10 轮贴一次，其余轮次静默', () => {
    expect(RENDER_HINT_REFRESH_INTERVAL).toBe(10)
    const hits: number[] = []
    for (let turn = 1; turn <= 25; turn += 1) {
      if (shouldRefreshRenderHint(THREAD)) hits.push(turn)
    }
    expect(hits).toEqual([10, 20])
  })

  it('纯函数步进：第 N 次达阈值即贴并归零', () => {
    expect(nextRenderHintCount(8)).toEqual({ attach: false, next: 9 })
    expect(nextRenderHintCount(9)).toEqual({ attach: true, next: 0 })
  })

  it('按线程独立计数，互不干扰', () => {
    for (let i = 0; i < 9; i += 1) shouldRefreshRenderHint('thread-a')
    expect(shouldRefreshRenderHint('thread-b')).toBe(false)
    expect(shouldRefreshRenderHint('thread-a')).toBe(true)
    resetRenderHintRefresh('thread-a')
    resetRenderHintRefresh('thread-b')
  })

  it('清空即归零：下 9 轮静默，第 10 轮再贴', () => {
    for (let i = 0; i < 10; i += 1) shouldRefreshRenderHint(THREAD)
    resetRenderHintRefresh(THREAD)
    const hits: number[] = []
    for (let turn = 1; turn <= 10; turn += 1) {
      if (shouldRefreshRenderHint(THREAD)) hits.push(turn)
    }
    expect(hits).toEqual([10])
  })

  it('前缀组装：第 10 轮恰好多一块速览（外层标记包裹）', () => {
    const id = `render-hint-wire-${Date.now()}`
    try {
      const texts: string[][] = []
      for (let i = 0; i < 10; i += 1) {
        texts.push(
          buildMontreePromptPrefix(id, { includeBootstrap: false }).map((b) =>
            b.type === 'text' ? b.text : '',
          ),
        )
      }
      for (let i = 0; i < 9; i += 1) {
        expect(texts[i]!.join('\n')).not.toContain('Reply rendering refresher')
      }
      const tenth = texts[9]!.join('\n')
      expect(tenth).toContain('Reply rendering refresher')
      // 恰好一块（不多不少），且可被回放清洗完整剥离
      expect(tenth.split(MONTREE_RENDER_HINT_REFRESH).length - 1).toBe(1)
    } finally {
      resetRenderHintRefresh(id)
    }
  })

  it('速览块可被回放清洗完整剥离，不污染用户气泡', () => {
    const refresh =
      `${MONTREE_BOOTSTRAP_OPEN_TAG}\n${MONTREE_RENDER_HINT_REFRESH}\n${MONTREE_BOOTSTRAP_CLOSE_TAG}`
    const result = stripReplayScaffolding(`${refresh}\n你好`)
    expect(result.text).toBe('你好')
    expect(result.dangling).toBe(false)
  })
})
