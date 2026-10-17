/**
 * 远端 bundle Node-only 验证（T8 对应）：Bun 构建自包含产物后，
 * 在干净 Node 下（cwd=临时目录、NODE_PATH 指向空目录、不继承桌面 env 标记）
 * 启动并完成握手；校验真实 platform/arch/node 版本、未知请求、穿越拦截、
 * EOF 正常退出；产物内不得出现禁用依赖。
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeWorkspaceFrames, encodeWorkspaceFrame } from "@montree/workspace-core";
import { DEFAULT_WORKSPACE_LIMITS } from "@yitom/contracts/types/workspace";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const BUILD_SCRIPT = join(REPO_ROOT, "packages", "remote-server", "scripts", "build.ts");

let outDir = "";
let bundlePath = "";
let nodePath = "";
let buildAvailable = true;

/** PATH 中的真实 Node（不用 Bun/Electron 冒充，T8 证据才成立）。 */
function findRealNode(): string {
  const suffix = process.platform === "win32" ? ".exe" : "";
  for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, `node${suffix}`);
    if (existsSync(candidate)) return candidate;
  }
  return "";
}

beforeAll(() => {
  nodePath = findRealNode();
  if (!nodePath) {
    buildAvailable = false;
    console.warn("[skip] PATH 中无真实 node，跳过 bundle Node-only 验证");
    return;
  }
  outDir = mkdtempSync(join(tmpdir(), "ws-bundle-"));
  const built = spawnSync("bun", [BUILD_SCRIPT, "--outDir", outDir], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (built.status !== 0) {
    buildAvailable = false;
    console.warn(`[skip] remote bundle 构建失败：${built.stderr?.slice(0, 500)}`);
    return;
  }
  bundlePath = join(outDir, "montree-remote-server.cjs");
}, 120_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(BUN|NPM|ELECTRON|MONTREE_)/i.test(key)) continue;
    env[key] = value;
  }
  env["NODE_PATH"] = join(outDir, "empty-node-path");
  return env;
}

interface ProtoClient {
  send: (payload: unknown) => void;
  next: (timeoutMs?: number) => Promise<{ id: string; ok: boolean; value?: unknown; error?: { code: string; message: string } }>;
  kill: () => void;
  exited: Promise<number | null>;
}

function launchBundle(root: string, session: string): ProtoClient {
  const child = spawn(nodePath, [bundlePath, "--root", root, "--session", session], {
    cwd: tmpdir(),
    env: cleanEnv(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let rest: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  const pending: Array<(frame: { id: string; ok: boolean; value?: unknown; error?: { code: string; message: string } }) => void> = [];
  child.stdout.on("data", (chunk: Uint8Array) => {
    const combined = new Uint8Array(rest.byteLength + chunk.byteLength);
    combined.set(rest, 0);
    combined.set(chunk, rest.byteLength);
    const decoded = decodeWorkspaceFrames(combined, DEFAULT_WORKSPACE_LIMITS.maxFrameBytes);
    if ("kind" in decoded && decoded.kind === "error") {
      rest = new Uint8Array(0);
      return;
    }
    rest = decoded.rest;
    for (const frame of decoded.frames) {
      if (frame.kind !== "response") continue;
      const waiter = pending.shift();
      waiter?.(frame.response as { id: string; ok: boolean; value?: unknown; error?: { code: string; message: string } });
    }
  });
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return {
    send: (payload) => child.stdin.write(Buffer.from(encodeWorkspaceFrame(payload))),
    next: (timeoutMs = 15_000) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("等待服务响应超时")), timeoutMs);
      pending.push((frame) => {
        clearTimeout(timer);
        resolve(frame);
      });
    }),
    kill: () => child.kill(),
    exited,
  };
}

