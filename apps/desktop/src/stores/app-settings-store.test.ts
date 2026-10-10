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
