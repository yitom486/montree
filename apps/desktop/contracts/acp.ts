/**
 * 主进程发给渲染端的合成 ACP 更新：一次 prompt 已终止。
 *
 * `session/prompt` 的响应仍然是首选收尾信号；这个事件用于兜底——即使 IPC
 * 响应在路由/会话代际检查中被丢弃，渲染端也能收到明确的回合结束标记并
 * 关闭「工作中」与停止按钮。
 */
export const MONTREE_PROMPT_COMPLETE_KIND = 'montree_prompt_complete'
