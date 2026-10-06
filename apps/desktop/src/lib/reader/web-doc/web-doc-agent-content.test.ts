// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isOk } from '@montree/contracts'
import {
  clearWebDocAgentTextCache,
  fetchWebDocPlainText,
  primeWebDocAgentTextCache,
  readWebDocUnitByIndex,
} from './web-doc-agent-content'

vi.mock('@/api/web-doc-api', () => ({
  webDocApi: {
    fetchPage: vi.fn(),
  },
}))

import { webDocApi } from '@/api/web-doc-api'

describe('web-doc-agent-content', () => {
  afterEach(() => {
    clearWebDocAgentTextCache()
    vi.clearAllMocks()
  })

  it('抓取并缓存页面纯文本', async () => {
    vi.mocked(webDocApi.fetchPage).mockResolvedValue({
      ok: true,
      value: {
        url: 'https://react.dev/learn',
        html: '<!DOCTYPE html><html><body><article><h1>Quick Start</h1><p>Hello</p></article></body></html>',
      },
    })

    const first = await fetchWebDocPlainText('https://react.dev/learn')
    const second = await fetchWebDocPlainText('https://react.dev/learn/')
    expect(first).toContain('Hello')
    expect(second).toBe(first)
    expect(webDocApi.fetchPage).toHaveBeenCalledTimes(1)
  })

  it('prime 缓存可避免重复抓取', async () => {
    primeWebDocAgentTextCache('https://react.dev/learn', 'Cached body')
    const text = await fetchWebDocPlainText('https://react.dev/learn')
    expect(text).toBe('Cached body')
    expect(webDocApi.fetchPage).not.toHaveBeenCalled()
  })

  it('按 flatIndex 读取目录页', async () => {
    vi.mocked(webDocApi.fetchPage).mockResolvedValue({
      ok: true,
      value: {
        url: 'https://react.dev/learn/installation',
        html: '<!DOCTYPE html><html><body><article><p>Install guide</p></article></body></html>',
      },
    })

    const unit = await readWebDocUnitByIndex(
      [{ label: 'Installation', href: 'https://react.dev/learn/installation', level: 0 }],
      0,
    )
    expect(unit.label).toBe('Installation')
    expect(unit.text).toContain('Install guide')
    expect(isOk({ ok: true, value: unit })).toBe(true)
  })
})
