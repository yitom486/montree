import { describe, expect, it } from 'vitest'
import { sanitizeAgentUrl } from './url-policy'

describe('sanitizeAgentUrl', () => {
  it('放行 http/https/mailto/tel 与相对路径', () => {
    expect(sanitizeAgentUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(sanitizeAgentUrl('http://example.com')).toBe('http://example.com')
    expect(sanitizeAgentUrl('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(sanitizeAgentUrl('tel:123')).toBe('tel:123')
    expect(sanitizeAgentUrl('/docs/guide')).toBe('/docs/guide')
    expect(sanitizeAgentUrl('#frag')).toBe('#frag')
  })

  it('拦截脚本与危险协议', () => {
    expect(sanitizeAgentUrl('javascript:alert(1)')).toBe('#')
    expect(sanitizeAgentUrl('JaVaScRiPt:alert(1)')).toBe('#')
    expect(sanitizeAgentUrl('vbscript:msgbox(1)')).toBe('#')
    expect(sanitizeAgentUrl('data:text/html,<script>alert(1)</script>')).toBe('#')
    expect(sanitizeAgentUrl('')).toBe('#')
  })

  it('图片放行 data:image，链接不放行 data:', () => {
    expect(sanitizeAgentUrl('data:image/png;base64,AAA', 'src')).toBe('data:image/png;base64,AAA')
    expect(sanitizeAgentUrl('data:image/png;base64,AAA', 'href')).toBe('#')
  })
})
