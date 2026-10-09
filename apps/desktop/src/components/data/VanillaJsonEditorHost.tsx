import { useEffect, useRef } from 'react'
import { createJSONEditor, Mode, type Content } from 'vanilla-jsoneditor'
import 'vanilla-jsoneditor/themes/jse-theme-dark.css'
import { cn } from '@/lib/utils'

type VanillaEditorInstance = ReturnType<typeof createJSONEditor>

interface VanillaJsonEditorHostProps {
  content: string
  onChange: (newContent: string) => void
  readOnly?: boolean
  className?: string
  theme?: string
}

export function VanillaJsonEditorHost({
  content,
  onChange,
  readOnly = false,
  className,
  theme,
}: VanillaJsonEditorHostProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<VanillaEditorInstance | null>(null)
  const isInternalChangeRef = useRef(false)

  // 初始化编辑器实例
  useEffect(() => {
    if (!containerRef.current) return

    let initialContent: Content
    try {
      initialContent = { json: JSON.parse(content) }
    } catch {
      initialContent = { text: content }
    }

    const editor = createJSONEditor({
      target: containerRef.current,
      props: {
        content: initialContent,
        mode: Mode.tree,
        readOnly,
        mainMenuBar: false,
        navigationBar: false,
        statusBar: false,
        onChange: (updatedContent: Content) => {
          isInternalChangeRef.current = true
          try {
            if ('text' in updatedContent && typeof updatedContent.text === 'string') {
              onChange(updatedContent.text)
            } else if ('json' in updatedContent) {
              onChange(JSON.stringify(updatedContent.json, null, 2))
            }
          } finally {
            setTimeout(() => {
              isInternalChangeRef.current = false
            }, 50)
          }
        },
      },
    })

    editorRef.current = editor

    return () => {
      try {
        editor.destroy()
      } catch (err) {
        console.warn('[VanillaJsonEditor] destroy warning:', err)
      }
      editorRef.current = null
    }
  }, [])

  // 外部 content 更新时同步（避免自身触发的变更造成循环重置）
  useEffect(() => {
    if (!editorRef.current || isInternalChangeRef.current) return

    let nextContent: Content
    try {
      nextContent = { json: JSON.parse(content) }
    } catch {
      nextContent = { text: content }
    }

    try {
      editorRef.current.update(nextContent)
    } catch {
      // 容错处理
    }
  }, [content])

  // readOnly 状态同步
  useEffect(() => {
    if (!editorRef.current) return
    editorRef.current.updateProps({ readOnly })
  }, [readOnly])

  const isDark = theme === 'dark'

  return (
    <div
      ref={containerRef}
      className={cn(
        'h-full w-full overflow-hidden text-xs',
        isDark && 'jse-theme-dark',
        className,
      )}
    />
  )
}
