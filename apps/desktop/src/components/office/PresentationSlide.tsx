import type { CSSProperties } from 'react'
import type { PresentationDocument, PresentationElement } from '@/lib/data/presentation-document'
import type { PresentationTextStyle } from '@/lib/data/presentation-preview'
import { cn } from '@/lib/utils'

export function PresentationSlide({ doc, slide, zoom, select }: {
  doc: PresentationDocument
  slide: number
  zoom: number
  select: (slide: number, id: string, additive: boolean) => void
}) {
  const points = (value: number): string => `${value / doc.width * 100}cqw`
  const textStyle = (style: PresentationTextStyle): CSSProperties => ({ fontSize: points(style.fontSize ?? 18), color: style.color,
    fontWeight: style.bold ? 700 : 400, fontStyle: style.italic ? 'italic' : 'normal', textDecoration: style.underline ? 'underline' : undefined,
    fontFamily: style.fontFamily ? `"${style.fontFamily.replace(/["\\]/g, '')}", Arial, sans-serif` : 'Arial, sans-serif' })
  const renderElement = (element: PresentationElement) => {
    const appearance = element.appearance
    const selected = doc.selection?.slide === slide && doc.selection.elementIds.includes(element.id)
    const shapeStyle: CSSProperties = { left: `${element.x / doc.width * 100}%`, top: `${element.y / doc.height * 100}%`,
      width: `${element.width / doc.width * 100}%`, height: `${element.height / doc.height * 100}%`,
      transform: `rotate(${appearance.rotation}deg) scale(${appearance.flipH ? -1 : 1}, ${appearance.flipV ? -1 : 1})`,
      background: appearance.fill, border: appearance.lineColor ? `${points(appearance.lineWidth)} solid ${appearance.lineColor}` : undefined,
      borderRadius: appearance.geometry === 'ellipse' ? '50%' : appearance.geometry === 'roundRect' ? '12%' : undefined }
    return <div key={element.id} data-element-id={element.id} title={`${element.name} · ${element.id}`}
      onClick={(event) => { event.stopPropagation(); select(slide, element.id, event.ctrlKey || event.metaKey) }}
      className={cn('absolute cursor-pointer', selected && 'ring-2 ring-primary')} style={shapeStyle}>
      {element.image ? <img src={element.image} alt={element.name} className="h-full w-full object-contain" />
        : element.type === 'sp' ? <div className="flex h-full w-full flex-col" style={{ boxSizing: 'border-box',
          justifyContent: appearance.verticalAlign === 'center' ? 'center' : appearance.verticalAlign === 'end' ? 'flex-end' : 'flex-start',
          padding: `${points(appearance.inset.top)} ${points(appearance.inset.right)} ${points(appearance.inset.bottom)} ${points(appearance.inset.left)}` }}>
          {appearance.paragraphs.map((paragraph, index) => <div key={index} data-slide-paragraph className="shrink-0" style={{ ...textStyle(paragraph),
            whiteSpace: appearance.wrap ? 'pre-wrap' : 'pre', overflowWrap: appearance.wrap ? 'break-word' : 'normal', textAlign: paragraph.align,
            lineHeight: paragraph.lineSpacing !== undefined ? points(paragraph.lineSpacing) : paragraph.lineHeight ?? 1.2,
            marginTop: points(paragraph.before), marginBottom: points(paragraph.after), paddingLeft: points(paragraph.indent), minHeight: points(paragraph.fontSize ?? 18) }}>
            {paragraph.bullet && <span>{paragraph.bullet} </span>}
            {paragraph.runs.map((run, runIndex) => <span key={runIndex} style={textStyle(run)}>{run.text}</span>)}
          </div>)}
        </div> : <span className="text-xs text-gray-500">{element.text || `${element.name || element.type}（预览未支持）`}</span>}
    </div>
  }
  return <div data-slide-canvas className="relative overflow-hidden border text-black shadow" style={{ containerType: 'inline-size',
    background: doc.background(slide), aspectRatio: `${doc.width}/${doc.height}`, width: `${zoom}%`, minWidth: 320 }}>
    {doc.elements(slide).map(renderElement)}
  </div>
}
