export type CellInput = string | number | boolean | null | { formula: string }

export interface TableSelection {
  kind: 'table'
  documentPath: string
  sheet: string
  ranges: string[]
  revision: number
  selectionId: string
}

export interface SlideSelection {
  kind: 'slide'
  documentPath: string
  slide: number
  elementIds: string[]
  revision: number
  selectionId: string
  paragraphId?: string
  runId?: string
}

export interface SlideTextPatch {
  text?: string
  fontSize?: number
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  fontFamily?: string
  align?: 'left' | 'center' | 'right' | 'justify'
  spaceBefore?: number
  spaceAfter?: number
}

export interface SlideTextEdit {
  elementId: string
  paragraphId: string
  runId?: string
  start?: number
  end?: number
  expectedText?: string
  patch: SlideTextPatch
}

export interface SlideTextEditArgs {
  documentPath: string
  revision: number
  slide: number
  selectionId?: string
  edits: SlideTextEdit[]
  expectedCount: number
}

export interface SlideViewContext {
  visibleSlide: number
  visibleSlides: number[]
  navigationSlide: number
  selectionSlide: number | null
}

export type DocumentSelection = TableSelection | SlideSelection

export interface TableTarget {
  range?: string
  ranges?: string[]
  selectionId?: string
  row?: number
  column?: string
  start?: number
  count?: number
}

export interface TableEditArgs {
  documentPath: string
  revision: number
  sheet: string
  target: TableTarget
  operation: 'set' | 'fill' | 'clear'
  values?: CellInput[][]
  value?: CellInput
  expectedCount: number
}

export interface SaveBinaryDocumentPayload {
  filePath: string
  data: Uint8Array
  expectedHash: string
}

export interface SaveBinaryDocumentResult {
  filePath: string
  hash: string
}
