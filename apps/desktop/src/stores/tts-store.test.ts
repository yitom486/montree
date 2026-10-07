import { describe, expect, it } from 'vitest'
import { useTtsStore } from './tts-store'

describe('useTtsStore', () => {
  it('应当正确设置与更新双 Key 与偏好项', () => {
    const store = useTtsStore.getState()
    store.setPrimaryApiKey('primary-key-123')
    store.setSecondaryApiKey('backup-key-456')
    store.setVoiceName('Puck')
    store.setModelId('gemini-2.0-flash')
    store.setRate(1.25)
    store.setSaveAudioCache(false)

    const updated = useTtsStore.getState()
    expect(updated.primaryApiKey).toBe('primary-key-123')
    expect(updated.secondaryApiKey).toBe('backup-key-456')
    expect(updated.voiceName).toBe('Puck')
    expect(updated.modelId).toBe('gemini-2.0-flash')
    expect(updated.rate).toBe(1.25)
    expect(updated.saveAudioCache).toBe(false)
  })

  it('应当正确响应上一句/下一句与跳转逻辑', () => {
    useTtsStore.setState({
      sentences: [
        { id: '1', index: 0, text: '第一句', rawSentence: '第一句', charCount: 3, weight: 3, startTime: 0, endTime: 2 },
        { id: '2', index: 1, text: '第二句', rawSentence: '第二句', charCount: 3, weight: 3, startTime: 2, endTime: 4 },
        { id: '3', index: 2, text: '第三句', rawSentence: '第三句', charCount: 3, weight: 3, startTime: 4, endTime: 6 },
      ],
      currentSentenceIndex: 0,
      isPlayerVisible: true,
      isSpeaking: true,
    })

    const store = useTtsStore.getState()
    store.nextSentence()
    expect(useTtsStore.getState().currentSentenceIndex).toBe(1)

    store.nextSentence()
    expect(useTtsStore.getState().currentSentenceIndex).toBe(2)

    store.prevSentence()
    expect(useTtsStore.getState().currentSentenceIndex).toBe(1)

    store.seekSentence(0)
    expect(useTtsStore.getState().currentSentenceIndex).toBe(0)

    store.closePlayer()
    expect(useTtsStore.getState().isPlayerVisible).toBe(false)
    expect(useTtsStore.getState().isSpeaking).toBe(false)
  })

  it('playFromSnippet 应当正确匹配并跳转到对应句子', async () => {
    useTtsStore.setState({
      sentences: [
        { id: '1', index: 0, text: '第一句引子', rawSentence: '第一句引子', charCount: 5, weight: 5, startTime: 0, endTime: 2 },
        { id: '2', index: 1, text: '第二句正文核心观点', rawSentence: '第二句正文核心观点', charCount: 9, weight: 9, startTime: 2, endTime: 4 },
      ],
      currentSentenceIndex: 0,
      isPlayerVisible: true,
      isSpeaking: true,
    })

    await useTtsStore.getState().playFromSnippet('正文核心观点')
    expect(useTtsStore.getState().currentSentenceIndex).toBe(1)
  })
})
