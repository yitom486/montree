import { CONTRACTS_SCAFFOLD } from "@montree/contracts";

export const READER_CORE_SCAFFOLD = `reader-core:${CONTRACTS_SCAFFOLD}` as const;

// A: shared (toc-signature, book-index)
export * from "./book-index";
export { computeTocSignature, normalizeTocTitle, type TocSignatureEntry } from "./toc-signature";

// B: navigation (11)
export * from "./epub-navigation";
export * from "./reader-chapter-nav";
export {
  flattenReaderToc,
  resolveUnitNav,
  type ReaderUnit,
  type ReaderUnitNavState,
  type ReaderTocSource,
} from "./reader-navigation";
export * from "./foliate-section-nav";
export * from "./pdf-outline";
export * from "./pdf-page-metrics";
export {
  PdfTextLayerMappingSink,
  registerPdfPageTextGeometry,
  type PdfSelectionSnapshot,
  normalizeClientRects,
  coalescePdfLineRects,
  unionClientRects,
  coalescePdfTextQuads,
  rectsFromPdfRange,
  buildPdfSnapshotFromRange,
  readPdfSelection,
  getSelectionToolbarPosition,
} from "./pdf-selection";
export * from "./reader-copy-shortcut";
export * from "./reader-selection-dismiss";
export * from "./reader-viewport-nav";
export * from "./reader-wheel-navigation";

// C: marks & notes (8)
export * from "./epub-selection";
export * from "./mobi-selection";
export * from "./reading-mark-colors";
export * from "./reading-mark-hit";
export * from "./reading-mark-kind-filters";
export * from "./export-reading-notes";
export * from "./reader-typography";
export {
  suggestTocPageOffset,
  type TocOffsetCandidate,
  type TocOffsetSearchOptions,
  type TocOffsetSuggestion,
} from "./toc-offset";

// D: web-doc navigation & themes (3)
export * from "./web-doc-toc";
export * from "./epub-themes";
export * from "./reader-navigation-sync";

// E: marks helpers (3)
export * from "./reader-mark-geometry";
export * from "./reading-mark-labels";
export * from "./reading-mark-passages";
