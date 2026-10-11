// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  CHAT_HISTORY_INITIAL_COUNT,
  CHAT_HISTORY_PAGE_STEP,
  sliceChatWindow,
} from './stick-to-bottom'

describe('stick-to-bottom', () => {
  it('历史分页常量：初 5 步 5', () => {
    expect(CHAT_HISTORY_INITIAL_COUNT).toBe(5)
    expect(CHAT_HISTORY_PAGE_STEP).toBe(5)
  })

  it('sliceChatWindow：贴底取末尾，冻结窗口移位稳定', () => {
    const messages = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']
    // 贴底：末 3 条；新消息自然进入
    expect(sliceChatWindow(messages, null, 3)).toEqual(['m6', 'm7', 'm8'])
    expect(sliceChatWindow([...messages, 'm9'], null, 3)).toEqual(['m7', 'm8', 'm9'])
    // 冻结：[2, 5) 不随新消息移位
    expect(sliceChatWindow(messages, 2, 3)).toEqual(['m3', 'm4', 'm5'])
    expect(sliceChatWindow([...messages, 'm9'], 2, 3)).toEqual(['m3', 'm4', 'm5'])
    // 越界钳制与总量不足
    expect(sliceChatWindow(messages, 100, 3)).toEqual(['m8'])
    expect(sliceChatWindow(['a', 'b'], null, 5)).toEqual(['a', 'b'])
    expect(sliceChatWindow(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
  })
})
