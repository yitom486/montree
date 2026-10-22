import { describe, expect, it } from 'vitest'
import {
  extractLlmsTocSection,
  extractLlmsTxtToc,
  humanizePathSegment,
  normalizeLlmsDocHref,
  structuralPathParts,
} from './extract-llms-toc'

const LLMS_FIXTURE = `# Agent Client Protocol

- [Introduction](https://agentclientprotocol.com/get-started/introduction.md): Get started
- [Architecture](https://agentclientprotocol.com/get-started/architecture.md): Overview
- [Overview](https://agentclientprotocol.com/protocol/v1/overview.md): How ACP works
- [Initialization](https://agentclientprotocol.com/protocol/v1/initialization.md): Begin
- [Overview](https://agentclientprotocol.com/protocol/v2/overview.md): v2 draft
- [Kotlin](https://agentclientprotocol.com/libraries/kotlin.md): Kotlin library
- [Brand](https://agentclientprotocol.com/brand.md): Brand assets
`

describe('extractLlmsTxtToc', () => {
  it('保留 URL 中的 v1/v2 作为中间层，对齐原站 Protocol → v1 → 页面', () => {
    const entries = extractLlmsTxtToc(LLMS_FIXTURE, 'https://agentclientprotocol.com')
    expect(entries.map((e) => `${e.level}:${e.label}`)).toEqual([
      '0:Get Started',
      '1:Introduction',
      '1:Architecture',
      '0:Protocol',
      '1:v1',
      '2:Overview',
      '2:Initialization',
      '1:v2',
      '2:Overview',
      '0:Libraries',
      '1:Kotlin',
      '0:Brand',
    ])
    expect(entries.find((e) => e.label === 'v1')?.href).toContain('/protocol/v1/overview')
    expect(normalizeLlmsDocHref('/protocol/v1/overview.md', 'https://agentclientprotocol.com')).toBe(
      'https://agentclientprotocol.com/protocol/v1/overview',
    )
  })

  it('structuralPathParts 保留版本段', () => {
    expect(structuralPathParts(['protocol', 'v1', 'overview'])).toEqual({
      groupParts: ['protocol', 'v1'],
      leafPart: 'overview',
      version: 'v1',
    })
    expect(humanizePathSegment('get-started')).toBe('Get Started')
    expect(humanizePathSegment('v1')).toBe('v1')
  })

  it('从站点原生目录派生当前页所在分组，而不是取全站平铺列表', () => {
    const entries = [
      { href: 'https://docs.example/tutorial', label: 'Tutorial', level: 0 },
      { href: 'https://docs.example/tutorial/basic', label: 'Tutorials', level: 1 },
      { href: 'https://docs.example/tutorial/basic', label: 'Basic Chat', level: 2 },
      { href: 'https://docs.example/tutorial/image', label: 'Generate Image', level: 2 },
      { href: 'https://docs.example/guides/streaming', label: 'Guides', level: 0 },
      { href: 'https://docs.example/guides/streaming', label: 'Streaming', level: 1 },
    ]

    expect(extractLlmsTocSection(entries, 'https://docs.example/tutorial/basic')).toEqual([
      { href: 'https://docs.example/tutorial/basic', label: 'Tutorials', level: 0 },
      { href: 'https://docs.example/tutorial/basic', label: 'Basic Chat', level: 1 },
      { href: 'https://docs.example/tutorial/image', label: 'Generate Image', level: 1 },
    ])
    expect(extractLlmsTocSection(entries, 'https://docs.example/missing')).toBeUndefined()
  })
})
