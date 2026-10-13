/**
 * 远端原生监听：按订阅合并事件（400ms 窗口，对齐本机 workspace-watcher），
 * 忽略 .git / node_modules 等噪声；不支持 recursive 的平台（Linux）只做单层，
 * 由调用方按需为子目录逐个订阅（明确策略，不悄悄全树轮询）。
 */
import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import type { AppError } from "@montree/contracts/core/errors";
import type { Result } from "@montree/contracts/core/result";
import type { WorkspaceWatchChange, WorkspaceWatchEvent } from "@montree/contracts/types/workspace";
import { err, ok } from "@montree/contracts/core/result";
import { confineWorkspacePath } from "./root-guard";

export const WATCH_COALESCE_MS = 400;
const WATCH_IGNORE_SEGMENTS = new Set([".git", "node_modules", ".montree"]);

function isIgnoredRel(rel: string): boolean {
  return rel.split("/").some((segment) => WATCH_IGNORE_SEGMENTS.has(segment));
}

export interface WatchRegistryEvents {
  onEvent: (event: WorkspaceWatchEvent) => void;
}

export class WatchRegistry {
  private watchers = new Map<string, { watcher: FSWatcher; timer: ReturnType<typeof setTimeout> | null; pending: Map<string, WorkspaceWatchChange> }>();
  private counter = 0;

  constructor(
    private readonly rootReal: string,
    private readonly events: WatchRegistryEvents,
    private readonly getGeneration: () => string,
  ) {}

  get size(): number {
    return this.watchers.size;
  }

  subscribe(relDir: string): Result<{ subscriptionId: string; recursive: boolean }, AppError> {
    const confined = confineWorkspacePath(this.rootReal, relDir);
    if (!confined.ok) return confined;
    const recursive = process.platform === "win32" || process.platform === "darwin";
    let watcher: FSWatcher;
    try {
      watcher = watch(confined.abs, { recursive });
    } catch (error) {
      return err({
        code: (error as NodeJS.ErrnoException)?.code === "ENOENT" ? "FILE_NOT_FOUND" : "WORKSPACE_ERROR",
        message: error instanceof Error ? error.message : "监听失败",
      });
    }
    const subscriptionId = `wsub-${(this.counter += 1)}`;
    const entry = {
      watcher,
      timer: null as ReturnType<typeof setTimeout> | null,
      pending: new Map<string, WorkspaceWatchChange>(),
    };
    this.watchers.set(subscriptionId, entry);
    watcher.on("error", () => {
      this.unsubscribe(subscriptionId);
    });
    watcher.on("change", (eventType, filename) => {
      const name = typeof filename === "string" ? filename : "";
      const rel = confined.rel ? `${confined.rel}/${name}` : name;
      if (!name || isIgnoredRel(rel)) return;
      // fs.watch 语义粗糙（rename 难分创建/删除）：统一记 modified，
      // 精确类型由消费方按需 stat；删除场景由保存冲突路径覆盖，不伪装精确。
      entry.pending.set(rel, { path: rel, kind: "modified" });
      if (entry.timer) return;
      entry.timer = setTimeout(() => {
        entry.timer = null;
        const changes = [...entry.pending.values()];
        entry.pending.clear();
        if (changes.length === 0) return;
        this.events.onEvent({ subscriptionId, generation: this.getGeneration(), changes });
      }, WATCH_COALESCE_MS);
      entry.timer.unref?.();
    });
    return ok({ subscriptionId, recursive });
  }

  unsubscribe(subscriptionId: string): boolean {
    const entry = this.watchers.get(subscriptionId);
    if (!entry) return false;
    this.watchers.delete(subscriptionId);
    if (entry.timer) clearTimeout(entry.timer);
    try {
      entry.watcher.close();
    } catch {
      // 关闭幂等，忽略二次错误
    }
    return true;
  }

  dispose(): void {
    for (const id of [...this.watchers.keys()]) this.unsubscribe(id);
  }
}
