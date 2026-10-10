import { useState } from 'react'
import type { PresentationDocument, PresentationElement } from '@/lib/data/presentation-document'
import { Button } from '@/components/ui/button'

export function PptxElementInspector({ doc, element, edit, close }: {
  doc: PresentationDocument; element: PresentationElement; edit: (args: Record<string, unknown>) => void; close: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [paragraphId, setParagraphId] = useState(doc.selection?.paragraphId ?? element.appearance.paragraphs[0]?.id ?? '')
  const paragraph = element.appearance.paragraphs.find((item) => item.id === paragraphId)
  const patch = (values: Record<string, unknown>): void => edit({ revision: doc.revision, slide: doc.selection!.slide,
    operation: 'text', edits: [{ elementId: element.id, paragraphId, expectedText: paragraph?.text, patch: values }], expectedCount: 1 })
  return <aside className="w-64 shrink-0 overflow-auto border-l p-3 text-xs" aria-label="元素检查器">
    <div className="mb-3 flex items-center justify-between"><strong>元素详情</strong><Button size="xs" variant="ghost" onClick={close}>关闭</Button></div>
    <p>第 {doc.selection?.slide} 页 · {element.name || element.type}</p>
    <p className="my-2 text-muted-foreground">位置 {element.x.toFixed(1)}, {element.y.toFixed(1)} · 尺寸 {element.width.toFixed(1)} × {element.height.toFixed(1)} 磅</p>
    {doc.selection!.elementIds.length > 1 ? <p>已选择 {doc.selection!.elementIds.length} 个元素。单选文本框可编辑段落。</p> : element.capabilities.includes('text') && <>
      <div className="my-3 space-y-2">{element.appearance.paragraphs.map((item, index) => <Button key={item.id} variant={paragraphId === item.id ? 'secondary' : 'ghost'} size="xs" className="w-full justify-start truncate" onClick={() => setParagraphId(item.id)}>段落 {index + 1}：{item.text || '空段落'}</Button>)}</div>
      {paragraph && <>
        <p className="mb-2 whitespace-pre-wrap break-words">{paragraph.text}</p>
        <Button size="xs" disabled={paragraph.runs.some((run) => run.kind === 'field')} onClick={() => setEditing(!editing)}>{editing ? '收起编辑' : '编辑文字与样式'}</Button>
        {paragraph.runs.some((run) => run.kind === 'field') && <p className="mt-2 text-muted-foreground">此段包含动态字段，暂不支持编辑。</p>}
        {editing && <form key={`${doc.revision}:${paragraphId}`} className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); patch({ text: String(values.get('text')) }) }}>
          <label className="block">段落文字<textarea name="text" aria-label="段落文字" defaultValue={paragraph.text} className="mt-1 h-32 w-full rounded border bg-background p-2" /></label>
          <Button size="xs" type="submit">应用文字</Button>
          <div className="border-t pt-3"><p className="mb-2 text-muted-foreground">以下样式应用到当前整段</p>
            <label className="block">字号<input name="fontSize" aria-label="段落字号" type="number" min="1" max="1000" defaultValue={paragraph.runs[0]?.fontSize ?? paragraph.fontSize ?? 18} className="ml-2 w-16 rounded border bg-background p-1" /></label>
            <label className="my-2 block">颜色<input name="color" aria-label="段落颜色" type="color" defaultValue={paragraph.runs[0]?.color?.match(/^#[a-f\d]{6}$/i)?.[0] ?? '#000000'} className="ml-2 align-middle" /></label>
            <label><input name="bold" type="checkbox" defaultChecked={paragraph.runs[0]?.bold ?? paragraph.bold} /> 粗体</label>
            <Button size="xs" type="button" className="mt-2 block" onClick={(event) => { const values = new FormData(event.currentTarget.closest('form')!); patch({ fontSize: Number(values.get('fontSize')), color: String(values.get('color')), bold: values.has('bold') }) }}>应用样式</Button>
          </div>
        </form>}
      </>}
    </>}
  </aside>
}
