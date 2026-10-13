import { describe, expect, it } from "vitest";
import { joinWorkspaceRelPath, normalizeWorkspaceRelPath } from "./paths";
import {
  formatWorkspaceRevision,
  isSameWorkspaceRevision,
  parseWorkspaceRevision,
} from "./revision";

describe("工作区相对路径", () => {
  it("空串表根并归一化多余斜杠", () => {
    expect(normalizeWorkspaceRelPath("")).toEqual({ ok: true, path: "" });
    expect(normalizeWorkspaceRelPath("./notes//a.md")).toEqual({ ok: true, path: "notes/a.md" });
  });

  it("拒绝绝对路径、盘符、反斜杠穿越与 ..", () => {
    expect(normalizeWorkspaceRelPath("/etc/passwd").ok).toBe(false);
    expect(normalizeWorkspaceRelPath("C:/notes").ok).toBe(false);
    expect(normalizeWorkspaceRelPath("../outside").ok).toBe(false);
    expect(normalizeWorkspaceRelPath("a/../../b").ok).toBe(false);
    expect(normalizeWorkspaceRelPath("a\0b").ok).toBe(false);
  });

  it("join 拼接展示子路径", () => {
    expect(joinWorkspaceRelPath("", "a.md")).toBe("a.md");
    expect(joinWorkspaceRelPath("notes", "a.md")).toBe("notes/a.md");
  });
});

describe("revision token", () => {
  it("拼装/解析往返一致", () => {
    const revision = formatWorkspaceRevision({ size: 12, mtimeMs: 34, hash: "ab12" });
    expect(parseWorkspaceRevision(revision)).toEqual({
      ok: true,
      parts: { size: 12, mtimeMs: 34, hash: "ab12" },
    });
  });

  it("全等才算同一版本，非法格式视为不一致", () => {
    expect(isSameWorkspaceRevision("1:2:ab", "1:2:ab")).toBe(true);
    expect(isSameWorkspaceRevision("1:2:ab", "1:2:ac")).toBe(false);
    expect(isSameWorkspaceRevision("garbage", "garbage")).toBe(false);
  });
});
