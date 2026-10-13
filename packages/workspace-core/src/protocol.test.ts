import { describe, expect, it } from "vitest";
import {
  checkHandshakeCompatible,
  checkNodeVersionCompatible,
  createWorkspaceIdGenerator,
  decodeWorkspaceFrames,
  encodeWorkspaceFrame,
  redactWorkspaceLogFields,
  validateWorkspaceRequest,
  type WorkspaceResponse,
} from "./protocol";
import { DEFAULT_WORKSPACE_LIMITS } from "@montree/contracts/types/workspace";

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    proto: "montree-workspace",
    id: "ws-1",
    method: "ping",
    session: "session-1",
    generation: "gen-1",
    params: {},
    ...overrides,
  };
}

describe("workspace 协议分帧", () => {
  it("分包到达可拼出完整帧", () => {
    const frame = encodeWorkspaceFrame(baseRequest());
    const head = frame.subarray(0, 5);
    const tail = frame.subarray(5);
    const first = decodeWorkspaceFrames(head, DEFAULT_WORKSPACE_LIMITS.maxFrameBytes);
    if ("kind" in first && first.kind === "error") throw new Error("unexpected error");
    expect(first.frames).toHaveLength(0);
    const combined = new Uint8Array([...first.rest, ...tail]);
    const second = decodeWorkspaceFrames(combined, DEFAULT_WORKSPACE_LIMITS.maxFrameBytes);
    if ("kind" in second && second.kind === "error") throw new Error("unexpected error");
    expect(second.frames).toHaveLength(1);
    expect(second.rest.byteLength).toBe(0);
  });

  it("粘包一次解出多帧", () => {
    const a = encodeWorkspaceFrame(baseRequest({ id: "ws-1" }));
    const b = encodeWorkspaceFrame(baseRequest({ id: "ws-2" }));
    const combined = new Uint8Array([...a, ...b]);
    const decoded = decodeWorkspaceFrames(combined, DEFAULT_WORKSPACE_LIMITS.maxFrameBytes);
    if ("kind" in decoded && decoded.kind === "error") throw new Error("unexpected error");
    expect(decoded.frames).toHaveLength(2);
  });

  it("含 UTF-8 多字节正文的帧按字节长度解析", () => {
    const response: WorkspaceResponse = {
      proto: "montree-workspace",
      id: "ws-9",
      ok: true,
      value: { content: "中文测试 🎉" },
    };
    const frame = encodeWorkspaceFrame(response);
    const decoded = decodeWorkspaceFrames(frame, DEFAULT_WORKSPACE_LIMITS.maxFrameBytes);
    if ("kind" in decoded && decoded.kind === "error") throw new Error("unexpected error");
    expect(decoded.frames[0]).toMatchObject({ kind: "response" });
  });

  it("超限帧被拒绝且不撑内存", () => {
    const frame = encodeWorkspaceFrame(baseRequest());
    const decoded = decodeWorkspaceFrames(frame, 8);
    expect(decoded).toMatchObject({ kind: "error" });
  });

  it("异常 JSON 与非协议帧被丢弃或报错", () => {
    const garbage = new Uint8Array([0, 0, 0, 3, 0xff, 0xfe, 0x00]);
    const decoded = decodeWorkspaceFrames(garbage, DEFAULT_WORKSPACE_LIMITS.maxFrameBytes);
    expect(decoded).toMatchObject({ kind: "error" });
    const foreign = encodeWorkspaceFrame({ hello: "other-protocol" });
    const foreignDecoded = decodeWorkspaceFrames(foreign, DEFAULT_WORKSPACE_LIMITS.maxFrameBytes);
    if ("kind" in foreignDecoded && foreignDecoded.kind === "error") throw new Error("unexpected error");
    expect(foreignDecoded.frames).toHaveLength(0);
  });
});

describe("请求校验与握手", () => {
  it("合法请求通过校验", () => {
    expect(validateWorkspaceRequest(baseRequest()).ok).toBe(true);
  });

  it("未知方法与缺字段被拒绝", () => {
    expect(validateWorkspaceRequest(baseRequest({ method: "" })).ok).toBe(false);
    expect(validateWorkspaceRequest(baseRequest({ session: "" })).ok).toBe(false);
    expect(validateWorkspaceRequest(baseRequest({ generation: "" })).ok).toBe(false);
    expect(validateWorkspaceRequest({ proto: "other" }).ok).toBe(false);
  });

  it("major 必须相等，minor 只许高不许低", () => {
    const handshake: {
      protocolMajor: number;
      protocolMinor: number;
      buildId: string;
      nodeVersion: string;
      platform: string;
      arch: string;
      capabilities: string[];
      limits: typeof DEFAULT_WORKSPACE_LIMITS;
    } = {
      protocolMajor: 1,
      protocolMinor: 0,
      buildId: "test",
      nodeVersion: "v22.0.0",
      platform: "linux",
      arch: "x64",
      capabilities: [],
      limits: DEFAULT_WORKSPACE_LIMITS,
    };
    expect(checkHandshakeCompatible({ ...handshake }).ok).toBe(true);
    expect(checkHandshakeCompatible({ ...handshake, protocolMajor: 2 }).ok).toBe(false);
    expect(checkHandshakeCompatible({ ...handshake, protocolMinor: 5 }).ok).toBe(true);
  });

  it("Node 主版本下限判定", () => {
    expect(checkNodeVersionCompatible("v22.1.0", 22)).toBe(true);
    expect(checkNodeVersionCompatible("v20.0.0", 22)).toBe(false);
    expect(checkNodeVersionCompatible("v24.18.0", 22)).toBe(true);
  });

  it("请求 id 使用 ws- 命名空间", () => {
    const next = createWorkspaceIdGenerator();
    expect(next()).toBe("ws-1");
    expect(next()).toBe("ws-2");
  });

  it("脱敏只保留允许字段", () => {
    const redacted = redactWorkspaceLogFields({
      method: "readText",
      durationMs: 12,
      code: "UNKNOWN",
      content: "正文必须被去掉",
      token: "密钥必须被去掉",
    });
    expect(redacted).toEqual({ method: "readText", durationMs: 12, code: "UNKNOWN" });
  });
});
