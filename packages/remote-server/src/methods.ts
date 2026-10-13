/**
 * workspace 协议方法实现（Node-only，有 fs/child_process）。
 * 全部入口先过 confineWorkspacePath；写操作同文件串行 + 临时文件原子替换；
 * 搜索沿用本机 workspace-md-search 语义（字面/小写匹配、忽略目录、200/256KB/100 上限）。
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, sep } from "node:path";
import type { AppError } from "@montree/contracts/core/errors";
import type { GitCommitOptions, GitPushOptions } from "@montree/contracts/types/git";
import type { Result } from "@montree/contracts/core/result";
import { err, ok } from "@montree/contracts/core/result";
import type {
  WorkspaceEntry,
  WorkspaceLimits,
  WorkspaceListDirectoryResult,
  WorkspaceReadTextResult,
  WorkspaceRelativePathResult,
  WorkspaceResourceResult,
  WorkspaceSearchResult,
  WorkspaceStatResult,
  WorkspaceWriteTextResult,
} from "@montree/contracts/types/workspace";
import { formatWorkspaceRevision, joinWorkspaceRelPath } from "@montree/workspace-core";
import { confineWorkspacePath } from "./root-guard";

export interface FsMethodEnv {
  rootReal: string;
  limits: WorkspaceLimits;
  signal?: AbortSignal;
  /** 服务端持有的同文件串行写链（按相对路径）。 */
  writeChains: Map<string, Promise<unknown>>;
}

function toAppError(error: unknown, fallback: AppError["code"], fallbackMessage: string): AppError {
  // 原生 fs 错误自带 code + message（如 ENOENT），必须先按 errno 归一化，
  // 否则裸系统码直接透传给客户端（stat 缺失文件曾漏出裸 ENOENT）。
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") return { code: "FILE_NOT_FOUND", message: fallbackMessage };
  if (code === "EACCES" || code === "EPERM") return { code: "FORBIDDEN", message: fallbackMessage };
  if (code === "EEXIST") return { code: "INVALID_STATE", message: fallbackMessage };
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    return error as AppError;
  }
  return { code: fallback, message: error instanceof Error ? error.message : fallbackMessage };
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw { code: "CANCELLED", message: "请求已取消" } satisfies AppError;
  }
}

function strParam(params: Record<string, unknown>, name: string, required: boolean): string | undefined {
  const value = params[name];
  if (value === undefined) {
    if (required) throw { code: "INVALID_ARGUMENT", message: `缺少参数 ${name}` } satisfies AppError;
    return undefined;
  }
  if (typeof value !== "string") {
    throw { code: "INVALID_ARGUMENT", message: `参数 ${name} 非法` } satisfies AppError;
  }
  return value;
}

