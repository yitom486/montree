import { create } from 'zustand'
import type { TranslationTargetLang } from './app-settings-store'
import type { TranslationDetails } from '@/lib/agent/translation-result'

export type ReaderTranslationPhase = 'recognizing' | 'preparing' | 'streaming' | 'enriching' | 'done' | 'error'
export type TranslationNoteWriter = (note: string, sourceText: string) => Promise<unknown>
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
  floatingPosition?: { x: number; y: number }
  text: string
  details?: TranslationDetails
  canSave?: boolean
  saving?: boolean
  saved?: boolean
  saveError?: string
  error?: string
  startedAt: number
  firstTokenAt?: number
  completedAt?: number
}
interface TranslationEntry {
  translation: ReaderTranslationState
  recoverSourceText?: () => Promise<string>
  noteWriter?: TranslationNoteWriter
}
interface ReaderTranslationStore {
  entries: Record<string, TranslationEntry>
  start: (key: string, entry: TranslationEntry) => void
  update: (key: string, requestId: string, change: (previous: ReaderTranslationState) => ReaderTranslationState) => void
  dismiss: (key: string, requestId: string) => void
}

/** 窗口内的临时阅读状态；不落盘，重挂载/窗口缩放不清除，显式关闭才删除。 */
export const useReaderTranslationStore = create<ReaderTranslationStore>((set) => ({
  entries: {},
  start: (key, entry) => set(state => ({ entries: { ...state.entries, [key]: entry } })),
  update: (key, requestId, change) => set(state => {
    const entry = state.entries[key]
    if (!entry || entry.translation.requestId !== requestId) return state
    const translation = change(entry.translation)
    if (translation === entry.translation) return state
    return { entries: { ...state.entries, [key]: { ...entry, translation } } }
  }),
  dismiss: (key, requestId) => set(state => {
    if (state.entries[key]?.translation.requestId !== requestId) return state
    const entries = { ...state.entries }
    delete entries[key]
    return { entries }
  }),
}))
