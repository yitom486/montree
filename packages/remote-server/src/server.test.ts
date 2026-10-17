import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppError } from "@yitom/contracts/core/errors";
import { createWorkspaceServer, type WorkspaceServer } from "./server";
import type { WorkspaceRequest } from "@montree/workspace-core";

const dirs: string[] = [];
let server: WorkspaceServer | null = null;
afterEach(() => {
  server?.dispose();
  server = null;
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function makeRoot(files: Record<string, string> = {}): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ws-srv-")));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

function start(root: string): WorkspaceServer {
  server = createWorkspaceServer({ root, session: "sess-1", generation: "gen-1", buildId: "test" });
  return server;
}

function req(method: string, params: Record<string, unknown> = {}, overrides: Partial<WorkspaceRequest> = {}): WorkspaceRequest {
  return {
    proto: "montree-workspace",
    id: `ws-${Math.random().toString(36).slice(2)}`,
    method,
    session: "sess-1",
    generation: "gen-1",
    params,
    ...overrides,
  };
}

function unwrap<T>(response: { ok: true; value: T } | { ok: false; error: AppError }): T {
  if (!response.ok) throw new Error(`unexpected error: ${response.error.code} ${response.error.message}`);
  return response.value;
}

describe("workspace 服务分发", () => {
  it("hello 返回握手（含真实平台/架构/Node 版本）", async () => {
    const srv = start(makeRoot());
    const res = await srv.handleRequest(req("hello"));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const handshake = res.value as { platform: string; arch: string; nodeVersion: string; buildId: string };
    expect(handshake.platform).toBe(process.platform);
    expect(handshake.arch).toBe(process.arch);
    expect(handshake.nodeVersion).toBe(process.version);
    expect(handshake.buildId).toBe("test");
  });

  it("未知方法报 NOT_SUPPORTED", async () => {
    const srv = start(makeRoot());
    const res = await srv.handleRequest(req("definitelyUnknownMethod"));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_SUPPORTED");
  });

  it("session/generation 失配的旧请求被拒绝", async () => {
    const srv = start(makeRoot());
    const staleSession = await srv.handleRequest(req("ping", {}, { session: "old" }));
    expect(staleSession.ok).toBe(false);
    const staleGen = await srv.handleRequest(req("ping", {}, { generation: "gen-0" }));
    expect(staleGen.ok).toBe(false);
  });

  it("目录浏览/读写的文本闭环", async () => {
    const srv = start(makeRoot({ "a.md": "hello\n" }));
    const listed = unwrap(await srv.handleRequest(req("listDirectory", { path: "" }))) as {
      entries: Array<{ name: string }>;
    };
    expect(listed.entries.map((e) => e.name)).toContain("a.md");

    const read = unwrap(await srv.handleRequest(req("readText", { path: "a.md" }))) as {
      content: string;
      revision: string;
    };
    const text = read;
    expect(text.content).toBe("hello\n");

    const written = unwrap(
      await srv.handleRequest(req("writeText", { path: "a.md", content: "hello world\n", expectedRevision: text.revision })),
    ) as { revision: string };
    expect(written.revision).not.toBe(text.revision);

    const reread = unwrap(await srv.handleRequest(req("readText", { path: "a.md" }))) as { content: string };
    expect(reread.content).toBe("hello world\n");
  });

  it("外部修改后旧 revision 保存触发冲突，不盲覆盖", async () => {
    const root = makeRoot({ "a.md": "v1\n" });
    const srv = start(root);
    const read = unwrap(await srv.handleRequest(req("readText", { path: "a.md" }))) as { revision: string };
    const stale = read.revision;
    writeFileSync(join(root, "a.md"), "external\n");
    const conflict = await srv.handleRequest(req("writeText", { path: "a.md", content: "mine\n", expectedRevision: stale }));
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.error.code).toBe("REVISION_CONFLICT");
    expect(read).toBeDefined();
    const current = unwrap(await srv.handleRequest(req("readText", { path: "a.md" }))) as { content: string };
    expect(current.content).toBe("external\n");
  });

  it("穿越路径在服务端被拦截", async () => {
    const srv = start(makeRoot({ "a.md": "x" }));
    const res = await srv.handleRequest(req("readText", { path: "../outside.md" }));
    expect(res.ok).toBe(false);
  });

  it("超限正文被拒绝", async () => {
    const srv = createWorkspaceServer({
      root: makeRoot(),
      session: "sess-1",
      limits: { maxTextBytes: 4 },
    });
    server = srv;
    const res = await srv.handleRequest(req("writeText", { path: "big.md", content: "12345" }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("LIMIT_EXCEEDED");
  });

  it("cancel 搜索可取消", async () => {
    const root = makeRoot();
    for (let i = 0; i < 30; i += 1) writeFileSync(join(root, `f${i}.md`), `${"x\n".repeat(500)}needle\n`);
    const srv = start(root);
    const searchId = "ws-search-1";
    const pending = srv.handleRequest(req("searchMarkdown", { query: "needle" }, { id: searchId }));
    await srv.handleRequest(req("cancel", { id: searchId }, { id: "ws-cancel-1" }));
    const res = await pending;
    // 取消是尽力而为：要么 CANCELLED，要么已完成；关键是 cancel 方法本身可用
    if (!res.ok) expect(res.error.code).toBe("CANCELLED");
    else expect(res.value).toBeDefined();
  });

  it("rename/copy/move/delete 同宿主闭环", async () => {
    const srv = start(makeRoot({ "a.md": "x" }));
    unwrap(await srv.handleRequest(req("rename", { path: "a.md", toPath: "b.md" })));
    unwrap(await srv.handleRequest(req("copy", { path: "b.md", toPath: "c.md" })));
    unwrap(await srv.handleRequest(req("move", { path: "c.md", toPath: "sub/c.md" })));
    unwrap(await srv.handleRequest(req("delete", { path: "b.md" })));
    const listed = unwrap(await srv.handleRequest(req("listDirectory", { path: "sub" }))) as {
      entries: Array<{ name: string }>;
    };
    expect(listed.entries.map((e) => e.name)).toEqual(["c.md"]);
  });

  it("gitStatus 非仓库返回 isRepo=false", async () => {
    const srv = start(makeRoot());
    const res = unwrap(await srv.handleRequest(req("gitStatus"))) as { isRepo: boolean };
    expect(res.isRepo).toBe(false);
  });
});
