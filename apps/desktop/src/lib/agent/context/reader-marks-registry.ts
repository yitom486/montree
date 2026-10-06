export interface CreateMarkAtParams {
  excerpt: string
  note: string
  flatIndex?: number
}

export interface ReaderMarksProvider {
  filePath: string
  /** 在当前阅读位置创建书签（不跳转） */
  createBookmark: () => Promise<import('@montree/contracts').ReadingMark>
  /**
   * 基于当前选区（或 sticky 选区快照）创建批注/高亮。
   * note 为空时创建 highlight。
   */
  createNoteFromSelection: (note: string) => Promise<import('@montree/contracts').ReadingMark>
  /** 按摘录在章/视口 DOM 内定位并创建标记（无 fresh 选区） */
  createMarkAt: (params: CreateMarkAtParams) => Promise<import('@montree/contracts').ReadingMark>
  /** 跳到目录 flatIndex（失败引导「打开该章」） */
  navigateToFlatIndex?: (flatIndex: number) => void | Promise<void>
}

let current: ReaderMarksProvider | null = null

export function registerReaderMarks(provider: ReaderMarksProvider): () => void {
  current = provider
  return () => {
    if (current === provider) current = null
  }
}

export function getReaderMarksProvider(): ReaderMarksProvider | null {
  return current
}
