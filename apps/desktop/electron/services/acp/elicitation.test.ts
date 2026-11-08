import { describe, expect, it } from 'vitest'
import { agent, client, methods } from '@agentclientprotocol/sdk'
import { getAcpContext, runInAcpContext } from './acp-context'
import { registerAcpClientHandlers } from './client-handlers'
import { cancelElicitations, requestElicitation, respondElicitation, setElicitationBridge } from './elicitation'
import type { ElicitationEvent } from '../../../contracts/acp-elicitation'

const form = { mode: 'form' as const, sessionId: 's1', message: '选择策略', requestedSchema: { type: 'object' as const, properties: { strategy: { type: 'string' as const, oneOf: [{ const: 'clone', title: '完整克隆' }, { const: 'mirror', title: '镜像' }] } }, required: ['strategy'] } }
let sequence = 0
function setup() {
  const context = getAcpContext(`elicitation-test-${++sequence}`)
  const events: ElicitationEvent[] = []
  const run = <T>(fn: () => T) => runInAcpContext(context, fn)
  run(() => setElicitationBridge(event => events.push(event)))
  return { run, events }
}
function id(events: ElicitationEvent[]) { const event = events.find(event => event.kind === 'request'); if (event?.kind !== 'request') throw new Error('missing request'); return event.request.id }

describe('ACP elicitation end to end through the real SDK handler', () => {
  it('returns the selected answer and refuses duplicate or cross-window replies', async () => {
    const owner = setup(), foreign = setup()
    const app = client({ name: 'elicitation-client-test' })
    owner.run(() => registerAcpClientHandlers(app, { getWorkspaceRoot: () => null, terminals: {} as never, readSnapshot: async () => '', onPermission: async () => ({ outcome: 'cancelled' }), onSessionUpdate: () => {} }))
    const connection = agent({ name: 'elicitation-agent-test' }).connect(app)
    try {
      const pending = connection.client.request(methods.client.elicitation.create, form)
      await new Promise(resolve => setTimeout(resolve, 0))
      const reply = { id: id(owner.events), response: { action: 'accept' as const, content: { strategy: 'mirror' } } }
      expect(foreign.run(() => respondElicitation(reply)).ok).toBe(false)
      expect(owner.run(() => respondElicitation({ ...reply, response: { action: 'accept', content: { strategy: 'invalid' } } })).ok).toBe(false)
      expect(owner.run(() => respondElicitation(reply)).ok).toBe(true)
      expect(await pending).toEqual(reply.response)
      expect(owner.run(() => respondElicitation(reply)).ok).toBe(false)
      expect(owner.events.at(-1)).toEqual({ kind: 'closed', id: reply.id })
    } finally { connection.close() }
  })
  it('settles every concurrent request on disconnect and only the matching session on cancel', async () => {
    const { run, events } = setup()
    const a = run(() => requestElicitation(form, new AbortController().signal))
    const b = run(() => requestElicitation({ ...form, sessionId: 's2' }, new AbortController().signal))
    run(() => cancelElicitations('s1'))
    expect(await a).toEqual({ action: 'cancel' })
    expect(events.filter(event => event.kind === 'closed')).toHaveLength(1)
    run(() => cancelElicitations())
    expect(await b).toEqual({ action: 'cancel' })
  })
  it('honors request cancellation without a timeout or late response', async () => {
    const { run, events } = setup(), controller = new AbortController()
    const pending = run(() => requestElicitation(form, controller.signal))
    controller.abort()
    expect(await pending).toEqual({ action: 'cancel' })
    expect(run(() => respondElicitation({ id: id(events), response: { action: 'accept', content: { strategy: 'clone' } } })).ok).toBe(false)
  })
  it('rejects unadvertised modes and unknown field types, and supports request scope', async () => {
    const { run, events } = setup()
    await expect(run(() => requestElicitation({ ...form, mode: 'url', url: 'https://example.com', elicitationId: 'auth' }, new AbortController().signal))).rejects.toMatchObject({ code: -32602 })
    await expect(run(() => requestElicitation({ ...form, requestedSchema: { properties: { nested: { type: 'object' } } } }, new AbortController().signal))).rejects.toMatchObject({ code: -32602 })
    const { sessionId: _session, ...requestScoped } = form
    const pending = run(() => requestElicitation({ ...requestScoped, requestId: 7 }, new AbortController().signal))
    run(() => respondElicitation({ id: id(events), response: { action: 'decline' } }))
    expect(await pending).toEqual({ action: 'decline' })
  })
})
