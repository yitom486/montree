import { useEffect, useMemo, useRef } from 'react'
import { getDocumentKind, isOk } from '@montree/contracts'
import { fileApi } from '@/api/file-api'
import { TextDocument } from '@/lib/editor/text-document'
import { notifyDocumentTools, registerDocumentTools } from '@/lib/agent/context/document-tool-registry'
import { registerSelectionProvider, commitDocumentSelection, getStickyReaderSelection, clearReaderSelection } from '@/lib/agent/context/reader-selection-registry'
import { clearDraftForFile } from './useDraftPersistence'

export function useTextDocumentTools(options: {
  filePath?: string; content: string; savedContent: string; diskContent: string; session: number
  onChange: (text: string) => void; onSaved: (text: string) => void
}): TextDocument | undefined {
  const latest = useRef(options)
  latest.current = options
  const model = useMemo(() => {
    const { filePath, content, savedContent, diskContent, session } = latest.current
    if (!filePath || getDocumentKind(filePath) !== 'markdown') return undefined
    const model = new TextDocument(filePath, content, savedContent, diskContent,
      (text) => {
        if (latest.current.filePath === filePath && latest.current.session === session) {
          if (getStickyReaderSelection()?.filePath === filePath) clearReaderSelection()
          latest.current.onChange(text)
        }
      }, notifyDocumentTools,
      async (text, expectedContent) => {
        const result = await fileApi.saveFile({ filePath, content: text, expectedContent })
        if (!isOk(result)) throw new Error(result.error.message)
        if (latest.current.filePath === filePath && latest.current.session === session) latest.current.onSaved(text)
        clearDraftForFile(filePath)
      })
    model.onSelectionChange = () => {
      if (latest.current.filePath !== filePath || latest.current.session !== session) return
      const target = model.selectionSnapshot()
      if (target) commitDocumentSelection(target, target.ranges.map((range) => range.text).join('\n'))
      else if (getStickyReaderSelection()?.filePath === filePath) clearReaderSelection()
    }
    return model
  }, [options.filePath, options.session])
  useEffect(() => { model?.sync(options.content) }, [model, options.content])
  useEffect(() => { model?.markSaved(options.savedContent, options.diskContent) }, [model, options.savedContent, options.diskContent])
  useEffect(() => {
    if (!model) return
    const disposeTools = registerDocumentTools({ filePath: model.filePath, kind: 'text', isDirty: model.isDirty,
      save: model.save, undo: model.undo, read: model.read, edit: model.edit })
    const disposeSelection = registerSelectionProvider({ filePath: model.filePath,
      getSelectionText: () => model.selection()?.ranges.map((range) => range.text).join('\n') ?? null,
      getSelectionTarget: model.selectionSnapshot })
    return () => { disposeSelection(); disposeTools() }
  }, [model])
  return model
}
