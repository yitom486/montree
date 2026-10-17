import { describe, expect, it } from 'vitest'
import { REACT_ARTIFACT_MOUNT_TOKEN } from '@yitom/contracts'
import { buildReactWrapper } from './react-artifact-service'
import { runInNewContext } from 'node:vm'

describe('React artifact 渲染确认信号', () => {
  it('包装层在首次 commit 后上报带占位的 react-ready，同步抛错保留文本与 rethrow', () => {
    const html = buildReactWrapper({ runtime: '/*rt*/', compiled: 'exports.default=function App(){return null}', css: '' })
    // 挂载占位以 JSON 字面量形态发出，渲染端按本次 mountId 替换
    expect(html).toContain(`"${REACT_ARTIFACT_MOUNT_TOKEN}"`)
    expect(html).toContain('artifact-react-ready')
    const effects: Array<() => void> = []
    const frames: Array<() => void> = []
    const messages: Array<{ type: string }> = []
    let tree!: { type: () => unknown }
    let onError!: (error: Error) => void
    const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1]!
    runInNewContext(script, {
      __artifactModules: {
        react: { createElement: (type: unknown) => ({ type }), useEffect: (effect: () => void) => effects.push(effect) },
        'react-dom/client': { createRoot: (_node: unknown, options: { onUncaughtError: typeof onError }) => {
          onError = options.onUncaughtError
          return { render: (element: typeof tree) => { tree = element } }
        } },
      },
      document: { getElementById: () => ({}) },
      parent: { postMessage: (message: { type: string }) => messages.push(message) },
      requestAnimationFrame: (callback: () => void) => frames.push(callback),
    })
    expect(messages).toHaveLength(0)
    tree.type()
    expect(messages).toHaveLength(0)
    effects[0]!()
    frames.shift()!()
    expect(messages).toHaveLength(0)
    frames.shift()!()
    expect(messages[0]?.type).toBe('artifact-react-ready')
    onError(new Error('render failed'))
    expect(messages[1]?.type).toBe('artifact-error')
    expect(html).toContain('运行失败')
  })
})
