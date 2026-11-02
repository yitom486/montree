import { sendSubsessionPrompt } from './acp-subsession'
export { hasUnreadableText } from '@/lib/reader/text-quality'

/**
 * 阅读器划词翻译：隐藏副会话，不落库、不进入对话时间线。
 * 只复用 ACP 的认证/运行时/模型；目标语言是每个 turn 的参数，源语言由模型自行判断。
 */
const TRANSLATION_PURPOSE = 'translate'
const ROTATE_IDLE_MS = 30 * 60 * 1000
const ROTATE_PROMPT_COUNT = 50

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
  onDelta?: (delta: string) => void
}): Promise<TranslationSendResult> {
  const text = options.text.trim()
  if (!text) return { status: 'failed', reply: '' }
  const model = options.model?.trim() ?? ''
  return sendSubsessionPrompt(
    {
      purpose: TRANSLATION_PURPOSE,
      // 模型/运行时进 key：切换后不复用旧会话，也无需在旧 session 上反复改配置。
      key: `${options.runtimeId ?? 'current'}:${model || 'default'}`,
      runtimeId: options.runtimeId,
      ...(model ? { configPatches: [{ configId: 'model', value: model }] } : {}),
      rotation: { idleMs: ROTATE_IDLE_MS, maxPrompts: ROTATE_PROMPT_COUNT },
      onDelta: options.onDelta,
    },
    buildTranslationPrompt(text, options.targetLang),
  )
}
