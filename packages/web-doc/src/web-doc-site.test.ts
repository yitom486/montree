import { describe, expect, it } from 'vitest'
import { normalizeWebDocInputUrl, resolveWebDocTocDiscoveryUrl, stripWebDocFragment } from './web-doc-site'

describe('web-doc-site URL state', () => {
  it('保留输入 URL 的 fragment，供阅读器导航状态使用', () => {
    expect(
      normalizeWebDocInputUrl(
        'agentclientprotocol.com/protocol/v1/initialization#param-logout',
      ),
    ).toBe('https://agentclientprotocol.com/protocol/v1/initialization#param-logout')
  })

  it('派生文档请求 URL 时只移除 fragment，不丢失 query', () => {
    expect(
      stripWebDocFragment(
        'https://agentclientprotocol.com/protocol/v1/initialization?lang=en#param-logout',
      ),
    ).toBe('https://agentclientprotocol.com/protocol/v1/initialization?lang=en')
  })

  it('没有 fragment 时保持规范化后的文档 URL 不变', () => {
    expect(stripWebDocFragment('https://agentclientprotocol.com/protocol/v1/initialization'))
      .toBe('https://agentclientprotocol.com/protocol/v1/initialization')
  })

  it('智能识别包含版本号与 docs 前缀的文档根发现入口', () => {
    expect(
      resolveWebDocTocDiscoveryUrl('https://opencode.ai/v2/docs/config/', 'generic-ssr'),
    ).toBe('https://opencode.ai/v2/docs/')

    expect(
      resolveWebDocTocDiscoveryUrl('https://react.dev/learn/tutorial-tic-tac-toe', 'generic-ssr'),
    ).toBe('https://react.dev/learn/')

    expect(
      resolveWebDocTocDiscoveryUrl('https://agentclientprotocol.com/get-started/introduction', 'generic-ssr'),
    ).toBe('https://agentclientprotocol.com/get-started/')
  })
})