function toPosixRel(rootReal: string, abs: string): string {
  return relative(rootReal, abs).split(sep).join("/");
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

export function revisionForBytes(bytes: Uint8Array, mtimeMs: number): string {
  return formatWorkspaceRevision({ size: bytes.byteLength, mtimeMs: Math.floor(mtimeMs), hash: hashBytes(bytes) });
}

async function entryForAbs(rootReal: string, abs: string, name: string): Promise<WorkspaceEntry> {
  const st = await stat(abs);
  return {
    name,
    isDirectory: st.isDirectory(),
    size: st.isDirectory() ? undefined : st.size,
    mtimeMs: Math.floor(st.mtimeMs),
  };
}

export async function listDirectory(
  env: FsMethodEnv,
  params: Record<string, unknown>,
): Promise<Result<WorkspaceListDirectoryResult, AppError>> {
  try {
    throwIfCancelled(env.signal);
    const confined = confineWorkspacePath(env.rootReal, strParam(params, "path", false) ?? "");
    if (!confined.ok) return confined;
    const dirents = await readdir(confined.abs, { withFileTypes: true });
    const entries: WorkspaceEntry[] = [];
    for (const dirent of dirents) {
      throwIfCancelled(env.signal);
      // symlink 不跟随：链接本身按类型展示，避免循环与逃逸
      if (dirent.isSymbolicLink()) {
        entries.push({ name: dirent.name, isDirectory: false });
        continue;
      }
      try {
        entries.push(await entryForAbs(env.rootReal, join(confined.abs, dirent.name), dirent.name));
      } catch {
        continue;
      }
    }
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return ok({ dirPath: confined.rel, entries });
  } catch (error) {
    return err(toAppError(error, "WORKSPACE_ERROR", "列目录失败"));
  }
}

export async function statPath(
  env: FsMethodEnv,
  params: Record<string, unknown>,
): Promise<Result<WorkspaceStatResult, AppError>> {
  try {
    throwIfCancelled(env.signal);
    const confined = confineWorkspacePath(env.rootReal, strParam(params, "path", true) ?? "");
    if (!confined.ok) return confined;
    const st = await stat(confined.abs);
    const name = confined.rel.split("/").pop() ?? confined.rel;
    if (st.isDirectory()) {
      return ok({
        name,
        isDirectory: true,
        size: 0,
        mtimeMs: Math.floor(st.mtimeMs),
        path: confined.rel,
        revision: formatWorkspaceRevision({ size: 0, mtimeMs: Math.floor(st.mtimeMs), hash: "0" }),
      });
    }
    if (st.size > env.limits.maxTextBytes) {
      return err({ code: "LIMIT_EXCEEDED", message: `文件 ${st.size} 字节超过正文上限` });
    }
    const bytes = await readFile(confined.abs);
    return ok({
      name,
      isDirectory: false,
      size: st.size,
      mtimeMs: Math.floor(st.mtimeMs),
      path: confined.rel,
      revision: revisionForBytes(bytes, st.mtimeMs),
    });
  } catch (error) {
    return err(toAppError(error, "WORKSPACE_ERROR", "取文件信息失败"));
  }
}

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const UTF16LE_BOM = [0xff, 0xfe];

export async function readText(
  env: FsMethodEnv,
  params: Record<string, unknown>,
): Promise<Result<WorkspaceReadTextResult, AppError>> {
  try {
    throwIfCancelled(env.signal);
    const confined = confineWorkspacePath(env.rootReal, strParam(params, "path", true) ?? "");
    if (!confined.ok) return confined;
    const st = await stat(confined.abs);
    if (st.isDirectory()) return err({ code: "INVALID_ARGUMENT", message: "不支持读取目录正文" });
    if (st.size > env.limits.maxTextBytes) {
      return err({ code: "LIMIT_EXCEEDED", message: `文件 ${st.size} 字节超过正文上限 ${env.limits.maxTextBytes}` });
    }
    const raw = await readFile(confined.abs);
    let encoding: "utf8" | "utf16le" = "utf8";
    let hasBom = false;
    let body: Uint8Array = raw;
    if (raw.length >= 3 && raw[0] === UTF8_BOM[0] && raw[1] === UTF8_BOM[1] && raw[2] === UTF8_BOM[2]) {
      hasBom = true;
      body = raw.subarray(3);
    } else if (raw.length >= 2 && raw[0] === UTF16LE_BOM[0] && raw[1] === UTF16LE_BOM[1]) {
      encoding = "utf16le";
      hasBom = true;
      body = raw.subarray(2);
    }
    const content = new TextDecoder(encoding, { fatal: false }).decode(body);
    const newline = content.includes("\r\n") ? "crlf" : "lf";
    return ok({ content, encoding, newline, hasBom, revision: revisionForBytes(raw, st.mtimeMs) });
  } catch (error) {
    return err(toAppError(error, "FILE_READ_ERROR", "读取文本失败"));
  }
}

function encodeTextBody(
  content: string,
  encoding: "utf8" | "utf16le",
  newline: "lf" | "crlf",
  hasBom: boolean,
): Uint8Array {
  const normalized = content.replace(/\r\n/g, "\n");
  const joined = newline === "crlf" ? normalized.replace(/\n/g, "\r\n") : normalized;
  const encoder = new TextEncoder();
  if (encoding === "utf16le") {
    const out = new Uint16Array(joined.length + (hasBom ? 1 : 0));
    let offset = 0;
    if (hasBom) {
      out[0] = 0xfeff;
      offset = 1;
    }
    for (let i = 0; i < joined.length; i += 1) out[offset + i] = joined.charCodeAt(i) ?? 0;
    return new Uint8Array(out.buffer);
  }
  const bytes = encoder.encode(joined);
  if (!hasBom) return bytes;
  const out = new Uint8Array(bytes.length + 3);
  out.set([0xef, 0xbb, 0xbf], 0);
  out.set(bytes, 3);
  return out;
}

/**
 * 串行安全写：同文件请求排队；携带 expectedRevision 时先核对当前版本，
 * 外部变化一律报 REVISION_CONFLICT，不盲覆盖；临时文件同目录 + rename。
 */
export async function writeText(
  env: FsMethodEnv,
  params: Record<string, unknown>,
): Promise<Result<WorkspaceWriteTextResult, AppError>> {
  const confined = confineWorkspacePath(env.rootReal, strParam(params, "path", true) ?? "");
  if (!confined.ok) return confined;
  const content = strParam(params, "content", true);
  if (content === undefined) return err({ code: "INVALID_ARGUMENT", message: "缺少参数 content" });
  const expectedRevision = strParam(params, "expectedRevision", false);
  const tail = env.writeChains.get(confined.rel) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = tail.then(() => gate);
  env.writeChains.set(confined.rel, chained);
  await tail;
  try {
    throwIfCancelled(env.signal);
    const encoder = new TextEncoder();
    if (encoder.encode(content).byteLength > env.limits.maxTextBytes) {
      return err({ code: "LIMIT_EXCEEDED", message: `正文超过上限 ${env.limits.maxTextBytes}` });
    }
    let encoding: "utf8" | "utf16le" = "utf8";
    let newline: "lf" | "crlf" = "lf";
    let hasBom = false;
    let mode: number | undefined;
    try {
      const st = await stat(confined.abs);
      if (st.isDirectory()) return err({ code: "INVALID_ARGUMENT", message: "不支持覆盖目录" });
      mode = st.mode;
      if (expectedRevision !== undefined) {
        const current = await readFile(confined.abs);
        const currentRevision = revisionForBytes(current, st.mtimeMs);
        if (currentRevision !== expectedRevision) {
          return err({ code: "REVISION_CONFLICT", message: `远端已有外部修改（当前版本 ${currentRevision}）` });
        }
      }
      const sniff = await readFile(confined.abs);
      if (sniff.length >= 2 && sniff[0] === 0xff && sniff[1] === 0xfe) encoding = "utf16le";
      else if (!(sniff.length >= 3 && sniff[0] === 0xef && sniff[1] === 0xbb && sniff[2] === 0xbf)) {
        const decoded = new TextDecoder("utf-8", { fatal: false }).decode(sniff);
        if (decoded.includes("\r\n")) newline = "crlf";
      } else {
        hasBom = true;
        const decoded = new TextDecoder("utf-8", { fatal: false }).decode(sniff.subarray(3));
        if (decoded.includes("\r\n")) newline = "crlf";
      }
      if (encoding === "utf16le") hasBom = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        return err(toAppError(error, "FILE_READ_ERROR", "保存前版本核对失败"));
      }
    }
    const paramEncoding = strParam(params, "encoding", false);
    if (paramEncoding === "utf8" || paramEncoding === "utf16le") encoding = paramEncoding;
    const paramNewline = strParam(params, "newline", false);
    if (paramNewline === "lf" || paramNewline === "crlf") newline = paramNewline;
    const body = encodeTextBody(content, encoding, newline, hasBom);
    await mkdir(dirname(confined.abs), { recursive: true });
    const tmp = `${confined.abs}.montree-tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
    try {
      await writeFile(tmp, body, { mode });
      await rename(tmp, confined.abs);
    } finally {
      await rm(tmp, { force: true });
    }
    const st = await stat(confined.abs);
    const finalBytes = await readFile(confined.abs);
    return ok({ revision: revisionForBytes(finalBytes, st.mtimeMs) });
  } catch (error) {
    return err(toAppError(error, "FILE_WRITE_ERROR", "保存文本失败"));
  } finally {
    release();
    if (env.writeChains.get(confined.rel) === chained) env.writeChains.delete(confined.rel);
  }
}

async function mutateFs(
  env: FsMethodEnv,
  params: Record<string, unknown>,
  action: (from: { rel: string; abs: string }, to?: { rel: string; abs: string }) => Promise<void>,
  needTarget: boolean,
): Promise<Result<WorkspaceRelativePathResult, AppError>> {
  try {
    throwIfCancelled(env.signal);
    const from = confineWorkspacePath(env.rootReal, strParam(params, "path", true) ?? "");
    if (!from.ok) return from;
    let to: { rel: string; abs: string } | undefined;
    if (needTarget) {
      const targetRaw = strParam(params, "toPath", true);
      if (targetRaw === undefined) return err({ code: "INVALID_ARGUMENT", message: "缺少参数 toPath" });
      const confinedTo = confineWorkspacePath(env.rootReal, targetRaw);
      if (!confinedTo.ok) return confinedTo;
      to = confinedTo;
    }
    await action({ rel: from.rel, abs: from.abs }, to);
    return ok({ path: to?.rel ?? from.rel });
  } catch (error) {
    return err(toAppError(error, "WORKSPACE_ERROR", "文件操作失败"));
  }
}

export function mkdirDir(env: FsMethodEnv, params: Record<string, unknown>) {
  return mutateFs(env, params, async (from) => {
    await mkdir(from.abs, { recursive: true });
  }, false);
}

export function createFile(env: FsMethodEnv, params: Record<string, unknown>) {
  return mutateFs(env, params, async (from) => {
    const content = typeof params["content"] === "string" ? params["content"] : "";
    if (new TextEncoder().encode(content).byteLength > env.limits.maxTextBytes) {
      throw { code: "LIMIT_EXCEEDED", message: "正文超过上限" } satisfies AppError;
    }
    await mkdir(dirname(from.abs), { recursive: true });
    const handle = await open(from.abs, "wx");
    try {
      await handle.writeFile(content, "utf8");
    } finally {
      await handle.close();
    }
  }, false);
}

export function renamePath(env: FsMethodEnv, params: Record<string, unknown>) {
  return mutateFs(env, params, async (from, to) => {
    if (!to) throw { code: "INVALID_ARGUMENT", message: "缺少参数 toPath" } satisfies AppError;
    await mkdir(dirname(to.abs), { recursive: true });
    await rename(from.abs, to.abs);
  }, true);
}

export function deletePath(env: FsMethodEnv, params: Record<string, unknown>) {
  return mutateFs(env, params, async (from) => {
    await rm(from.abs, { recursive: true, force: false });
  }, false);
}

export function copyPath(env: FsMethodEnv, params: Record<string, unknown>) {
  return mutateFs(env, params, async (from, to) => {
    if (!to) throw { code: "INVALID_ARGUMENT", message: "缺少参数 toPath" } satisfies AppError;
    await mkdir(dirname(to.abs), { recursive: true });
    await cp(from.abs, to.abs, { recursive: true, errorOnExist: true, dereference: false });
  }, true);
}

export function movePath(env: FsMethodEnv, params: Record<string, unknown>) {
  return renamePath(env, params);
}

/** 小型预览资源字节读取（base64 分块由调用方按 maxResourceBytes 预算使用）。 */
export async function readResource(
  env: FsMethodEnv,
  params: Record<string, unknown>,
): Promise<Result<WorkspaceResourceResult, AppError>> {
  try {
    throwIfCancelled(env.signal);
    const confined = confineWorkspacePath(env.rootReal, strParam(params, "path", true) ?? "");
    if (!confined.ok) return confined;
    const st = await stat(confined.abs);
    if (st.isDirectory()) return err({ code: "INVALID_ARGUMENT", message: "不支持读取目录资源" });
    if (st.size > env.limits.maxResourceBytes) {
      return err({ code: "LIMIT_EXCEEDED", message: `资源 ${st.size} 字节超过上限 ${env.limits.maxResourceBytes}` });
    }
    const bytes = await readFile(confined.abs);
    return ok({ base64: Buffer.from(bytes).toString("base64"), byteLength: bytes.byteLength, truncated: false });
  } catch (error) {
    return err(toAppError(error, "FILE_READ_ERROR", "读取资源失败"));
  }
}

const SEARCH_SKIP_DIRS = new Set(["node_modules", ".git", ".montree", "dist", "out", "release"]);
const SEARCH_EXTENSIONS = new Set([".md", ".markdown"]);

/** 远端 Markdown 字面检索（本机 workspace-md-search 语义，沿 limits 集中限额）。 */
export async function searchMarkdown(
  env: FsMethodEnv,
  params: Record<string, unknown>,
): Promise<Result<WorkspaceSearchResult, AppError>> {
  try {
    const query = strParam(params, "query", true);
    if (query === undefined) return err({ code: "INVALID_ARGUMENT", message: "缺少参数 query" });
    const trimmed = query.trim();
    if (!trimmed || [...trimmed].length > 200) {
      return err({ code: "INVALID_ARGUMENT", message: "检索词无效" });
    }
    const subdir = confineWorkspacePath(env.rootReal, strParam(params, "subdir", false) ?? "");
    if (!subdir.ok) return subdir;
    const needle = trimmed.toLowerCase();
    const files: string[] = [];
    const stack: string[] = [subdir.abs];
    while (stack.length > 0 && files.length < env.limits.searchMaxFiles) {
      throwIfCancelled(env.signal);
      const dir = stack.pop() as string;
      let dirents;
      try {
        dirents = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      const names = dirents.map((d) => d.name).sort();
      for (const name of names) {
        if (files.length >= env.limits.searchMaxFiles) break;
        if (name.startsWith(".")) continue;
        const abs = join(dir, name);
        const dirent = dirents.find((d) => d.name === name);
        if (!dirent || dirent.isSymbolicLink()) continue;
        if (dirent.isDirectory()) {
          if (SEARCH_SKIP_DIRS.has(name)) continue;
          stack.push(abs);
        } else if (dirent.isFile() && SEARCH_EXTENSIONS.has(extname(name).toLowerCase())) {
          files.push(abs);
        }
      }
    }
    files.sort();
    const hits: WorkspaceSearchResult["hits"] = [];
    for (const abs of files) {
      throwIfCancelled(env.signal);
      if (hits.length >= env.limits.searchMaxHits) break;
      let st;
      try {
        st = await stat(abs);
      } catch {
        continue;
      }
      if (!st.isFile() || st.size > env.limits.searchMaxFileBytes) continue;
      let raw: string;
      try {
        raw = await readFile(abs, "utf8");
      } catch {
        continue;
      }
      const rel = toPosixRel(env.rootReal, abs);
      const lines = raw.split(/\r?\n/);
      for (let i = 0; i < lines.length && hits.length < env.limits.searchMaxHits; i += 1) {
        const line = lines[i] ?? "";
        if (line.toLowerCase().includes(needle)) {
          hits.push({
            filePath: rel,
            lineStart: i + 1,
            line: line.length > 2000 ? line.slice(0, 2000) : line,
          });
        }
      }
    }
    return ok({ total: hits.length, hits });
  } catch (error) {
    return err(toAppError(error, "WORKSPACE_ERROR", "检索失败"));
  }
}

export interface GitEnv {
  rootReal: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

function runGit(env: GitEnv, args: string[]): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["--no-pager", ...args], {
      cwd: env.rootReal,
      windowsHide: true,
      timeout: env.timeoutMs,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 512 * 1024) child.kill();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const onAbort = () => child.kill();
    env.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (error) => {
      env.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      env.signal?.removeEventListener("abort", onAbort);
      if (env.signal?.aborted) {
        reject({ code: "CANCELLED", message: "请求已取消" } satisfies AppError);
        return;
      }
      if (code !== 0) {
        reject(new Error(stderr.trim() || `git 退出码 ${code}`));
        return;
      }
      resolve({ stdout });
    });
  });
}

export interface RemoteGitStatus {
  isRepo: boolean;
  branch: string | null;
  behind: number;
  ahead: number;
  files: Array<{ path: string; status: string; staged: boolean }>;
  totalChanges: number;
}

function parsePorcelainStatus(raw: string): RemoteGitStatus["files"] {
  const files: RemoteGitStatus["files"] = [];
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith("##")) continue;
    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    const path = line.slice(3).trim();
    if (!path) continue;
    let status = "modified";
    if (x === "?" && y === "?") status = "untracked";
    else if (x === "D" || y === "D") status = "deleted";
    else if (x === "A" || y === "A") status = "added";
    else if (x === "R" || y === "R") status = "renamed";
    else if (x === "U" || y === "U") status = "conflict";
    files.push({ path, status, staged: x !== " " && x !== "?" });
  }
  return files;
}

function parseAheadBehind(header: string): { ahead: number; behind: number } {
  const ahead = /ahead (\d+)/.exec(header);
  const behind = /behind (\d+)/.exec(header);
  return { ahead: ahead?.[1] ? Number(ahead[1]) : 0, behind: behind?.[1] ? Number(behind[1]) : 0 };
}

export async function gitStatus(env: GitEnv): Promise<Result<RemoteGitStatus, AppError>> {
  try {
    throwIfCancelled(env.signal);
    const inside = await runGit(env, ["rev-parse", "--is-inside-work-tree"]).catch(() => null);
    if (!inside || inside.stdout.trim() !== "true") {
      return ok({ isRepo: false, branch: null, behind: 0, ahead: 0, files: [], totalChanges: 0 });
    }
    const [porcelain, branchOut] = await Promise.all([
      runGit(env, ["status", "--porcelain=v1", "-b"]),
      runGit(env, ["branch", "--show-current"]),
    ]);
    const header = porcelain.stdout.split("\n")[0] ?? "";
    const { ahead, behind } = parseAheadBehind(header);
    const branch = branchOut.stdout.trim() || null;
    const files = parsePorcelainStatus(porcelain.stdout);
    return ok({ isRepo: true, branch, behind, ahead, files, totalChanges: files.length });
  } catch (error) {
    return err(toAppError(error, "GIT_ERROR", "查询 Git 状态失败"));
  }
}

export async function gitDiff(
  env: GitEnv,
  params: Record<string, unknown>,
): Promise<Result<{ diff: string; truncated: boolean }, AppError>> {
  try {
    throwIfCancelled(env.signal);
    const args = ["diff", "--no-color"];
    if (params["staged"] === true) args.push("--cached");
    const path = strParam(params, "path", false);
    if (path) {
      if (path.includes("\0") || path.startsWith("/") || path.includes("..")) {
        return err({ code: "INVALID_ARGUMENT", message: "diff 路径非法" });
      }
      args.push("--", path);
    }
    const { stdout } = await runGit(env, args);
    const cap = 256 * 1024;
    if (stdout.length > cap) return ok({ diff: stdout.slice(0, cap), truncated: true });
    return ok({ diff: stdout, truncated: false });
  } catch (error) {
    return err(toAppError(error, "GIT_ERROR", "读取 Git 差异失败"));
  }
}

export async function gitBranch(env: GitEnv): Promise<Result<{ current: string | null; branches: string[] }, AppError>> {
  try {
    throwIfCancelled(env.signal);
    const { stdout } = await runGit(env, ["branch", "--format=%(refname:short)"]);
    const branches = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
    const { stdout: currentOut } = await runGit(env, ["branch", "--show-current"]);
    return ok({ current: currentOut.trim() || null, branches });
  } catch (error) {
    return err(toAppError(error, "GIT_ERROR", "读取分支失败"));
  }
}

export async function gitCommit(
  env: GitEnv,
  params: Record<string, unknown>,
  options: GitCommitOptions,
): Promise<Result<{ success: boolean; commitHash?: string }, AppError>> {
  try {
    throwIfCancelled(env.signal);
    if (!options.message.trim()) return err({ code: "INVALID_ARGUMENT", message: "提交信息为空" });
    if (options.stageAll) await runGit(env, ["add", "-A"]);
    else await runGit(env, ["add", "--", "."]);
    const { stdout } = await runGit(env, ["commit", "-m", options.message]);
    const match = /\[[\w-]+\s+([0-9a-f]{7,40})\]/.exec(stdout);
    void params;
    return ok({ success: true, commitHash: match?.[1] });
  } catch (error) {
    return err(toAppError(error, "GIT_COMMIT_FAILED", "提交失败"));
  }
}

export async function gitPush(
  env: GitEnv,
  params: Record<string, unknown>,
  options: GitPushOptions,
): Promise<Result<{ success: boolean; stdout?: string }, AppError>> {
  try {
    throwIfCancelled(env.signal);
    const args = ["push"];
    if (options.setUpstream) args.push("-u");
    if (options.remote) {
      if (!/^[A-Za-z0-9._-]+$/.test(options.remote)) {
        return err({ code: "INVALID_ARGUMENT", message: "remote 非法" });
      }
      args.push(options.remote);
    }
    if (options.branch) {
      if (!/^[A-Za-z0-9._/@-]+$/.test(options.branch)) {
        return err({ code: "INVALID_ARGUMENT", message: "branch 非法" });
      }
      args.push(options.branch);
    }
    void params;
    const { stdout } = await runGit({ ...env, timeoutMs: 120_000 }, args);
    return ok({ success: true, stdout });
  } catch (error) {
    return err(toAppError(error, "GIT_PUSH_FAILED", "推送失败"));
  }
}

/** realpath 辅助（search 排除打开文件用，暂留最小实现）。 */
export async function realpathOf(abs: string): Promise<string | null> {
  try {
    return await realpath(abs);
  } catch {
    return null;
  }
}

export async function lstatIsSymlink(abs: string): Promise<boolean> {
  try {
    return (await lstat(abs)).isSymbolicLink();
  } catch {
    return false;
  }
}
