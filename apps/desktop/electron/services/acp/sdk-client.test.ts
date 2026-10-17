import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createSdkStreamHandle } from './sdk-client'

/** 退出期真实顺序的回归：先摘桥（dispose），再 end stdin（kill）。
 * 旧顺序（kill 先 end stdin，桥还连着）下，SDK 收尾写入经 pipe 直达
 * 已 end 的 stdin，抛 ERR_STREAM_WRITE_AFTER_END，主进程弹报错窗。
 */
function fakeChild() {
  return {
    stdout: new PassThrough(),
    stdin: new PassThrough(),
  } as unknown as ChildProcessWithoutNullStreams
}

describe('sdk-client 退出竞态（关应用弹窗回归）', () => {
  it('dispose 幂等且不抛', () => {
    const handle = createSdkStreamHandle(fakeChild())
    expect(() => handle.dispose()).not.toThrow()
    expect(() => handle.dispose()).not.toThrow()
  })

  it('先摘桥再 end stdin：收尾写入落定（resolve 或 reject 皆可），无未捕获异常', async () => {
    const child = fakeChild()
    const handle = createSdkStreamHandle(child)
    const writer = handle.stream.writable.getWriter()
    // App 退出顺序：同步摘桥 → kill（stdin.end）
    handle.dispose()
    ;(child.stdin as PassThrough).end()
    let outcome = 'pending'
    writer
      .write({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 's' } } as never)
      .then(
        () => {
          outcome = 'resolved'
        },
        () => {
          outcome = 'rejected'
        },
      )
    const deadline = Date.now() + 3000
    while (outcome === 'pending' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25))
    }
    expect(outcome).not.toBe('pending')
    writer.releaseLock()
    // 迟到数据不再流向已死 stdin（桥已摘）；留窗口给未捕获异常冒泡
    //（若回归，vitest 的 Unhandled Errors 直接判红本文件）。
    ;(child.stdout as PassThrough).end('late-bytes')
    await new Promise((r) => setTimeout(r, 200))
  }, 10000)
})
