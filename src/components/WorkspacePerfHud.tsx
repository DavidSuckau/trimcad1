import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store/useStore'
import {
  getLastPerfMeasureMs,
  setPerfHudActive,
} from '../perf/perfMarks'

type FrameStats = {
  fps: number
  frameMs: number
  hoverHitMs: number | null
}

function fmtMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  return ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`
}

function frameClass(frameMs: number): string {
  if (frameMs <= 16.7) return 'workspace-perf-hud-value--ok'
  if (frameMs <= 33.3) return 'workspace-perf-hud-value--warn'
  return 'workspace-perf-hud-value--bad'
}

/**
 * Live-Performance auf der Arbeitsfläche (oben links).
 * FPS / Frame-Zeit per rAF; Hover-Hit aus perfMeasure('hover-hit').
 */
export function WorkspacePerfHud() {
  const { showPerfHud, pieceCount, performanceMode, profileCount } = useStore(
    useShallow((s) => ({
      showPerfHud: s.showPerfHud,
      pieceCount: s.workspace.pieces.length,
      performanceMode: s.performanceMode,
      profileCount: s.workspace.profileAssignments?.length ?? 0,
    })),
  )

  const [stats, setStats] = useState<FrameStats>({
    fps: 0,
    frameMs: 0,
    hoverHitMs: null,
  })

  useEffect(() => {
    if (!showPerfHud) {
      setPerfHudActive(false)
      return
    }
    setPerfHudActive(true)
    let raf = 0
    let last = performance.now()
    let frames = 0
    let acc = 0
    let latestFrameMs = 0

    const tick = (now: number) => {
      const dt = Math.max(0, now - last)
      last = now
      frames += 1
      acc += dt
      latestFrameMs = dt
      if (acc >= 400) {
        const fps = (frames * 1000) / acc
        frames = 0
        acc = 0
        setStats({
          fps,
          frameMs: latestFrameMs,
          hoverHitMs: getLastPerfMeasureMs('hover-hit'),
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      setPerfHudActive(false)
    }
  }, [showPerfHud])

  if (!showPerfHud) return null

  return (
    <div
      className="workspace-perf-hud"
      role="status"
      aria-live="off"
      aria-label="Live Performance"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="workspace-perf-hud-title">Perf (live)</div>
      <div className="workspace-perf-hud-row">
        <span className="workspace-perf-hud-label">FPS</span>
        <span className={`workspace-perf-hud-value ${frameClass(stats.frameMs)}`}>
          {stats.fps > 0 ? stats.fps.toFixed(0) : '—'}
        </span>
      </div>
      <div className="workspace-perf-hud-row">
        <span className="workspace-perf-hud-label">Frame</span>
        <span className={`workspace-perf-hud-value ${frameClass(stats.frameMs)}`}>
          {fmtMs(stats.frameMs || null)}
        </span>
      </div>
      <div className="workspace-perf-hud-row">
        <span className="workspace-perf-hud-label">Hover-Hit</span>
        <span className="workspace-perf-hud-value">{fmtMs(stats.hoverHitMs)}</span>
      </div>
      <div className="workspace-perf-hud-row workspace-perf-hud-row--meta">
        <span className="workspace-perf-hud-label">Teile</span>
        <span className="workspace-perf-hud-value">{pieceCount}</span>
      </div>
      <div className="workspace-perf-hud-row workspace-perf-hud-row--meta">
        <span className="workspace-perf-hud-label">Profile</span>
        <span className="workspace-perf-hud-value">{profileCount}</span>
      </div>
      {performanceMode ? (
        <p className="workspace-perf-hud-hint">Performance-Modus an</p>
      ) : (
        <p className="workspace-perf-hud-hint">Maus bewegen → Hover-Hit</p>
      )}
    </div>
  )
}
