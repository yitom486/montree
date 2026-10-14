import { rolldown } from 'rolldown'
import type { Plugin } from 'vite'

export function reactArtifactRuntimePlugin(entry: string): Plugin {
  return {
    name: 'react-artifact-runtime',
    async generateBundle() {
      const bundle = await rolldown({ input: entry, platform: 'browser', transform: { define: { 'process.env.NODE_ENV': '"production"' } } })
      try {
        const { output } = await bundle.generate({ format: 'iife', minify: true })
        const chunk = output.find(item => item.type === 'chunk')
        if (!chunk || output.length !== 1) throw new Error('React artifact 运行库必须为单文件')
        this.emitFile({ type: 'asset', fileName: 'react-artifact-runtime.js', source: chunk.code })
      } finally { await bundle.close() }
    },
  }
}
