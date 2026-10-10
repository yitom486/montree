import { AsyncLocalStorage } from 'node:async_hooks'

export interface AcpContext {
  id: string
  closed: boolean
}

const storage = new AsyncLocalStorage<AcpContext>()
const defaultContext: AcpContext = { id: 'default', closed: false }
const contexts = new Map<string, AcpContext>()

export function currentAcpContext(): AcpContext {
  return storage.getStore() ?? defaultContext
}

export function getAcpContext(id: string): AcpContext {
  let context = contexts.get(id)
  if (!context) {
    context = { id, closed: false }
    contexts.set(id, context)
  }
  return context
}

export function runInAcpContext<T>(context: AcpContext, callback: () => T): T {
  return storage.run(context, callback)
}

/** SDK/EventEmitter callbacks must retain their registering window, not the emitting caller. */
export function bindAcpContext<Args extends unknown[], T>(callback: (...args: Args) => T): (...args: Args) => T {
  const context = currentAcpContext()
  return (...args) => storage.run(context, () => callback(...args))
}

export function listAcpContexts(): AcpContext[] {
  return [defaultContext, ...contexts.values()]
}

export function forgetAcpContext(context: AcpContext): void {
  context.closed = true
  if (contexts.get(context.id) === context) contexts.delete(context.id)
}
