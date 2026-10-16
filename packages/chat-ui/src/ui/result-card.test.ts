import { describe, expect, it } from 'vitest'
import { RESULT_CARD_SHELL, resultCardClassName } from './result-card'

describe('result-card 统一外壳', () => {
  it('挂载播一次入场动画类（更新 props 不重挂载故不重播）', () => {
    expect(RESULT_CARD_SHELL).toContain('animate-result-card-in')
    expect(resultCardClassName('extra')).toContain('animate-result-card-in')
    expect(resultCardClassName('extra')).toContain('extra')
  })
})
