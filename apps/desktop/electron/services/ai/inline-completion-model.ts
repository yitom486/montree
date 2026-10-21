import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import { readStoredAcpProvider } from '../acp/runtimes/codex/codex-provider'
import type { InlineCompletionModelSource } from './inline-completion-service'

/** 复用“自定义模型供应商”（base URL + Key + 模型，OpenAI 兼容）作为补全模型；Key 只在主进程内使用。 */
export function providerModelSource(): InlineCompletionModelSource {
  let cache: { key: string; value: { model: LanguageModel; id: string } } | null = null
  return {
    resolve: async () => {
      const stored = await readStoredAcpProvider()
      if (!stored) return null
      const key = `${stored.baseUrl}\u0000${stored.model}\u0000${stored.apiKey}`
      if (cache?.key !== key) {
        const provider = createOpenAICompatible({ name: stored.name || 'montree-provider', baseURL: stored.baseUrl.replace(/\/+$/, ''), apiKey: stored.apiKey })
        cache = { key, value: { model: provider.chatModel(stored.model), id: stored.model } }
      }
      return cache.value
    },
  }
}

/** E2E：不出网的确定性模型，按光标前最后一个词返回补全，并带两个候选。 */
export function e2eMockModelSource(): InlineCompletionModelSource {
  const model = {
    specificationVersion: 'v3', provider: 'montree-e2e', modelId: 'mock-completion', supportedUrls: {},
    async doGenerate(options: { prompt: Array<{ role: string; content: unknown }> }) {
      const text = JSON.stringify(options.prompt)
      const completion = /quick brown/.test(text) ? ' fox jumps over the lazy dog.<ALT> cat naps in the sun.' : /春眠/.test(text) ? '不觉晓，处处闻啼鸟。' : ' continued text.'
      return { content: [{ type: 'text', text: completion }], finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } }, warnings: [] }
    },
    async doStream() { throw new Error('not supported') },
  } as unknown as LanguageModel
  return { resolve: async () => ({ model, id: 'mock-completion' }) }
}
