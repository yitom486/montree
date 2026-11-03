import { ensureSubsessionSession, sendSubsessionPrompt, type SubsessionEnsureOptions } from './acp-subsession'
import { useAppSettingsStore } from '@/stores/app-settings-store'
import { ensureTranslationConnection, translationConnectionEpoch, translationClient, translationAuthError } from './translation-transport'
import type { AcpConfigOption } from '@yitom/contracts'
import { TRANSLATION_LOWEST_THOUGHT, translationModelOption, translationThoughtPatch } from './translation-config'
export { hasUnreadableText } from '@/lib/reader/text-quality'

/**
 * 阅读器划词翻译：隐藏副会话，不落库、不进入对话时间线。
 * Agent、连接、认证与模型配置均独立于主聊天；目标语言逐 turn 传入，源语言自动判断。
 */
const TRANSLATION_PURPOSE = 'translate'
const ROTATE_IDLE_MS = 30 * 60 * 1000
const ROTATE_PROMPT_COUNT = 50

export interface TranslationConfig {
  runtimeId?: string
  model?: string
  thought?: string
}

function sessionOptions(config: TranslationConfig): SubsessionEnsureOptions {
  const model = config.model?.trim() ?? ''
  const thought = config.thought ?? TRANSLATION_LOWEST_THOUGHT
  const runtimeId = config.runtimeId ?? useAppSettingsStore.getState().translationRuntimeId
  const client = translationClient(runtimeId)
  return {
    purpose: TRANSLATION_PURPOSE,
    key: JSON.stringify([runtimeId, model, thought, translationConnectionEpoch(runtimeId)]),
    runtimeId,
    client,
    ensureTransport: () => ensureTranslationConnection(runtimeId),
    cwd: '',
    inheritConfigPreferences: false,
    rotation: { idleMs: ROTATE_IDLE_MS, maxPrompts: ROTATE_PROMPT_COUNT },
    configureSession: async (sessionId, initial) => {
      let options = initial
      const apply = async (patch: { configId: string; value: string }) => {
        const result = await client.setConfigOption({ sessionId, ...patch })
        if (!result.ok) throw new Error(result.error.message || '翻译配置应用失败')
        options = result.value.configOptions
      }
      if (model) {
        const option = translationModelOption(options)
        if (!option?.options?.some((item) => item.value === model)) {
          throw new Error('所选翻译模型已不可用，请在设置中重新选择')
        }
        if (option.currentValue !== model) await apply({ configId: option.configId, value: model })
      }
      // 模型切换会改变思考档候选，必须使用 setConfigOption 返回的新选项。
      const patch = translationThoughtPatch(options, thought)
      if (patch) await apply(patch)
      return options
    },
  }
}

/** 设置页只准备隐藏会话和读取配置，不发送模型请求。 */
export async function prepareTranslationConfig(config: TranslationConfig): Promise<AcpConfigOption[]> {
  const result = await ensureSubsessionSession(sessionOptions(config))
  if ('error' in result) {
    if (result.error === 'auth-required') throw translationAuthError(config.runtimeId ?? useAppSettingsStore.getState().translationRuntimeId)
    throw new Error('无法读取翻译模型配置')
  }
  return result.configOptions
}

/** 单次翻译输入上限：翻译是快动作，超长文本先提示用户缩小选区。 */
export const TRANSLATION_MAX_INPUT_CHARS = 4000

export function buildTranslationPrompt(text: string, targetLang: string): string {
  return `Translate the following text into ${targetLang}.
Detect the source language automatically; do not ask the user for it.
Return only the translation. Do not add explanations, quotes, Markdown fences, or the source text.

<text>
${text}
</text>`
}

export interface TranslationSendResult {
  status: 'ok' | 'auth-required' | 'failed'
  reply: string
}

export async function sendTranslationPrompt(options: {
  text: string
  targetLang: string
  runtimeId?: string
  /** 独立于聊天 Agent 的翻译模型；空串/缺省跟随运行时默认 */
  model?: string
  thought?: string
  onDelta?: (delta: string) => void
}): Promise<TranslationSendResult> {
  const text = options.text.trim()
  if (!text) return { status: 'failed', reply: '' }
  return sendSubsessionPrompt(
    {
      ...sessionOptions(options),
      onDelta: options.onDelta,
    },
    buildTranslationPrompt(text, options.targetLang),
  )
}
