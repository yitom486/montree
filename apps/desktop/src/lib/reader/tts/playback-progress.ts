/** Until the chapter ends, a playback bar represents the available audio, not an estimated total. */
export function getTtsPlaybackProgress(currentTime: number, duration: number, receivedDuration: number, incomplete: boolean): { duration: number; percent: number } {
  const knownDuration = incomplete ? receivedDuration : duration
  const total = Number.isFinite(knownDuration) ? Math.max(0, knownDuration) : 0
  const played = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0
  return { duration: total, percent: total > 0 ? Math.min(100, played / total * 100) : 0 }
}
