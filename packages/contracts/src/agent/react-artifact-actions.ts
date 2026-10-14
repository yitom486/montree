/** iframe 只提出文本请求；真正发送由宿主按钮确认，不携带 IPC 方法或执行代码。 */
export const REACT_ARTIFACT_REQUEST_MAX_BYTES = 1536

export function parseReactArtifactRequest(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const text = value.trim()
  return new TextEncoder().encode(text).byteLength <= REACT_ARTIFACT_REQUEST_MAX_BYTES ? text : null
}
