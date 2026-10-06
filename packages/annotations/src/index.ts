/**
 * @montree/annotations barrel（F片合并）。
 *
 * 5 模块，按合并 / 复习 / 模型 / 核心 / 导出分组。
 *
 * 查重（A片 export 表 + 包内 25 个导出名）：
 * - marks-merger：SyncMarksPayload / MarksMergeResult / DEFAULT_TOMBSTONE_TTL_MS /
 *   MarksMergeOptions / mergeReadingMarks；
 * - flashcard-review：FlashcardReviewRating / FlashcardReviewStats /
 *   ClozeParsedResult / parseClozeContent / calculateReviewStats；
 * - flashcard：FlashcardKind / Flashcard；
 * - marks-core：normalizeMarkFilePath / validateReadingAnchor /
 *   normalizeOptionalText / buildReadingMark / applyReadingMarkUpdate /
 *   applyReadingMarkDelete；
 * - anki-cards：BuildAnkiCardsExportInput / BuildAnkiCardsExportResult /
 *   escapeAnkiHtml / sanitizeAnkiTag / buildAnkiExportFileName /
 *   formatFlashcardForAnkiHtml / buildAnkiCardsExport；
 * - 5 组导出名两两不交，无裸名冲突，可安全 `export *`，无需显式冲突消解。
 * 若后续新增裸名（如 list/get），须在此改显式重导出并报告。
 */

// ── 合并 ──
export * from "./marks-merger";

// ── 复习 ──
export * from "./flashcard-review";

// ── 模型 ──
export * from "./flashcard";

// ── 核心 ──
export * from "./marks-core";

// ── 导出 ──
export * from "./anki-cards";

// ── 阅读标记提议（A2：shared/types/mark-proposal 入包） ──
export * from "./mark-proposal";

// ── 章级划重点建议（D片改判：与 mark-proposal 同族、renderer 安全，归 annotations） ──
export * from "./chapter-mark-plan";
