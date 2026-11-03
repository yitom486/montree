import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { copyTextToClipboard } from '@yitom/reader-core'
import { useAppSettingsStore, translationTargetLabel, type TranslationTargetLang } from '@/stores/app-settings-store'
import {
  hasUnreadableText,
  sendTranslationPrompt,
  TRANSLATION_MAX_INPUT_CHARS,
} from '@/lib/agent/translation-session'

export type ReaderTranslationPhase = 'recognizing' | 'preparing' | 'streaming' | 'done' | 'error'

export interface ReaderTranslationState {
  requestId: string
  phase: ReaderTranslationPhase
  sourceText: string
  targetLang: TranslationTargetLang
  targetLabel: string
  runtimeId?: string
  model?: string
  thought?: string
  position: { x: number; y: number }
  text: string
  error?: string
  startedAt: number
  firstTokenAt?: number
  completedAt?: number
}

const EMPTY = ''

/**
 * 阅读器划词翻译的短生命周期状态。
 * 选区文本由调用方传入；目标语言在每次 translate 时从 Settings 读取，
 * 之后锁定在本次卡片里，避免 Settings 变更把同一张卡的语言弄混。
 */
export function useReaderTranslation(options: {
  getSourceText: () => string | null
  dimTextSelection: () => void
  recoverSourceText?: () => Promise<string>
  sourceKey?: string
}) {
  const [translation, setTranslation] = useState<ReaderTranslationState | null>(null)
  const requestSeq = useRef(0)
  const recoveryRef = useRef<(() => Promise<string>) | undefined>(undefined)

  useEffect(() => {
    requestSeq.current += 1
    recoveryRef.current = undefined
    setTranslation(null)
    return () => { requestSeq.current += 1 }
  }, [options.sourceKey])

  const run = useCallback(
    async (
      requestId: number,
      sourceText: string,
      targetLang: TranslationTargetLang,
      position: { x: number; y: number },
      runtimeId?: string,
      model?: string,
      recoverSourceText?: () => Promise<string>,
      thought?: string,
    ) => {
      const targetLabel = translationTargetLabel(targetLang)
      const startedAt = Date.now()
      let firstTokenAt: number | undefined
      let sourceReady = !hasUnreadableText(sourceText)
      setTranslation({
        requestId: String(requestId),
        phase: !sourceReady && recoverSourceText ? 'recognizing' : 'preparing',
        sourceText,
        targetLang,
        targetLabel,
        runtimeId,
        model,
        thought,
        position,
        text: EMPTY,
        startedAt,
      })
      try {
        if (!sourceReady) {
          if (!recoverSourceText) throw new Error('选中文字包含无法识别的字符，请先识别本页后重试')
          sourceText = (await recoverSourceText()).trim()
          if (requestSeq.current !== requestId) return
          if (!sourceText || hasUnreadableText(sourceText)) {
            throw new Error('OCR 未能恢复可读的选中文字，请重新划选或识别本页后重试')
          }
          if (sourceText.length > TRANSLATION_MAX_INPUT_CHARS) {
            throw new Error(`识别后内容过长，请缩小到 ${TRANSLATION_MAX_INPUT_CHARS} 字以内`)
          }
          setTranslation((previous) => previous ? { ...previous, phase: 'preparing', sourceText } : previous)
          sourceReady = true
        }
        const result = await sendTranslationPrompt({
          text: sourceText,
          targetLang: targetLabel,
          runtimeId,
          model,
          thought,
          onDelta: (delta) => {
            if (requestSeq.current !== requestId) return
            firstTokenAt ??= Date.now()
            setTranslation((previous) =>
              previous
                ? {
                    ...previous,
                    phase: 'streaming',
                    text: previous.text + delta,
                    firstTokenAt: previous.firstTokenAt ?? firstTokenAt,
                  }
                : previous,
            )
          },
        })
        if (result.status === 'ok') {
          console.info('[translation]', {
            target: targetLabel,
            model: model || 'runtime-default',
            chars: (result.reply || sourceText).length,
            firstTokenMs: firstTokenAt ? firstTokenAt - startedAt : undefined,
            totalMs: Date.now() - startedAt,
          })
        }
        if (requestSeq.current !== requestId) return
        if (result.status === 'ok') {
          setTranslation((previous) =>
            previous
              ? {
                  ...previous,
                  phase: 'done',
                  text: result.reply || previous.text,
                  completedAt: Date.now(),
                }
              : previous,
          )
          return
        }
        setTranslation((previous) =>
          previous
            ? {
                ...previous,
                phase: 'error',
                error:
                  result.status === 'auth-required'
                    ? '请在设置的翻译区域完成 Agent 认证'
                    : '翻译失败，请重试',
                completedAt: Date.now(),
              }
            : previous,
        )
      } catch (cause) {
        if (requestSeq.current !== requestId) return
        setTranslation((previous) =>
          previous
            ? {
                ...previous,
                phase: 'error',
                error: !sourceReady && cause instanceof Error ? cause.message : '翻译失败，请重试',
                completedAt: Date.now(),
              }
            : previous,
        )
      }
    },
    [],
  )

  const translate = useCallback(
    async (position: { x: number; y: number }) => {
      const sourceText = options.getSourceText()?.trim() ?? ''
      if (!sourceText) {
        toast.error('当前没有选中文本')
        return
      }
      if (sourceText.length > TRANSLATION_MAX_INPUT_CHARS) {
        toast.error(`选中内容过长，请缩小到 ${TRANSLATION_MAX_INPUT_CHARS} 字以内`)
        return
      }
      const targetLang = useAppSettingsStore.getState().translationTargetLang
      const runtimeId = useAppSettingsStore.getState().translationRuntimeId
      const model = useAppSettingsStore.getState().translationModelByRuntime[runtimeId] ?? ''
      const thought = useAppSettingsStore.getState().translationThoughtByRuntime[runtimeId]
      options.dimTextSelection()
      requestSeq.current += 1
      recoveryRef.current = options.recoverSourceText
      await run(requestSeq.current, sourceText, targetLang, position, runtimeId, model, recoveryRef.current, thought)
    },
    [options, run],
  )

  const retry = useCallback(async () => {
    if (!translation) return
    requestSeq.current += 1
    await run(
      requestSeq.current,
      translation.sourceText,
      translation.targetLang,
      translation.position,
      translation.runtimeId,
      translation.model,
      recoveryRef.current,
      translation.thought,
    )
  }, [run, translation])

  const dismiss = useCallback(() => {
    requestSeq.current += 1
    setTranslation(null)
  }, [])

  const copy = useCallback(() => {
    const text = translation?.text.trim()
    if (!text) return
    void copyTextToClipboard(text).then((ok) => {
      if (ok) toast.success('已复制译文')
    })
  }, [translation?.text])

  return { translation, translate, retry, dismiss, copy }
}
