/**
 * workspace 独立协议：信封、长度分帧、握手兼容、脱敏。
 *
 * 线格式：`u32 BE 长度 N + N 字节 UTF-8 JSON`。长度记字节数，
 * 天然兼容 UTF-8 多字节；stdin/stdout 只走协议帧，日志走 stderr。
 * 请求 id 统一 `ws-<n>` 命名空间，不复用 ACP 消息 ID。
 */
import type { AppError } from "@montree/contracts/core/errors";
import {
  WORKSPACE_PROTOCOL_MAJOR,
  WORKSPACE_PROTOCOL_MINOR,
  type WorkspaceMethod,
  type WorkspaceServerHandshake,
} from "@montree/contracts/types/workspace";

export const WORKSPACE_FRAME_HEADER_BYTES = 4;

export interface WorkspaceRequest {
  /** 协议标识，避免与登录 shell 杂音/其他协议混淆 */
  proto: "montree-workspace";
  id: string;
  method: WorkspaceMethod | string;
  session: string;
  generation: string;
  params?: Record<string, unknown>;
}

export type WorkspaceResponse =
  | { proto: "montree-workspace"; id: string; ok: true; value: unknown }
  | { proto: "montree-workspace"; id: string; ok: false; error: AppError };

export interface WorkspaceEventFrame {
  proto: "montree-workspace";
  event: "watch" | "fatal";
  session: string;
  generation: string;
  payload: unknown;
}

export function isWorkspaceMethod(value: unknown): value is WorkspaceMethod {
  return typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9]*$/.test(value);
}

/** 请求 id 生成器（`ws-` 命名空间，与 ACP 消息 ID 隔离）。 */
export function createWorkspaceIdGenerator(prefix = "ws"): () => string {
  let counter = 0;
  return () => `${prefix}-${(counter += 1)}`;
}

export function encodeWorkspaceFrame(payload: unknown): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const out = new Uint8Array(WORKSPACE_FRAME_HEADER_BYTES + body.byteLength);
  new DataView(out.buffer).setUint32(0, body.byteLength, false);
  out.set(body, WORKSPACE_FRAME_HEADER_BYTES);
  return out;
}

export type WorkspaceFramePush =
  | { kind: "request"; request: WorkspaceRequest }
  | { kind: "response"; response: WorkspaceResponse }
  | { kind: "invalid"; id: string; error: AppError }
  | { kind: "event"; event: WorkspaceEventFrame };

export type WorkspaceFrameDecoded =
  | { kind: "frames"; frames: WorkspaceFramePush[]; rest: Uint8Array<ArrayBufferLike> }
  | { kind: "error"; error: AppError };

/**
 * 流式解码：处理分包/粘包；超限整帧直接丢弃并上报协议错误，
 * 避免一条恶意大帧撑爆内存。返回完整帧与剩余尾巴。
 */
export function decodeWorkspaceFrames(
  chunk: Uint8Array<ArrayBufferLike>,
  maxFrameBytes: number,
): WorkspaceFrameDecoded {
  const frames: WorkspaceFramePush[] = [];
  let offset = 0;
  while (chunk.byteLength - offset >= WORKSPACE_FRAME_HEADER_BYTES) {
    const length = new DataView(chunk.buffer, chunk.byteOffset + offset).getUint32(0, false);
    if (length > maxFrameBytes) {
      return {
        kind: "error",
        error: {
          code: "LIMIT_EXCEEDED",
          message: `协议帧 ${length} 字节超过上限 ${maxFrameBytes}`,
        },
      };
    }
    if (chunk.byteLength - offset - WORKSPACE_FRAME_HEADER_BYTES < length) break;
    const body = chunk.subarray(offset + WORKSPACE_FRAME_HEADER_BYTES, offset + WORKSPACE_FRAME_HEADER_BYTES + length);
    offset += WORKSPACE_FRAME_HEADER_BYTES + length;
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    } catch {
      return {
        kind: "error",
        error: { code: "PROTOCOL_ERROR", message: "协议帧不是合法 UTF-8 JSON" },
      };
    }
    const pushed = classifyWorkspaceFrame(parsed);
    if (pushed) frames.push(pushed);
  }
  return { kind: "frames", frames, rest: chunk.subarray(offset) };
}

