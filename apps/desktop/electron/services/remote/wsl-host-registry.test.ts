/**
 * P2 按窗口归属的 WSL 连接注册表：同窗口复用实例，不同窗口隔离；
 * 释放只断开本窗口连接；take 转移所有权时不 disconnect（会话释放再关）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  disposeWslHostForWindow,
  getWslHostForWindow,
  peekWslHostForWindow,
  resetWslHostRegistryForTest,
  takeWslHostForWindow,
} from './wsl-workspace-host'

const WIN_A = 910101
const WIN_B = 910102

afterEach(() => {
  resetWslHostRegistryForTest()
})

describe('wsl 按窗口注册表（P2 多窗口隔离）', () => {
  it('同窗口返回同一实例，不同窗口实例隔离', () => {
    expect(getWslHostForWindow(WIN_A)).toBe(getWslHostForWindow(WIN_A))
    expect(getWslHostForWindow(WIN_A)).not.toBe(getWslHostForWindow(WIN_B))
    expect(peekWslHostForWindow(WIN_A)).toBe(getWslHostForWindow(WIN_A))
  })

  it('peek 不创建实例；未知窗口返回 null', () => {
    expect(peekWslHostForWindow(919999)).toBeNull()
    // peek 本身不建连
    expect(peekWslHostForWindow(919999)).toBeNull()
  })

  it('释放只影响本窗口：A 释放后 B 实例不变', () => {
    const before = getWslHostForWindow(WIN_B)
    getWslHostForWindow(WIN_A)
    disposeWslHostForWindow(WIN_A)
    expect(peekWslHostForWindow(WIN_A)).toBeNull()
    expect(peekWslHostForWindow(WIN_B)).toBe(before)
    // 重复释放幂等，不抛
    disposeWslHostForWindow(WIN_A)
  })

  it('take 转移所有权：注册表不再持有且不断开（状态保持）', () => {
    const host = getWslHostForWindow(WIN_A)
    expect(takeWslHostForWindow(WIN_A)).toBe(host)
    expect(peekWslHostForWindow(WIN_A)).toBeNull()
    // 未建连宿主 disconnect 幂等
    host.disconnect()
    expect(takeWslHostForWindow(WIN_A)).toBeNull()
  })
})
