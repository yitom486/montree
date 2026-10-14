import { describe, expect, it } from 'vitest'
import { isStaleGenerativeSubmit } from './generative-submit'

describe('isStaleGenerativeSubmit', () => {
  it('同线程放行，异线程/缺失拒绝', () => {
    expect(isStaleGenerativeSubmit('t1', 't1')).toBe(false)
    expect(isStaleGenerativeSubmit('t1', 't2')).toBe(true)
    expect(isStaleGenerativeSubmit(undefined, 't2')).toBe(true)
    expect(isStaleGenerativeSubmit('t1', undefined)).toBe(true)
  })
})
