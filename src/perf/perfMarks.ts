/** True when DEV or explicit `globalThis.__TRIMTEX_PERF__`. */
function perfEnabled(): boolean {
  try {
    if (import.meta.env.DEV) return true
    return (globalThis as { __TRIMTEX_PERF__?: boolean }).__TRIMTEX_PERF__ === true
  } catch {
    return false
  }
}

/** `performance.mark` when profiling is enabled. */
export function perfMark(name: string): void {
  if (!perfEnabled()) return
  try {
    performance.mark(name)
  } catch {
    /* ignore unsupported / invalid marks */
  }
}

/** `performance.measure` from `startMark` when profiling is enabled. */
export function perfMeasure(name: string, startMark: string): void {
  if (!perfEnabled()) return
  try {
    performance.measure(name, startMark)
  } catch {
    /* ignore missing marks / unsupported measure */
  }
}
