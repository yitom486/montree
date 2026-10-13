import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { confineWorkspacePath, realpathForMaybeMissing, resolveRootReal } from "./root-guard";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function makeRoot(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ws-root-")));
  dirs.push(dir);
  return dir;
}

describe("服务端根归属", () => {
  it("根内相对路径放行，不存在路径也能判定归属", () => {
    const root = resolveRootReal(makeRoot());
    const confined = confineWorkspacePath(root, "notes/a.md");
    expect(confined.ok).toBe(true);
    if (confined.ok) expect(confined.abs).toBe(join(root, "notes", "a.md"));
  });

  it(".. 穿越、绝对路径、盘符一律拒绝", () => {
    const root = resolveRootReal(makeRoot());
    expect(confineWorkspacePath(root, "../outside").ok).toBe(false);
    expect(confineWorkspacePath(root, "a/../../b").ok).toBe(false);
    expect(confineWorkspacePath(root, "/etc/passwd").ok).toBe(false);
    expect(confineWorkspacePath(root, "C:/notes").ok).toBe(false);
  });

  it("根内 symlink 指向根外被识别为逃逸", () => {
    const root = makeRoot();
    const outside = makeRoot();
    writeFileSync(join(outside, "secret.txt"), "secret");
    try {
      symlinkSync(outside, join(root, "link"), "dir");
    } catch {
      // Windows 无权限建链接时跳过（CI 以 Linux 为准）
      return;
    }
    const rootReal = resolveRootReal(root);
    const confined = confineWorkspacePath(rootReal, "link/secret.txt");
    expect(confined.ok).toBe(false);
  });

  it("最近存在祖先还原对深层不存在路径有效", () => {
    const root = resolveRootReal(makeRoot());
    mkdirSync(join(root, "a"));
    expect(realpathForMaybeMissing(join(root, "a", "b", "c"))).toBe(join(root, "a", "b", "c"));
  });
});
