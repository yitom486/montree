import { describe, expect, it } from 'vitest'
import { checkPresentDocument } from './present-locate'

describe('checkPresentDocument', () => {
  it('同文档放行', () => {
    expect(
      checkPresentDocument({ documentFingerprint: '/a/b.epub', documentLabel: 'b.epub' }, '/a/b.epub'),
    ).toEqual({ ok: true })
  })

  it('跨文档禁止并引导打开原文档', () => {
    const verdict = checkPresentDocument(
      { documentFingerprint: '/a/A.epub', documentLabel: 'A.epub' },
      '/a/B.epub',
    )
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.message).toContain('A.epub')
      expect(verdict.message).toContain('B.epub')
    }
  })

  it('无当前文档或无绑定时禁止', () => {
    expect(checkPresentDocument({ documentFingerprint: '/a/A.epub' }, null).ok).toBe(false)
    expect(checkPresentDocument({}, '/a/A.epub').ok).toBe(false)
  })
})
