/**
 * @montree/workspace-core：workspace 协议纯逻辑（零运行时导入，可进远端 bundle）。
 *
 * - `./protocol`：长度分帧编解码、请求/响应信封校验、握手兼容判定、脱敏日志字段。
 * - `./paths`：工作区相对 POSIX 路径纯校验与归一化（真实路径约束在服务端）。
 * - `./revision`：不透明 revision token 的拼装/解析/比较（hash 由持 fs 端计算）。
 */
export * from "./protocol";
export * from "./paths";
export * from "./revision";
