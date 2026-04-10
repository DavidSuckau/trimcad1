import React from 'react'
import { useStore } from '../store/useStore'

export const CanvasToolbar: React.FC = () => {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const rulerMode = useStore((s) => s.rulerMode)
  const setRulerMode = useStore((s) => s.setRulerMode)
  const pendingNahtzugabeClick = useStore((s) => s.pendingNahtzugabeClick)
  const setPendingNahtzugabeClick = useStore((s) => s.setPendingNahtzugabeClick)
  const edgeSeamPickingActive = useStore((s) => s.edgeSeamPickingActive)
  const setEdgeSeamPickingActive = useStore((s) => s.setEdgeSeamPickingActive)
  const selectedPieceIds = useStore((s) => s.selectedPieceIds)

  const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation()

  const handleNahtzugabe = () => {
    if (pendingNahtzugabeClick) {
      setPendingNahtzugabeClick(false)
    } else {
      setEdgeSeamPickingActive(false)
      setPendingNahtzugabeClick(true)
    }
  }

  const handleEdgeSeam = () => {
    if (selectedPieceIds.length !== 1) return
    if (edgeSeamPickingActive) {
      setEdgeSeamPickingActive(false)
    } else {
      setPendingNahtzugabeClick(false)
      setEdgeSeamPickingActive(true)
    }
  }

  const handleRuler = () => {
    setRulerMode(!rulerMode)
  }

  const isActive = (t: string) => tool === t && !rulerMode && !pendingNahtzugabeClick && !edgeSeamPickingActive

  return (
    <div
      className="canvas-toolbar"
      onPointerDown={stopPropagation}
      onPointerUp={stopPropagation}
      onClick={stopPropagation}
      onWheel={stopPropagation}
    >
      {/* Gruppe 1: Navigation */}
      <button
        className={`canvas-tool-btn${isActive('select') ? ' active' : ''}`}
        title="Auswahl (V)"
        onClick={() => { setTool('select'); setRulerMode(false); setPendingNahtzugabeClick(false); setEdgeSeamPickingActive(false) }}
      >
        <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 2l4.5 14 2-5.5L15 8.5z" />
          <path d="M9.5 10.5l4 4" />
        </svg>
      </button>
      <button
        className={`canvas-tool-btn${isActive('pan') ? ' active' : ''}`}
        title="Verschieben (H)"
        onClick={() => { setTool('pan'); setRulerMode(false); setPendingNahtzugabeClick(false); setEdgeSeamPickingActive(false) }}
      >
        <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 1v16M1 9h16M9 1l-2 2M9 1l2 2M9 17l-2-2M9 17l2-2M1 9l2-2M1 9l2 2M17 9l-2-2M17 9l-2 2" />
        </svg>
      </button>

      <div className="canvas-tool-separator" />

      {/* Gruppe 2: Geometrie / Kontur */}
      <button
        className={`canvas-tool-btn${isActive('point') ? ' active' : ''}`}
        title="Punkt (P)"
        onClick={() => { setTool('point'); setRulerMode(false); setPendingNahtzugabeClick(false); setEdgeSeamPickingActive(false) }}
      >
        <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="9" r="2.5" fill="currentColor" />
          <circle cx="9" cy="9" r="5.5" />
        </svg>
      </button>
      <button
        className={`canvas-tool-btn${isActive('curvepoint') ? ' active' : ''}`}
        title="Kurvenpunkt (C)"
        onClick={() => { setTool('curvepoint'); setRulerMode(false); setPendingNahtzugabeClick(false); setEdgeSeamPickingActive(false) }}
      >
        <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 14C2 6 16 12 16 4" />
          <circle cx="2" cy="14" r="2" fill="currentColor" />
          <circle cx="16" cy="4" r="2" fill="currentColor" />
        </svg>
      </button>
      <button
        className={`canvas-tool-btn${isActive('notch') ? ' active' : ''}`}
        title="Kerbe / Notch (N)"
        onClick={() => { setTool('notch'); setRulerMode(false); setPendingNahtzugabeClick(false); setEdgeSeamPickingActive(false) }}
      >
        <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4h14" />
          <path d="M9 4l-2.5 10" />
          <path d="M9 4l2.5 10" />
        </svg>
      </button>

      <div className="canvas-tool-separator" />

      {/* Gruppe 3: Nahtzugabe */}
      <button
        className={`canvas-tool-btn${pendingNahtzugabeClick ? ' active' : ''}`}
        title="Nahtzugabe (S)"
        onClick={handleNahtzugabe}
      >
        <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="5" width="8" height="8" rx="1" />
          <rect x="2" y="2" width="14" height="14" rx="2" strokeDasharray="2 1.5" />
        </svg>
      </button>
      <button
        className={`canvas-tool-btn${edgeSeamPickingActive ? ' active' : ''}`}
        title="Nahtzugabe pro Kante (L)"
        disabled={selectedPieceIds.length !== 1}
        onClick={handleEdgeSeam}
      >
        <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 14V4" />
          <path d="M7 14V4" strokeDasharray="2 1.5" />
          <path d="M3 9h4" />
          <path d="M3 9l1.2-1M3 9l1.2 1" />
          <path d="M7 9l-1.2-1M7 9l-1.2 1" />
          <path d="M10 14l5-10" strokeWidth="1.8" />
        </svg>
      </button>

      <div className="canvas-tool-separator" />

      {/* Gruppe 4: Erweitert */}
      <button
        className={`canvas-tool-btn${isActive('profil') ? ' active' : ''}`}
        title="Profil zuordnen"
        onClick={() => { setTool('profil'); setRulerMode(false); setPendingNahtzugabeClick(false); setEdgeSeamPickingActive(false) }}
      >
        <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 13c2-3 4 3 6 0s4 3 6 0" />
          <path d="M2 8c2-3 4 3 6 0s4 3 6 0" />
        </svg>
      </button>
      <button
        className={`canvas-tool-btn${isActive('kante') ? ' active' : ''}`}
        title="Kante (K)"
        onClick={() => { setTool('kante'); setRulerMode(false); setPendingNahtzugabeClick(false); setEdgeSeamPickingActive(false) }}
      >
        <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 15L15 3" strokeWidth="1.8" />
          <circle cx="3" cy="15" r="1.8" fill="currentColor" />
          <circle cx="15" cy="3" r="1.8" fill="currentColor" />
        </svg>
      </button>

      <div className="canvas-tool-separator" />

      {/* Gruppe 5: Messen */}
      <button
        className={`canvas-tool-btn${rulerMode ? ' active' : ''}`}
        title="Lineal"
        onClick={handleRuler}
      >
        <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="6" width="14" height="6" rx="1" />
          <path d="M5 6v3M8 6v4M11 6v3M14 6v2" />
        </svg>
      </button>
    </div>
  )
}
