// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { useAppSettingsStore } from './app-settings-store'

afterEach(() => {
  localStorage.removeItem('markdown-editor-settings')
  useAppSettingsStore.setState(useAppSettingsStore.getInitialState())
})

it('旧设置中的源码模式不影响默认所见即所得，其他偏好仍恢复，临时源码选择不持久化', async () => {
  localStorage.setItem('markdown-editor-settings', JSON.stringify({
    state: { markdownEditorMode: 'source', editorFontSize: 19, autoSaveEnabled: false }, version: 0,
  }))
  await useAppSettingsStore.persist.rehydrate()
  expect(useAppSettingsStore.getState().markdownEditorMode).toBe('live-preview')
  expect(useAppSettingsStore.getState().editorFontSize).toBe(19)
  expect(useAppSettingsStore.getState().autoSaveEnabled).toBe(false)
  useAppSettingsStore.getState().setMarkdownEditorMode('source')
  expect(useAppSettingsStore.getState().markdownEditorMode).toBe('source')
  expect(JSON.parse(localStorage.getItem('markdown-editor-settings')!).state).not.toHaveProperty('markdownEditorMode')
  await useAppSettingsStore.persist.rehydrate()
  expect(useAppSettingsStore.getState().markdownEditorMode).toBe('live-preview')
})

it('翻译目标语言默认简体中文，持久化值可恢复且忽略非法值', async () => {
  expect(useAppSettingsStore.getState().translationTargetLang).toBe('zh-CN')
  useAppSettingsStore.getState().setTranslationTargetLang('en')
  expect(JSON.parse(localStorage.getItem('markdown-editor-settings')!).state.translationTargetLang).toBe('en')

  localStorage.setItem('markdown-editor-settings', JSON.stringify({
    state: { translationTargetLang: 'en' }, version: 0,
  }))
  await useAppSettingsStore.persist.rehydrate()
  expect(useAppSettingsStore.getState().translationTargetLang).toBe('en')

  localStorage.setItem('markdown-editor-settings', JSON.stringify({
    state: { translationTargetLang: 'not-a-language' }, version: 0,
  }))
  await useAppSettingsStore.persist.rehydrate()
  expect(useAppSettingsStore.getState().translationTargetLang).toBe('zh-CN')
})

it('翻译模型按运行时分桶保存，与聊天模型偏好互不覆盖', async () => {
  useAppSettingsStore.getState().setTranslationModel('opencode', 'fast-model')
  expect(useAppSettingsStore.getState().translationModelByRuntime.opencode).toBe('fast-model')
  expect(JSON.parse(localStorage.getItem('markdown-editor-settings')!).state.translationModelByRuntime).toEqual({
    opencode: 'fast-model',
  })
})

it('翻译思考档按运行时持久化，旧设置使用最低可用策略并过滤非法值', async () => {
  expect(useAppSettingsStore.getState().translationThoughtByRuntime).toEqual({})
  useAppSettingsStore.getState().setTranslationThought('opencode', 'low')
  useAppSettingsStore.getState().setTranslationThought('codex-acp', 'minimal')
  await useAppSettingsStore.persist.rehydrate()
  expect(useAppSettingsStore.getState().translationThoughtByRuntime).toEqual({ opencode: 'low', 'codex-acp': 'minimal' })
  localStorage.setItem('markdown-editor-settings', JSON.stringify({ state: { translationThoughtByRuntime: { opencode: 123, other: '' } }, version: 0 }))
  await useAppSettingsStore.persist.rehydrate()
  expect(useAppSettingsStore.getState().translationThoughtByRuntime).toEqual({})
})

it('翻译 Agent 单独保存，旧设置使用 OpenCode，重启后恢复独立选择', async () => {
  expect(useAppSettingsStore.getState().translationRuntimeId).toBe('opencode')
  useAppSettingsStore.getState().setTranslationRuntime('codex-acp')
  await useAppSettingsStore.persist.rehydrate()
  expect(useAppSettingsStore.getState().translationRuntimeId).toBe('codex-acp')
})
