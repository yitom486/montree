import type { CSSProperties } from 'react'
import type { PresentationDocument, PresentationElement } from '@/lib/data/presentation-document'
import type { PresentationTextStyle } from '@/lib/data/presentation-preview'
import { cn } from '@/lib/utils'
import { PresentationChart } from './PresentationChart'

export function PresentationSlide({ doc, slide, zoom, select, presenting = false }: {
  doc: PresentationDocument
  slide: number
  zoom: number
  select?: (slide: number, id: string, additive: boolean, focus?: { paragraphId?: string; runId?: string }) => void
  presenting?: boolean
}) {
  const points = (value: number, width = doc.width): string => `${value / width * 100}cqw`
  const textStyle = (style: PresentationTextStyle, width = doc.width): CSSProperties => ({ fontSize: points(style.fontSize ?? 18, width), color: style.color,
    fontWeight: style.bold ? 700 : 400, fontStyle: style.italic ? 'italic' : 'normal', textDecoration: style.underline ? 'underline' : undefined,
    fontFamily: style.fontFamily ? `"${style.fontFamily.replace(/["\\]/g, '')}", Arial, sans-serif` : 'Arial, sans-serif' })
  const renderElement = (element: PresentationElement, space = { x: 0, y: 0, width: doc.width, height: doc.height }) => {
    const appearance = element.appearance
    const selected = !presenting && doc.selection?.slide === slide && doc.selection.elementIds.includes(element.id)
    // Group transforms affect shape geometry; font sizes remain slide points in PowerPoint.
    const pt = (value: number): string => points(value)
    const shapeStyle: CSSProperties = { left: `${(element.x - space.x) / space.width * 100}%`, top: `${(element.y - space.y) / space.height * 100}%`,
      width: `${element.width / space.width * 100}%`, height: `${element.height / space.height * 100}%`,
      transform: `rotate(${appearance.rotation}deg) scale(${appearance.flipH ? -1 : 1}, ${appearance.flipV ? -1 : 1})`,
      background: appearance.fill, border: appearance.lineColor ? `${pt(appearance.lineWidth)} solid ${appearance.lineColor}` : undefined,
      borderRadius: appearance.geometry === 'ellipse' ? '50%' : appearance.geometry === 'roundRect' ? '12%' : undefined }
    return <div key={element.id} data-element-id={element.id} title={presenting ? undefined : `${element.name} · ${element.id}`}
      onClick={!presenting && select ? (event) => { event.stopPropagation(); const target = event.target as HTMLElement; select(slide, element.id, event.ctrlKey || event.metaKey,
        { paragraphId: target.closest<HTMLElement>('[data-paragraph-id]')?.dataset.paragraphId, runId: target.closest<HTMLElement>('[data-run-id]')?.dataset.runId }) }
        : undefined}
      className={cn('absolute', !presenting && 'cursor-pointer', selected && 'ring-2 ring-primary')} style={shapeStyle}>
      {element.chart ? <PresentationChart chart={element.chart} />
        : element.children && element.group && element.group.width > 0 && element.group.height > 0 ? <div className="relative h-full w-full">{element.children.map((item) => renderElement(item, element.group!))}</div>
        : element.image ? <img src={element.image} alt={element.name} className="h-full w-full object-contain" />
        : element.type === 'sp' ? <div className="flex h-full w-full flex-col" style={{ boxSizing: 'border-box',
          justifyContent: appearance.verticalAlign === 'center' ? 'center' : appearance.verticalAlign === 'end' ? 'flex-end' : 'flex-start',
          padding: `${pt(appearance.inset.top)} ${pt(appearance.inset.right)} ${pt(appearance.inset.bottom)} ${pt(appearance.inset.left)}` }}>
          {appearance.paragraphs.map((paragraph, index) => <div key={index} data-slide-paragraph data-paragraph-id={paragraph.id} className="shrink-0" style={{ ...textStyle(paragraph),
            whiteSpace: appearance.wrap ? 'pre-wrap' : 'pre', overflowWrap: appearance.wrap ? 'break-word' : 'normal', textAlign: paragraph.align,
            lineHeight: paragraph.lineSpacing !== undefined ? pt(paragraph.lineSpacing) : paragraph.lineHeight ?? 1.2,
            marginTop: pt(paragraph.before), marginBottom: pt(paragraph.after), paddingLeft: pt(paragraph.indent), minHeight: pt(paragraph.fontSize ?? 18) }}>
            {paragraph.bullet && <span>{paragraph.bullet} </span>}
            {paragraph.runs.map((run, runIndex) => <span key={runIndex} data-run-id={run.id} style={textStyle(run)}>{run.text}</span>)}
          </div>)}
        </div> : <span className="text-xs text-gray-500">{element.text || `${element.name || element.type}（预览未支持）`}</span>}
    </div>
  }
  return <div data-slide-canvas className="relative overflow-hidden border text-black shadow" style={{ containerType: 'inline-size',
    background: doc.background(slide), aspectRatio: `${doc.width}/${doc.height}`, width: `${zoom}%`, minWidth: presenting ? 0 : 320 }}>
    {doc.elements(slide).map((element) => renderElement(element))}
  </div>
}