function classifyWorkspaceFrame(parsed: unknown): WorkspaceFramePush | null {
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (record["proto"] !== "montree-workspace") return null;
  if (typeof record["event"] === "string") {
    return {
      kind: "event",
      event: parsed as WorkspaceEventFrame,
    };
  }
  if (typeof record["method"] === "string" && typeof record["id"] === "string") {
    const validated = validateWorkspaceRequest(parsed);
    if (validated.ok) return { kind: "request", request: validated.request };
    return { kind: "invalid", id: String(record["id"]).slice(0, 128), error: validated.error };
  }
  if (typeof record["id"] === "string" && "ok" in record) {
    return { kind: "response", response: parsed as WorkspaceResponse };
  }
  return null;
}

export function validateWorkspaceRequest(
  value: unknown,
): { ok: true; request: WorkspaceRequest } | { ok: false; error: AppError } {
  if (!value || typeof value !== "object") {
    return { ok: false, error: { code: "PROTOCOL_ERROR", message: "请求不是对象" } };
  }
  const record = value as Record<string, unknown>;
  if (record["proto"] !== "montree-workspace") {
    return { ok: false, error: { code: "PROTOCOL_ERROR", message: "未知协议标识" } };
  }
  if (typeof record["id"] !== "string" || record["id"].length === 0 || record["id"].length > 128) {
    return { ok: false, error: { code: "PROTOCOL_ERROR", message: "请求 id 非法" } };
  }
  if (typeof record["method"] !== "string" || !isWorkspaceMethod(record["method"])) {
    return { ok: false, error: { code: "PROTOCOL_ERROR", message: `未知请求方法` } };
  }
  if (typeof record["session"] !== "string" || record["session"].length === 0) {
    return { ok: false, error: { code: "PROTOCOL_ERROR", message: "缺少 workspace session" } };
  }
  if (typeof record["generation"] !== "string" || record["generation"].length === 0) {
    return { ok: false, error: { code: "PROTOCOL_ERROR", message: "缺少 generation" } };
  }
  if (record["params"] !== undefined && (typeof record["params"] !== "object" || record["params"] === null)) {
    return { ok: false, error: { code: "PROTOCOL_ERROR", message: "params 非法" } };
  }
  return { ok: true, request: value as WorkspaceRequest };
}

/**
 * 握手兼容判定：major 必须相等；server minor 不得低于 client；
 * buildId 仅记录不强制（目标目录按 buildId 存放，见服务分发）。
 */
export function checkHandshakeCompatible(
  handshake: WorkspaceServerHandshake,
  expectedMajor = WORKSPACE_PROTOCOL_MAJOR,
  expectedMinor = WORKSPACE_PROTOCOL_MINOR,
): { ok: true } | { ok: false; error: AppError } {
  if (handshake.protocolMajor !== expectedMajor) {
    return {
      ok: false,
      error: {
        code: "VERSION_MISMATCH",
        message: `协议主版本不兼容：远端 ${handshake.protocolMajor}，本机 ${expectedMajor}`,
      },
    };
  }
  if (handshake.protocolMinor < expectedMinor) {
    return {
      ok: false,
      error: {
        code: "VERSION_MISMATCH",
        message: `协议次版本过旧：远端 ${handshake.protocolMinor}，本机要求 ≥${expectedMinor}`,
      },
    };
  }
  return { ok: true };
}

/** Node 版本下限判定（比较主版本号）。 */
export function checkNodeVersionCompatible(nodeVersion: string, minMajor: number): boolean {
  const major = Number.parseInt(nodeVersion.replace(/^v/, "").split(".")[0] ?? "", 10);
  return Number.isInteger(major) && major >= minMajor;
}

/**
 * 脱敏日志字段：只保留连接/方法/耗时/错误码/字节量，
 * 永不记录 params、正文、密钥与完整文件内容。
 */
export function redactWorkspaceLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  const allow = new Set([
    "connection",
    "workspace",
    "build",
    "protocol",
    "method",
    "requestId",
    "durationMs",
    "code",
    "bytes",
    "eventSeq",
    "platform",
    "arch",
    "nodeVersion",
    "state",
  ]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (allow.has(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
      out[key] = value;
    }
  }
  return out;
}
