/** True while the on-canvas Perf-HUD is mounted (forces marks in production). */
let perfHudActive = false

const lastMeasures = new Map<string, { ms: number; at: number }>()

/** True when DEV, explicit `globalThis.__TRIMTEX_PERF__`, or Perf-HUD is on. */
export function perfEnabled(): boolean {
  try {
    if (perfHudActive) return true
    if (import.meta.env.DEV) return true
    return (globalThis as { __TRIMTEX_PERF__?: boolean }).__TRIMTEX_PERF__ === true
  } catch {
    return false
  }
}

/** Called by WorkspacePerfHud on mount/unmount so marks run while the HUD is visible. */
export function setPerfHudActive(active: boolean): void {
  perfHudActive = active
}

/** Last recorded duration for a `performance.measure` name (ms), or null. */
export function getLastPerfMeasureMs(name: string): number | null {
  const e = lastMeasures.get(name)
  return e ? e.ms : null
}

/** Snapshot of recent measure names → ms (for HUD / tests). */
export function getPerfMeasureSnapshot(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of lastMeasures) out[k] = v.ms
  return out
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
    const entries = performance.getEntriesByName(name, 'measure')
    const last = entries[entries.length - 1]
    if (last && Number.isFinite(last.duration)) {
      lastMeasures.set(name, { ms: last.duration, at: performance.now() })
    }
    try {
      performance.clearMarks(startMark)
      performance.clearMeasures(name)
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore missing marks / unsupported measure */
  }
}