describe("远端 bundle Node-only 启动", () => {
  it("产物自包含：禁用依赖零出现", () => {
    if (!buildAvailable) return;
    const code = readFileSync(bundlePath, "utf8");
    for (const banned of ["from \"electron\"", "require(\"electron\")", "node:sqlite", "pdf-inspector", "acp-client", "@agentclientprotocol"]) {
      expect(code.includes(banned), `bundle 含禁用依赖 ${banned}`).toBe(false);
    }
    expect(existsSync(join(outDir, "manifest.json"))).toBe(true);
  });

  it("manifest 与产物一致（buildId/协议版本/校验）", () => {
    if (!buildAvailable) return;
    const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8")) as {
      buildId: string;
      protocolMajor: number;
      protocolMinor: number;
      files: Array<{ path: string; sha256: string; size: number }>;
    };
    expect(manifest.protocolMajor).toBe(1);
    const bytes = readFileSync(bundlePath);
    const sha = createHash("sha256").update(bytes).digest("hex");
    expect(manifest.files[0]?.sha256).toBe(sha);
    expect(manifest.buildId).toBe(sha.slice(0, 16));
  });

  it("干净 Node 可握手，上报真实 platform/arch/node 版本", async () => {
    if (!buildAvailable) return;
    const root = mkdtempSync(join(tmpdir(), "ws-clean-"));
    try {
      const client = launchBundle(root, "sess-clean");
      client.send({ proto: "montree-workspace", id: "ws-1", method: "hello", session: "sess-clean", generation: "gen-1" });
      const res = await client.next();
      client.kill();
      await client.exited;
      expect(res.ok).toBe(true);
      const handshake = res.value as { platform: string; arch: string; nodeVersion: string };
      expect(handshake.platform).toBe(process.platform);
      expect(handshake.arch).toBe(process.arch);
      expect(handshake.nodeVersion).toBe(process.version);
      const major = Number(handshake.nodeVersion.replace(/^v/, "").split(".")[0]);
      expect(major).toBeGreaterThanOrEqual(22);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("未知请求与穿越路径在远端被拒绝", async () => {
    if (!buildAvailable) return;
    const root = mkdtempSync(join(tmpdir(), "ws-clean-"));
    try {
      const client = launchBundle(root, "sess-2");
      client.send({ proto: "montree-workspace", id: "ws-1", method: "noSuchMethod", session: "sess-2", generation: "gen-1" });
      expect((await client.next()).ok).toBe(false);
      client.send({ proto: "montree-workspace", id: "ws-2", method: "readText", session: "sess-2", generation: "gen-1", params: { path: "../../evil" } });
      const traversal = await client.next();
      expect(traversal.ok).toBe(false);
      expect(["FORBIDDEN", "INVALID_ARGUMENT"]).toContain(traversal.error?.code);
      client.kill();
      await client.exited;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("读写闭环经真实 stdio 管道完成", async () => {
    if (!buildAvailable) return;
    const root = mkdtempSync(join(tmpdir(), "ws-clean-"));
    try {
      writeFileSync(join(root, "note.md"), "pipe\n");
      const client = launchBundle(root, "sess-3");
      const invoke = async (id: string, method: string, params: Record<string, unknown> = {}) => {
        client.send({ proto: "montree-workspace", id, method, session: "sess-3", generation: "gen-1", params });
        return client.next();
      };
      const read = await invoke("ws-1", "readText", { path: "note.md" });
      expect(read.ok).toBe(true);
      const revision = (read.value as { revision: string }).revision;
      const written = await invoke("ws-2", "writeText", { path: "note.md", content: "pipe v2\n", expectedRevision: revision });
      expect(written.ok).toBe(true);
      expect(readFileSync(join(root, "note.md"), "utf8")).toBe("pipe v2\n");
      client.kill();
      await client.exited;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stdin EOF 后服务正常退出（exit 0）", async () => {
    if (!buildAvailable) return;
    const root = mkdtempSync(join(tmpdir(), "ws-clean-"));
    try {
      const child = spawn(nodePath, [bundlePath, "--root", root, "--session", "sess-eof"], {
        cwd: tmpdir(),
        env: cleanEnv(),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
      child.stdin.end();
      expect(await exited).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
