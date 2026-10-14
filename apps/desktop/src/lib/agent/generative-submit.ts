/**
 * 生成式 UI 提交守卫（G3）：纯函数，可单测。
 * 界面归属线程须与当前活动线程一致，否则拒绝（防切线程串线）。
 * busy 与会话有效性由 sendPrompt 统一处理，此处只判归属。
 */
export function isStaleGenerativeSubmit(
  payloadThreadId: string | undefined,
  activeThreadId: string | undefined,
): boolean {
  if (!payloadThreadId || !activeThreadId) return true
  return payloadThreadId !== activeThreadId
}
