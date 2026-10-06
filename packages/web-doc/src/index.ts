/**
 * @montree/web-doc barrel（F片合并）。
 *
 * 6 模块：目录提取 2（extract-toc-links / extract-llms-toc）+ 适配 1
 * （people-daily-toc）+ 站点识别 2（hrtt / people-daily）+ 站点门面 1
 * （web-doc-site）。
 *
 * 查重与冲突消解：
 * - 唯一 star 冲突：`resolvePeopleDailyEditionUrl` 同时由 `./people-daily`
 *  （定义处）与 `./web-doc-site`（`export { resolvePeopleDailyEditionUrl }`
 *   重导出，web-doc-site.ts:24）导出；
 * - 消解：`./people-daily` 保持 `export *` 为准，`./web-doc-site`
 *   改显式具名导出并排除该重导出名（下 7 个具名导出无此名）；
 * - 其余导出名两两不交：people-daily-toc 私有 decodeHtmlEntities/stripTags
 *   未导出，与 extract-toc-links 的 decodeHtmlEntities 无 star 冲突；
 *   extract-toc-links / extract-llms-toc / hrtt / people-daily 均无交集。
 * 若后续新增同名导出，须在此改显式重导出并报告。
 */

// ── 目录提取 ──
export * from "./extract-toc-links";
export * from "./extract-llms-toc";

// ── 适配 ──
export * from "./people-daily-toc";

// ── 站点识别（people-daily 为 resolvePeopleDailyEditionUrl 唯一源） ──
export * from "./hrtt";
export * from "./people-daily";

// ── 站点门面（排除已由 ./people-daily 导出的 resolvePeopleDailyEditionUrl） ──
export {
  resolveWebDocSiteId,
  normalizeWebDocInputUrl,
  stripWebDocFragment,
  formatWebDocTitle,
  formatWebDocPathLabel,
  resolveWebDocTocDiscoveryUrl,
  resolveWebDocDocumentId,
  buildWebDocFileFingerprint,
} from "./web-doc-site";
