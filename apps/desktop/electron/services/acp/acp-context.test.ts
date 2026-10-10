import { describe, expect, it } from 'vitest'
import { bindAcpContext, currentAcpContext, getAcpContext, runInAcpContext, forgetAcpContext } from './acp-context'
import { acpState, getAcpState, onAcpStatusChanged, setStatus } from './acp-state'

describe('ACP window async context', () => {
  it('interleaved awaits and callbacks retain their owning state; unsubscribe works outside scope', async () => {
    const a = getAcpContext('test-context-a'), b = getAcpContext('test-context-b')
    const seen: string[] = []
    const off = runInAcpContext(a, () => onAcpStatusChanged(() => seen.push(acpState.sessionId!)))
    const callback = runInAcpContext(a, () => {
      acpState.sessionId = 'a'
      return bindAcpContext(() => setStatus('connected'))
    })
    await Promise.all([a, b].map((context) => runInAcpContext(context, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(currentAcpContext()).toBe(context)
      if (context === b) { acpState.sessionId = 'b'; callback() }
    })))
    expect(seen).toEqual(['a'])
    expect(getAcpState(b).sessionId).toBe('b')
    off()
    callback()
    expect(seen).toEqual(['a'])
    forgetAcpContext(a); forgetAcpContext(b)
  })
})
