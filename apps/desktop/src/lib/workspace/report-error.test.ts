import { describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { isAppError } from '@montree/contracts'
import { reportAppError } from './report-error'

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

describe('report-error', () => {
  it('CANCELLED 不弹 Toast', () => {
    reportAppError({ code: 'CANCELLED', message: '已取消' })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('其他错误码弹出 Sonner', () => {
    reportAppError({ code: 'FILE_READ_ERROR', message: '读取失败' })
    expect(toast.error).toHaveBeenCalledWith('操作失败', { description: '读取失败' })
  })

  it('识别 AppError 结构', () => {
    expect(isAppError({ code: 'UNKNOWN', message: 'x' })).toBe(true)
    expect(isAppError(new Error('x'))).toBe(false)
  })
})
