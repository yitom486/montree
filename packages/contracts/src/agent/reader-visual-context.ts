export interface ReaderImageReference {
  id: string
  kind: 'image' | 'svg' | 'canvas' | 'pdf-image'
  src?: string
  alt?: string
  caption?: string
  visible?: boolean
  loaded?: boolean
  page?: number
}

export interface ReaderViewportRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ReaderVisualContext {
  documentPath: string
  scope: 'current' | 'viewport'
  total: number
  truncated: boolean
  images: ReaderImageReference[]
  viewport: ReaderViewportRect | null
  note?: string
}

export interface ReaderViewportImage {
  documentPath: string
  mimeType: 'image/png'
  data: string
  width: number
  height: number
}
