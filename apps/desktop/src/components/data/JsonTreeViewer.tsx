import { memo, useCallback, useMemo, useState } from 'react'
import {
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  FoldVertical,
  Search,
  Trash2,
  UnfoldVertical,
  Wand2,
  X,
} from 'lucide-react'
import { JsonTreeModel, type JsonTreeNode } from '@/lib/data/json-tree-model'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { VanillaJsonEditorHost } from './VanillaJsonEditorHost'
import { useEditorUiStore } from '@/stores/editor-ui-store'
import { Sparkles } from 'lucide-react'

interface JsonTreeViewerProps {
  content: string
  onChange: (newContent: string) => void
  readOnly?: boolean
}

export const JsonTreeViewer = memo(function JsonTreeViewer({
  content,
  onChange,
  readOnly = false,
}: JsonTreeViewerProps) {
  const theme = useEditorUiStore((state) => state.theme)
  const [viewMode, setViewMode] = useState<'tree' | 'source' | 'pro'>('tree')
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set())
  const [editingPath, setEditingPath] = useState<{ pathString: string; val: string } | null>(null)
  const [copiedPath, setCopiedPath] = useState<string | null>(null)

  // 解析模型
  const { model, parseError } = useMemo(() => {
    try {
      const parsed = JsonTreeModel.parse(content)
      return { model: parsed, parseError: null }
    } catch (err) {
      return { model: null, parseError: err instanceof Error ? err.message : String(err) }
    }
  }, [content])

  // 折叠与展开控制
  const toggleCollapse = useCallback((pathString: string) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(pathString)) {
        next.delete(pathString)
      } else {
        next.add(pathString)
      }
      return next
    })
  }, [])

  const handleExpandAll = useCallback(() => {
    setCollapsedPaths(new Set())
  }, [])

  const handleCollapseAll = useCallback(() => {
    if (!model?.tree) return
    const allPaths = new Set<string>()
    const collect = (node: JsonTreeNode) => {
      if (node.type === 'object' || node.type === 'array') {
        if (node.pathString !== '$') allPaths.add(node.pathString)
        node.children?.forEach(collect)
      }
    }
    collect(model.tree)
    setCollapsedPaths(allPaths)
  }, [model])

  // 格式化源码
  const handleFormat = useCallback(() => {
    if (!model || readOnly) return
    onChange(model.serialize(2))
    toast.success('JSON 已格式化对齐')
  }, [model, onChange, readOnly])

  // 提交数值编辑
  const handleCommitValueEdit = useCallback(() => {
    if (!editingPath || !model || readOnly) {
      setEditingPath(null)
      return
    }
    const { pathString, val } = editingPath
    let parsedVal: unknown = val

    if (val === 'true') parsedVal = true
    else if (val === 'false') parsedVal = false
    else if (val === 'null') parsedVal = null
    else if (!isNaN(Number(val)) && val.trim() !== '') parsedVal = Number(val)

    model.updateValueByPath(pathString, parsedVal)
    onChange(model.serialize(2))
    setEditingPath(null)
  }, [editingPath, model, onChange, readOnly])

  // 切换布尔值
  const handleToggleBoolean = useCallback(
    (pathString: string, currentVal: boolean) => {
      if (!model || readOnly) return
      model.updateValueByPath(pathString, !currentVal)
      onChange(model.serialize(2))
    },
    [model, onChange, readOnly],
  )

  // 复制 JSONPath
  const handleCopyPath = useCallback((pathString: string) => {
    navigator.clipboard.writeText(pathString)
    setCopiedPath(pathString)
    setTimeout(() => setCopiedPath(null), 1500)
    toast.success(`已复制路径: ${pathString}`)
  }, [])

  // 删除属性
  const handleDeleteNode = useCallback(
    (pathString: string) => {
      if (!model || readOnly) return
      model.deleteByPath(pathString)
      onChange(model.serialize(2))
    },
    [model, onChange, readOnly],
  )

  // 递归渲染树节点
  const renderNode = (node: JsonTreeNode, depth: number = 0): React.ReactNode => {
    const isContainer = node.type === 'object' || node.type === 'array'
    const isCollapsed = collapsedPaths.has(node.pathString)
    const isEditing = editingPath?.pathString === node.pathString

    const keyStr = String(node.key)
    const matchesSearch =
      Boolean(searchQuery.trim()) &&
      (keyStr.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
        String(node.value).toLowerCase().includes(searchQuery.toLowerCase().trim()))

    return (
      <div key={node.id} className="flex flex-col text-xs leading-6">
        <div
          className={cn(
            'group relative flex items-center gap-1.5 rounded px-2 py-0.5 font-mono hover:bg-muted/50',
            matchesSearch && 'bg-warning/15 ring-1 ring-warning/30',
          )}
          style={{ paddingLeft: `${Math.max(8, depth * 18)}px` }}
        >
          {/* 折叠/展开箭头 */}
          {isContainer ? (
            <button
              type="button"
              onClick={() => toggleCollapse(node.pathString)}
              className="flex size-4 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              {isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
          ) : (
            <span className="size-4" />
          )}

          {/* 属性键名 (Key) */}
          {node.pathString !== '$' && (
            <span className="font-semibold text-foreground">
              {keyStr}
              <span className="text-muted-foreground">:</span>
            </span>
          )}

          {/* 节点值或容器摘要 */}
          {isContainer ? (
            <span
              onClick={() => toggleCollapse(node.pathString)}
              className="cursor-pointer text-muted-foreground select-none hover:text-foreground"
            >
              {node.type === 'object' ? '{' : '['}
              {isCollapsed && (
                <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                  {node.type === 'object'
                    ? `${node.children?.length ?? 0} 个键`
                    : `${node.children?.length ?? 0} 项`}
                </span>
              )}
              {isCollapsed && (node.type === 'object' ? '}' : ']')}
            </span>
          ) : isEditing ? (
            <input
              autoFocus
              value={editingPath.val}
              onChange={(e) =>
                setEditingPath((prev) => (prev ? { ...prev, val: e.target.value } : null))
              }
              onBlur={handleCommitValueEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCommitValueEdit()
                else if (e.key === 'Escape') setEditingPath(null)
              }}
              className="h-5 rounded border bg-background px-1 text-xs outline-none focus:ring-1 focus:ring-primary"
            />
          ) : (
            <div
              onDoubleClick={() => {
                if (!readOnly && node.type !== 'boolean') {
                  setEditingPath({ pathString: node.pathString, val: String(node.value ?? '') })
                }
              }}
              className="flex items-center gap-1.5"
            >
              {node.type === 'string' && (
                <span className="text-success">
                  "{String(node.value)}"
                </span>
              )}
              {node.type === 'number' && (
                <span className="font-bold text-warning">
                  {String(node.value)}
                </span>
              )}
              {node.type === 'boolean' && (
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => handleToggleBoolean(node.pathString, Boolean(node.value))}
                  className={cn(
                    'rounded px-1.5 py-0.2 text-[11px] font-semibold transition-transform active:scale-95',
                    node.value
                      ? 'bg-accent text-accent-foreground border border-border'
                      : 'bg-muted text-muted-foreground',
                  )}
                  title="点击切换布尔值"
                >
                  {String(node.value)}
                </button>
              )}
              {node.type === 'null' && (
                <span className="italic text-muted-foreground/60">null</span>
              )}
            </div>
          )}

          {/* 悬浮操作：复制路径与删除 */}
          <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={() => handleCopyPath(node.pathString)}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              title={`复制 JSONPath: ${node.pathString}`}
            >
              {copiedPath === node.pathString ? (
                <Check className="size-3 text-success" />
              ) : (
                <Copy className="size-3" />
              )}
            </button>
            {!readOnly && node.pathString !== '$' && (
              <button
                type="button"
                onClick={() => handleDeleteNode(node.pathString)}
                className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title="删除此属性"
              >
                <Trash2 className="size-3" />
              </button>
            )}
          </div>
        </div>

        {/* 展开的子节点列表 */}
        {isContainer && !isCollapsed && (
          <div className="relative flex flex-col">
            <div className="relative flex flex-col">
              {node.children?.map((child) => renderNode(child, depth + 1))}
            </div>
            <div
              className="font-mono text-muted-foreground select-none"
              style={{ paddingLeft: `${Math.max(8, depth * 18 + 14)}px` }}
            >
              {node.type === 'object' ? '}' : ']'}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground select-text">
      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
            <Braces className="size-4 text-primary" />
            <span>
              JSON 数据树
              {parseError ? (
                <span className="ml-1 text-destructive font-normal">(解析异常)</span>
              ) : (
                <span className="ml-1">· {model?.tree?.children?.length ?? 0} 个顶级节点</span>
              )}
            </span>
          </div>

          <div className="h-4 w-px bg-border" />

          {/* 搜索框 */}
          <div className="relative flex items-center">
            <Search className="absolute left-2 size-3 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索键或值..."
              className="h-7 w-36 rounded pl-7 pr-6 text-xs focus-visible:ring-1"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-1.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {viewMode === 'tree' && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleExpandAll}
                className="h-7 gap-1 px-2 text-xs"
                title="展开全部节点"
              >
                <UnfoldVertical className="size-3" />
                展开
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCollapseAll}
                className="h-7 gap-1 px-2 text-xs"
                title="折叠全部节点"
              >
                <FoldVertical className="size-3" />
                折叠
              </Button>
              {!readOnly && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleFormat}
                  className="h-7 gap-1 px-2 text-xs"
                  title="格式化缩进"
                >
                  <Wand2 className="size-3 text-primary" />
                  格式化
                </Button>
              )}
              <div className="h-4 w-px bg-border" />
            </>
          )}

          <div className="flex items-center rounded-md border bg-muted/60 p-0.5">
            <Button
              variant={viewMode === 'pro' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('pro')}
              className="h-6 gap-1 px-2 text-xs"
              title="工业级全能 JSON 编辑器（支持树形、表格与语法校验）"
            >
              <Sparkles className="size-3 text-primary" />
              全能
            </Button>
            <Button
              variant={viewMode === 'tree' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('tree')}
              className="h-6 gap-1 px-2 text-xs"
              title="极简大纲树"
            >
              <Braces className="size-3" />
              大纲
            </Button>
            <Button
              variant={viewMode === 'source' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('source')}
              className="h-6 gap-1 px-2 text-xs"
              title="纯文本源码"
            >
              <Code2 className="size-3" />
              源码
            </Button>
          </div>
        </div>
      </div>

      {/* 主展示区 */}
      <div className="relative flex-1 overflow-auto">
        {viewMode === 'pro' ? (
          <VanillaJsonEditorHost
            content={content}
            onChange={onChange}
            readOnly={readOnly}
            theme={theme}
          />
        ) : parseError ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <p className="font-medium text-destructive">JSON 格式解析失败</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{parseError}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setViewMode('source')}
              className="mt-4"
            >
              切换至源码视图修正
            </Button>
          </div>
        ) : viewMode === 'source' ? (
          <div className="h-full w-full p-3">
            <textarea
              value={content}
              readOnly={readOnly}
              onChange={(e) => onChange(e.target.value)}
              className="h-full w-full resize-none bg-background font-mono text-xs leading-relaxed outline-none"
              spellCheck={false}
            />
          </div>
        ) : model?.tree ? (
          <div className="min-w-full p-3 font-mono">{renderNode(model.tree)}</div>
        ) : null}
      </div>
    </div>
  )
})
