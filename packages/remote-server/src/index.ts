/**
 * @montree/remote-server：workspace Node 服务（Node-only 独立入口）。
 *
 * 约束：只用 node: 内建模块；禁止 electron / node:sqlite / 本机 DB /
 * @firecrawl/pdf-inspector / PDFium / ONNX / OCR / GUI /
 * scripts-third-party 手搓 RPC（见 scripts/check-deps.ts R7）。
 * stdin/stdout 只走协议帧，全部日志走 stderr。
 */
export * from "./logger";
export * from "./root-guard";
export * from "./methods";
export * from "./watch";
export * from "./server";
