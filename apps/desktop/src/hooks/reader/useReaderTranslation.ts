import { useCallback } from 'react'
import { toast } from 'sonner'
import { copyTextToClipboard } from '@yitom/reader-core'
import { useAppSettingsStore, translationTargetLabel, type TranslationTargetLang } from '@/stores/app-settings-store'
import {
  hasUnreadableText,
  sendTranslationPrompt,
  TRANSLATION_MAX_INPUT_CHARS,
} from '@/lib/agent/translation-session'
import { translationNote } from '@/lib/agent/translation-result'

import { useReaderTranslationStore, type ReaderTranslationState, type TranslationNoteWriter } from '@/stores/reader-translation-store'
export type { ReaderTranslationPhase, ReaderTranslationState, TranslationNoteWriter } from '@/stores/reader-translation-store'

/**
 * 阅读器划词翻译的窗口内会话状态，组件卸载不清除在途请求或已完成结果。
 * 选区文本由调用方传入；目标语言在每次 translate 时从 Settings 读取，
 * 之后锁定在本次卡片里，避免 Settings 变更把同一张卡的语言弄混。
 */
export function useReaderTranslation(options: {
  getSourceText: () => string | null
  dimTextSelection: () => void
  recoverSourceText?: () => Promise<string>
  sourceKey?: string
  captureNoteWriter?: () => TranslationNoteWriter | undefined
  onNoteSaved?: () => void
}) {
  const sourceKey = options.sourceKey ?? 'reader:default'
  const translation = useReaderTranslationStore(state => state.entries[sourceKey]?.translation ?? null)
  const entry = () => useReaderTranslationStore.getState().entries[sourceKey]
  const active = (id: string) => useReaderTranslationStore.getState().entries[sourceKey]?.translation.requestId === id

  const run = useCallback(
    async (
      requestId: string,
      sourceText: string,
      targetLang: TranslationTargetLang,
      position: { x: number; y: number },
      runtimeId?: string,
      model?: string,
      recoverSourceText?: () => Promise<string>,
      thought?: string,
      noteWriter?: TranslationNoteWriter,
      floatingPosition?: { x: number; y: number },
    ) => {
      const targetLabel = translationTargetLabel(targetLang)
      const startedAt = Date.now()
      let firstTokenAt: number | undefined
      let sourceReady = !hasUnreadableText(sourceText)
      useReaderTranslationStore.getState().start(sourceKey, { recoverSourceText, noteWriter, translation: {
        requestId,
        phase: !sourceReady && recoverSourceText ? 'recognizing' : 'preparing',
        sourceText,
        targetLang,
        targetLabel,
        runtimeId,
        model,
        thought,
        position,
        floatingPosition,
        text: '',
        canSave: Boolean(noteWriter),
        startedAt,
      } })
      const setTranslation = (change: (previous: ReaderTranslationState) => ReaderTranslationState) => useReaderTranslationStore.getState().update(sourceKey, requestId, change)
      try {
        if (!sourceReady) {
          if (!recoverSourceText) throw new Error('选中文字包含无法识别的字符，请先识别本页后重试')
          sourceText = (await recoverSourceText()).trim()
          if (!active(requestId)) return
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
          isActive: () => active(requestId),
          onDelta: (delta) => {
            if (!active(requestId)) return
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
          onDetails: (details) => {
            if (!active(requestId)) return
            setTranslation((previous) => previous ? { ...previous, details } : previous)
          },
          onDetailsStart: () => {
            if (!active(requestId)) return
            setTranslation((previous) => previous ? { ...previous, phase: 'enriching' } : previous)
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
        if (!active(requestId)) return
        if (result.status === 'ok') {
          setTranslation((previous) =>
            previous
              ? {
                  ...previous,
                  phase: 'done',
                  text: result.reply || previous.text,
                  details: result.details,
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
        if (!active(requestId)) return
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
    [sourceKey],
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
      const noteWriter = options.captureNoteWriter?.()
      options.dimTextSelection()
      await run(crypto.randomUUID(), sourceText, targetLang, position, runtimeId, model, options.recoverSourceText, thought, noteWriter)
    },
    [options, run],
  )

  const retry = useCallback(async () => {
    if (!translation) return
    const current = entry()
    await run(
      crypto.randomUUID(),
      translation.sourceText,
      translation.targetLang,
      translation.position,
      translation.runtimeId,
      translation.model,
      current?.recoverSourceText,
      translation.thought,
      current?.noteWriter,
      translation.floatingPosition,
    )
  }, [run, translation])

  const dismiss = useCallback(() => {
    const id = useReaderTranslationStore.getState().entries[sourceKey]?.translation.requestId
    if (id) useReaderTranslationStore.getState().dismiss(sourceKey, id)
  }, [sourceKey])

  const move = useCallback((position: { x: number; y: number }) => {
    const state = useReaderTranslationStore.getState()
    const id = translation?.requestId
    if (id) state.update(sourceKey, id, previous => previous.floatingPosition?.x === position.x && previous.floatingPosition?.y === position.y
      ? previous : { ...previous, floatingPosition: position })
  }, [sourceKey, translation?.requestId])

  const saveNote = useCallback(async () => {
    const current = entry()
    const translation = current?.translation
    const writer = current?.noteWriter
    if (!translation || translation.phase !== 'done' || !translation.text.trim() || !writer) return
    const id = translation.requestId
    if (translation.saving || translation.saved) return
    const setTranslation = (change: (previous: ReaderTranslationState) => ReaderTranslationState) => useReaderTranslationStore.getState().update(sourceKey, id, change)
    setTranslation((previous) => previous ? { ...previous, saving: true, saveError: undefined } : previous)
    try {
      await writer(translationNote(translation.sourceText, translation.text, translation.targetLabel, translation.details), translation.sourceText)
      if (!active(id)) return
      setTranslation((previous) => previous ? { ...previous, saving: false, saved: true } : previous)
      options.onNoteSaved?.()
    } catch (cause) {
      if (!active(id)) return
      setTranslation((previous) => previous ? {
        ...previous, saving: false, saveError: cause instanceof Error ? cause.message : '保存失败，请重试',
      } : previous)
    }
  }, [options.onNoteSaved, sourceKey])

  const copy = useCallback(() => {
    const text = translation?.text.trim()
    if (!text) return
    void copyTextToClipboard(text).then((ok) => {
      if (ok) toast.success('已复制译文')
    })
  }, [translation?.text])

  return { translation, translate, retry, dismiss, copy, saveNote, move }
}
