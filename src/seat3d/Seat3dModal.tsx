import { Suspense, useEffect } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useStore } from '../store/useStore'
import { Seat3dViewport } from './Seat3dViewport'
import { useSeat3dStore } from './useSeat3dStore'
import type { SeatRegion } from './types'
import './seat3d.css'

export function Seat3dModal() {
  const open = useSeat3dStore((s) => s.open)
  const setOpen = useSeat3dStore((s) => s.setOpen)
  const placements = useSeat3dStore((s) => s.placements)
  const togglePiece = useSeat3dStore((s) => s.togglePiece)
  const setRegion = useSeat3dStore((s) => s.setRegion)
  const clear = useSeat3dStore((s) => s.clear)

  const pieces = useStore((s) => s.workspace.pieces)
  const trapRef = useFocusTrap<HTMLDivElement>(open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null

  const placementIds = new Set(placements.map((p) => p.pieceId))

  return (
    <div
      className="seat3d-window"
      ref={trapRef}
      role="dialog"
      aria-modal="true"
      aria-label="Sitz-3D-Vorschau"
    >
      <header className="seat3d-window-header">
        <div className="seat3d-window-title">
          <h2>Sitz-3D-Vorschau</h2>
          <span className="seat3d-window-subtitle">
            Experimentell · Teile auf Sitzschale / Lehne biegen · jederzeit entfernbar
          </span>
        </div>
        <div className="seat3d-window-header-actions">
          <button type="button" className="sidebar-btn" onClick={() => clear()}>
            Zurücksetzen
          </button>
          <button type="button" className="sidebar-btn primary" onClick={() => setOpen(false)}>
            Schließen
          </button>
        </div>
      </header>
      <div className="seat3d-window-body">
        <aside className="seat3d-window-sidebar">
          <p className="seat3d-hint">
            Schnittteile anhaken und Region wählen. Das Teil bleibt im 2D-Schnitt flach — hier wird
            nur eine gebogene Vorschau erzeugt.
          </p>
          <ul className="seat3d-piece-list">
            {pieces.length === 0 && <li className="seat3d-empty">Keine Teile im Workspace.</li>}
            {pieces.map((p) => {
              const on = placementIds.has(p.id)
              const pl = placements.find((x) => x.pieceId === p.id)
              return (
                <li key={p.id} className={`seat3d-piece-row${on ? ' is-on' : ''}`}>
                  <label className="seat3d-piece-check">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => togglePiece(p.id, 'cushion')}
                    />
                    <span>
                      {p.number ? `${p.number} · ` : ''}
                      {p.name || p.id}
                    </span>
                  </label>
                  {on && pl && (
                    <select
                      className="seat3d-region-select"
                      value={pl.region}
                      onChange={(e) => setRegion(p.id, e.target.value as SeatRegion)}
                      aria-label="Region"
                    >
                      <option value="cushion">Sitzschale</option>
                      <option value="backrest">Lehne</option>
                    </select>
                  )}
                </li>
              )
            })}
          </ul>
        </aside>
        <div className="seat3d-window-main">
          <Suspense fallback={<div className="seat3d-loading">3D wird geladen…</div>}>
            <Seat3dViewport pieces={pieces} />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
