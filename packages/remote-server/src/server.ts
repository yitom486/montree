/**
 * workspace 服务主机：stdio 帧循环 + 方法分发 + 并发上限 + 取消注册表。
 * stdin/stdout 只走协议帧；日志与 fatal 收尾走 stderr。
 */
import type { AppError } from "@yitom/contracts/core/errors";
import type { GitCommitOptions, GitPushOptions } from "@yitom/contracts/types/git";
import type { Result } from "@yitom/contracts/core/result";
import {
  DEFAULT_WORKSPACE_LIMITS,
  WORKSPACE_PROTOCOL_MAJOR,
  WORKSPACE_PROTOCOL_MINOR,
  type WorkspaceLimits,
  type WorkspaceServerHandshake,
  type WorkspaceWatchEvent,
} from "@yitom/contracts/types/workspace";
import { err, ok } from "@yitom/contracts/core/result";
import {
  decodeWorkspaceFrames,
  encodeWorkspaceFrame,
  type WorkspaceRequest,
  type WorkspaceResponse,
} from "@montree/workspace-core";
import { logRemoteServer } from "./logger";
import {
  copyPath,
  createFile,
  deletePath,
  gitBranch,
  gitCommit,
  gitDiff,
  gitPush,
  gitStatus,
  listDirectory,
  mkdirDir,
  movePath,
  readResource,
  readText,
  renamePath,
  searchMarkdown,
  statPath,
  writeText,
  type FsMethodEnv,
} from "./methods";
import { resolveRootReal } from "./root-guard";
import { WatchRegistry } from "./watch";

export interface WorkspaceServerOptions {
  /** 托管根（宿主绝对路径）；启动时解析真实路径并作为归属。 */
  root: string;
  session: string;
  generation?: string;
  buildId?: string;
  limits?: Partial<WorkspaceLimits>;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
}

export interface WorkspaceServer {
  readonly rootReal: string;
  readonly session: string;
  readonly handshake: WorkspaceServerHandshake;
  handleRequest: (request: WorkspaceRequest) => Promise<WorkspaceResponse>;
  onEvent: (listener: (event: WorkspaceWatchEvent | { fatal: AppError }) => void) => () => void;
  dispose: () => void;
}

function toResponse(id: string, result: Result<unknown, AppError>): WorkspaceResponse {
  if (result.ok) return { proto: "montree-workspace", id, ok: true, value: result.value };
  return { proto: "montree-workspace", id, ok: false, error: result.error };
}

