/**
 * Artifact 预览子 frame 导航守卫（P1）。
 *
 * 不信任运行时可改的 `window.name`：宿主在 `frame-created` 时（guest 脚本运行前，
 * name 来自可信渲染器）登记不可变 `frameTreeNodeId`（创建时固定、生命周期内不变、
 * 销毁后永不复用）。`will-frame-navigate` 按登记身份判定归属，运行期改名不解除限制。
 *
 * 纯模块（不 import electron）：主进程接线见 `create-window.ts`，单测直接构造假 frame。
 */

export const ARTIFACT_FRAME_NAME_PREFIX = 'montree-artifact-'

/** 守卫只需要这四个不可变/只读事实，不依赖完整 WebFrameMain。 */
export interface GuardFrameSnapshot {
  readonly name: string
  readonly url: string
  readonly frameTreeNodeId: number
  readonly detached: boolean
}

/** 按帧生命周期清理登记，不淘汰仍存活的预览帧。 */
export interface ArtifactFrameGuardOptions {
  /**
   * 存活帧枚举（主进程传入 `mainFrame.framesInSubtree` 的 nodeId 集合）。
   * 提供后，每次登记时清理已销毁帧（实际生命周期清理，活帧永不淘汰）；
   * 缺省时只增不减（窗口关闭即释放，数量级可忽略）。
   */
  listLiveFrameTreeNodeIds?: () => Iterable<number>
}

export interface ArtifactFrameGuard {
  /** `frame-created` 时调用；非 Artifact 帧直接忽略。 */
  handleFrameCreated: (frame: GuardFrameSnapshot) => void
  /** 是否 Artifact 预览帧（已登记身份，或回退名称；detached/未知一律否）。 */
  isArtifactFrame: (frame: GuardFrameSnapshot | null | undefined) => boolean
  /**
   * 子 frame 导航是否阻止。初始 `about:srcdoc`/`about:blank` 提交一律放行
   * （含各阅读器首载）；其余目标仅对 Artifact 帧阻止，阅读器帧不受影响。
   */
  shouldBlockSubframeNavigation: (
    frame: GuardFrameSnapshot | null | undefined,
    targetUrl: string,
  ) => boolean
}

export function createArtifactFrameGuard(options?: ArtifactFrameGuardOptions): ArtifactFrameGuard {
  const artifactNodeIds = new Set<number>()

  const isArtifactFrame = (frame: GuardFrameSnapshot | null | undefined): boolean => {
    if (!frame || frame.detached) return false
    if (artifactNodeIds.has(frame.frameTreeNodeId)) return true
    // 回退：登记前（如监听挂载前的极早期帧）按可信渲染器所设名称识别。
    // 改名绕过对此分支有效，但已登记帧走身份分支，不受改名影响。
    return frame.name.startsWith(ARTIFACT_FRAME_NAME_PREFIX)
  }

  return {
    handleFrameCreated(frame) {
      if (!frame.name.startsWith(ARTIFACT_FRAME_NAME_PREFIX)) return
      artifactNodeIds.add(frame.frameTreeNodeId)
      // 实际生命周期清理：只删已销毁帧；刚创建帧无条件保留（枚举可能尚未包含它），
      // 存活帧永不因数量淘汰。枚举失败则跳过清理（只增不减，等窗口释放）。
      const listLive = options?.listLiveFrameTreeNodeIds
      if (!listLive) return
      let live: Set<number>
      try {
        live = new Set(listLive())
      } catch {
        return
      }
      for (const id of artifactNodeIds) {
        if (id !== frame.frameTreeNodeId && !live.has(id)) artifactNodeIds.delete(id)
      }
    },

    isArtifactFrame,

    shouldBlockSubframeNavigation(frame, targetUrl) {
      if (targetUrl === 'about:srcdoc' || targetUrl === 'about:blank') return false
      return isArtifactFrame(frame)
    },
  }
}