export function createWorkspaceServer(options: WorkspaceServerOptions): WorkspaceServer {
  const rootReal = resolveRootReal(options.root);
  const session = options.session;
  let generation = options.generation ?? "gen-1";
  const limits: WorkspaceLimits = { ...DEFAULT_WORKSPACE_LIMITS, ...options.limits };
  const buildId = options.buildId ?? "dev";
  const writeChains = new Map<string, Promise<unknown>>();
  const cancelControllers = new Map<string, AbortController>();
  const eventListeners = new Set<(event: WorkspaceWatchEvent | { fatal: AppError }) => void>();
  let running = 0;
  const queue: Array<() => void> = [];

  const handshake: WorkspaceServerHandshake = {
    protocolMajor: WORKSPACE_PROTOCOL_MAJOR,
    protocolMinor: WORKSPACE_PROTOCOL_MINOR,
    buildId,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    capabilities: ["fs", "watch", "search", "git", "resource"],
    limits,
  };

  const registry = new WatchRegistry(rootReal, {
    onEvent: (event) => {
      for (const listener of eventListeners) listener(event);
    },
  }, () => generation);

  function emitFatal(error: AppError): void {
    for (const listener of eventListeners) listener({ fatal: error });
  }

  function withSlot<T>(task: () => Promise<T>): Promise<T> {
    if (running < limits.maxConcurrent) {
      running += 1;
      return task().finally(() => {
        running -= 1;
        const next = queue.shift();
        if (next) {
          running += 1;
          next();
        }
      });
    }
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task().then(resolve, reject).finally(() => {
          running -= 1;
          const next = queue.shift();
          if (next) {
            running += 1;
            next();
          }
        });
      });
    });
  }

  async function dispatch(request: WorkspaceRequest, signal: AbortSignal): Promise<Result<unknown, AppError>> {
    if (request.session !== session) {
      return err({ code: "INVALID_STATE", message: "workspace session 不匹配（旧连接残留）" });
    }
    if (request.generation !== generation) {
      return err({ code: "INVALID_STATE", message: "generation 已过期（重连后旧请求）" });
    }
    const params = request.params ?? {};
    const env: FsMethodEnv = { rootReal, limits, signal, writeChains };
    const gitEnv = { rootReal, signal, timeoutMs: limits.requestTimeoutMs };
    switch (request.method) {
      case "hello":
        return ok(handshake);
      case "ping":
        return ok({ time: Date.now() });
      case "listDirectory":
        return listDirectory(env, params);
      case "stat":
        return statPath(env, params);
      case "readText":
        return readText(env, params);
      case "writeText":
        return writeText(env, params);
      case "mkdir":
        return mkdirDir(env, params);
      case "createFile":
        return createFile(env, params);
      case "rename":
        return renamePath(env, params);
      case "delete":
        return deletePath(env, params);
      case "copy":
        return copyPath(env, params);
      case "move":
        return movePath(env, params);
      case "readResource":
        return readResource(env, params);
      case "searchMarkdown":
        return searchMarkdown(env, params);
      case "gitStatus":
        return gitStatus(gitEnv);
      case "gitDiff":
        return gitDiff(gitEnv, params);
      case "gitBranch":
        return gitBranch(gitEnv);
      case "gitCommit":
        return gitCommit(gitEnv, params, {
          message: typeof params["message"] === "string" ? params["message"] : "",
          stageAll: params["stageAll"] === true,
        } satisfies GitCommitOptions);
      case "gitPush":
        return gitPush(gitEnv, params, {
          remote: typeof params["remote"] === "string" ? params["remote"] : undefined,
          branch: typeof params["branch"] === "string" ? params["branch"] : undefined,
          setUpstream: params["setUpstream"] === true,
        } satisfies GitPushOptions);
      case "watch": {
        const rel = typeof params["path"] === "string" ? params["path"] : "";
        const result = registry.subscribe(rel);
        if (!result.ok) return result;
        return ok({ subscriptionId: result.value.subscriptionId });
      }
      case "unwatch": {
        const id = typeof params["subscriptionId"] === "string" ? params["subscriptionId"] : "";
        if (!registry.unsubscribe(id)) {
          return err({ code: "INVALID_ARGUMENT", message: "未知订阅" });
        }
        return ok({ unsubscribed: true });
      }
      case "cancel": {
        const id = typeof params["id"] === "string" ? params["id"] : "";
        cancelControllers.get(id)?.abort();
        return ok({ cancelled: true });
      }
      default:
        return err({ code: "NOT_SUPPORTED", message: `未知方法 ${request.method}` });
    }
  }

  async function handleRequest(request: WorkspaceRequest): Promise<WorkspaceResponse> {
    const started = Date.now();
    const controller = new AbortController();
    cancelControllers.set(request.id, controller);
    try {
      // watch/unwatch/cancel/ping/hello 走快车道，不占并发槽
      const fast = request.method === "watch" || request.method === "unwatch" ||
        request.method === "cancel" || request.method === "ping" || request.method === "hello";
      const result = fast
        ? await dispatch(request, controller.signal)
        : await withSlot(() => dispatch(request, controller.signal));
      logRemoteServer("info", {
        method: String(request.method),
        requestId: request.id,
        durationMs: Date.now() - started,
        code: result.ok ? "OK" : result.error.code,
      });
      return toResponse(request.id, result);
    } catch (error) {
      const appError: AppError = error && typeof error === "object" && "code" in error
        ? (error as AppError)
        : { code: "UNKNOWN", message: error instanceof Error ? error.message : "服务内部错误" };
      logRemoteServer("error", {
        method: String(request.method),
        requestId: request.id,
        durationMs: Date.now() - started,
        code: appError.code,
      });
      return toResponse(request.id, err(appError));
    } finally {
      cancelControllers.delete(request.id);
    }
  }

  function dispose(): void {
    registry.dispose();
    for (const controller of cancelControllers.values()) controller.abort();
    cancelControllers.clear();
    eventListeners.clear();
  }

  // 供重连语义：generation 由接入层推进（旧订阅/旧响应随之失效）。
  function setGeneration(next: string): void {
    generation = next;
  }
  void setGeneration;
  void emitFatal;

  return { rootReal, session, handshake, handleRequest, onEvent: (listener) => {
    eventListeners.add(listener);
    return () => {
      eventListeners.delete(listener);
    };
  }, dispose };
}

/**
 * stdio 接线：stdin 帧流 → handleRequest → stdout 帧；事件帧同样走 stdout；
 * 日志/fatal 文本走 stderr；EOF → 收尾退出；stdout EPIPE → 静默退出。
 */
export function serveWorkspaceStdio(server: WorkspaceServer, options: WorkspaceServerOptions): void {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  let rest: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  let dead = false;

  function writeFrame(payload: unknown): void {
    if (dead) return;
    const bytes = encodeWorkspaceFrame(payload);
    try {
      const drained = stdout.write(bytes);
      void drained;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EPIPE") {
        dead = true;
        server.dispose();
        process.exit(0);
      }
    }
  }

  stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error?.code === "EPIPE") {
      dead = true;
      server.dispose();
      process.exit(0);
    }
  });

  server.onEvent((event) => {
    if ("fatal" in event) {
      logRemoteServer("error", { code: event.fatal.code, state: "fatal" });
      return;
    }
    writeFrame({
      proto: "montree-workspace",
      event: "watch",
      session: server.session,
      generation: event.generation,
      payload: event,
    });
  });

  stdin.on("data", (chunk: Uint8Array) => {
    const combined = new Uint8Array(rest.byteLength + chunk.byteLength);
    combined.set(rest, 0);
    combined.set(chunk, rest.byteLength);
    const decoded = decodeWorkspaceFrames(combined, server.handshake.limits.maxFrameBytes);
    if ("kind" in decoded && decoded.kind === "error") {
      logRemoteServer("error", { code: decoded.error.code, state: "frame-decode" });
      rest = new Uint8Array(0);
      return;
    }
    rest = decoded.rest;
    for (const frame of decoded.frames) {
      if (frame.kind === "event" || frame.kind === "response") continue;
      if (frame.kind === "invalid") {
        writeFrame({ proto: "montree-workspace", id: frame.id, ok: false, error: frame.error });
        continue;
      }
      void server.handleRequest(frame.request).then((response) => writeFrame(response));
    }
  });

  stdin.on("end", () => {
    server.dispose();
    process.exit(0);
  });
  stdin.on("error", () => {
    server.dispose();
    process.exit(0);
  });
}
