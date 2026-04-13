import React from 'react'
import { useStore } from '../store/useStore'

const iconProps = {
  className: 'canvas-tool-icon',
  viewBox: '0 0 20 20',
  width: 18,
  height: 18,
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
}

export const CanvasToolbar: React.FC = () => {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const contourEditEnabled = useStore((s) => s.contourEditEnabled)
  const setToastMessage = useStore((s) => s.setToastMessage)
  const rulerMode = useStore((s) => s.rulerMode)
  const setRulerMode = useStore((s) => s.setRulerMode)
  const pendingNahtzugabeClick = useStore((s) => s.pendingNahtzugabeClick)
  const setPendingNahtzugabeClick = useStore((s) => s.setPendingNahtzugabeClick)
  const edgeSeamPickingActive = useStore((s) => s.edgeSeamPickingActive)
  const setEdgeSeamPickingActive = useStore((s) => s.setEdgeSeamPickingActive)
  const horizontalLevelPickingActive = useStore((s) => s.horizontalLevelPickingActive)
  const setHorizontalLevelPickingActive = useStore((s) => s.setHorizontalLevelPickingActive)
  const selectedPieceIds = useStore((s) => s.selectedPieceIds)

  const layoutOnly = !contourEditEnabled
  const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation()

  const guardContourEdit = (): boolean => {
    if (!layoutOnly) return true
    setToastMessage('warn:Layout-Modus: Unten „Kontur bearbeiten“ einschalten.')
    return false
  }

  const handleNahtzugabe = () => {
    if (!guardContourEdit()) return
    if (pendingNahtzugabeClick) {
      setPendingNahtzugabeClick(false)
    } else {
      setEdgeSeamPickingActive(false)
      setHorizontalLevelPickingActive(false)
      setPendingNahtzugabeClick(true)
    }
  }

  const handleEdgeSeam = () => {
    if (!guardContourEdit()) return
    if (selectedPieceIds.length !== 1) return
    if (edgeSeamPickingActive) {
      setEdgeSeamPickingActive(false)
    } else {
      setPendingNahtzugabeClick(false)
      setHorizontalLevelPickingActive(false)
      setEdgeSeamPickingActive(true)
    }
  }

  const handleRuler = () => {
    if (!guardContourEdit()) return
    const next = !rulerMode
    setRulerMode(next)
    if (next) setHorizontalLevelPickingActive(false)
  }

  const handleHorizontalLevel = () => {
    if (selectedPieceIds.length !== 1) return
    if (horizontalLevelPickingActive) {
      setHorizontalLevelPickingActive(false)
    } else {
      setTool('select')
      setRulerMode(false)
      setPendingNahtzugabeClick(false)
      setEdgeSeamPickingActive(false)
      setHorizontalLevelPickingActive(true)
    }
  }

  const isActive = (t: string) =>
    tool === t &&
    !rulerMode &&
    !pendingNahtzugabeClick &&
    !edgeSeamPickingActive &&
    !horizontalLevelPickingActive
  const dim = layoutOnly ? ' canvas-tool-btn--layout-only' : ''

  return (
    <div
      className="canvas-toolbar"
      onPointerDown={stopPropagation}
      onPointerUp={stopPropagation}
      onClick={stopPropagation}
      onWheel={stopPropagation}
    >
      <button
        type="button"
        className={`canvas-tool-btn${isActive('select') ? ' active' : ''}`}
        title="Auswahl (V)"
        onClick={() => {
          setTool('select')
          setRulerMode(false)
          setPendingNahtzugabeClick(false)
          setEdgeSeamPickingActive(false)
          setHorizontalLevelPickingActive(false)
        }}
      >
        <svg {...iconProps}>
          <path d="M4 3.5l6.2 14.5 1.4-5.2 5.2-1.4L4 3.5z" />
          <path d="M11.6 12.8l4.9 4.9" opacity={0.85} />
        </svg>
      </button>
      <button
        type="button"
        className={`canvas-tool-btn${isActive('pan') ? ' active' : ''}`}
        title="Verschieben (H)"
        onClick={() => {
          setTool('pan')
          setRulerMode(false)
          setPendingNahtzugabeClick(false)
          setEdgeSeamPickingActive(false)
          setHorizontalLevelPickingActive(false)
        }}
      >
        <svg {...iconProps}>
          <path d="M10 3.5v3M10 13.5v3M3.5 10h3M13.5 10h3" />
          <path d="M10 3.5l-1.2 1.8M10 3.5l1.2 1.8M10 16.5l-1.2-1.8M10 16.5l1.2-1.8M3.5 10l1.8-1.2M3.5 10l1.8 1.2M16.5 10l-1.8-1.2M16.5 10l-1.8 1.2" />
        </svg>
      </button>

      <div className="canvas-tool-separator" />

      <button
        type="button"
        className={`canvas-tool-btn${isActive('point') ? ' active' : ''}${dim}`}
        title="Punkt (P)"
        onClick={() => {
          if (!guardContourEdit()) return
          setTool('point')
          setRulerMode(false)
          setPendingNahtzugabeClick(false)
          setEdgeSeamPickingActive(false)
          setHorizontalLevelPickingActive(false)
        }}
      >
        <svg {...iconProps}>
          <circle cx="10" cy="10" r="6" opacity={0.45} />
          <circle cx="10" cy="10" r="2.25" fill="currentColor" stroke="none" />
        </svg>
      </button>
      <button
        type="button"
        className={`canvas-tool-btn${isActive('curvepoint') ? ' active' : ''}${dim}`}
        title="Kurvenpunkt (C)"
        onClick={() => {
          if (!guardContourEdit()) return
          setTool('curvepoint')
          setRulerMode(false)
          setPendingNahtzugabeClick(false)
          setEdgeSeamPickingActive(false)
          setHorizontalLevelPickingActive(false)
        }}
      >
        <svg {...iconProps}>
          <path d="M3.5 14.5C3.5 8 16.5 12 16.5 5.5" />
          <circle cx="3.5" cy="14.5" r="1.85" fill="currentColor" stroke="none" />
          <circle cx="16.5" cy="5.5" r="1.85" fill="currentColor" stroke="none" />
        </svg>
      </button>
      <button
        type="button"
        className={`canvas-tool-btn${isActive('notch') ? ' active' : ''}${dim}`}
        title="Kerbe / Notch (N)"
        onClick={() => {
          if (!guardContourEdit()) return
          setTool('notch')
          setRulerMode(false)
          setPendingNahtzugabeClick(false)
          setEdgeSeamPickingActive(false)
          setHorizontalLevelPickingActive(false)
        }}
      >
        <svg {...iconProps}>
          <path d="M3.5 5.5h13" />
          <path d="M10 5.5l-2.2 7h4.4l-2.2-7" />
        </svg>
      </button>

      <div className="canvas-tool-separator" />

      <button
        type="button"
        className={`canvas-tool-btn${pendingNahtzugabeClick ? ' active' : ''}${dim}`}
        title="Nahtzugabe (S)"
        onClick={handleNahtzugabe}
      >
        <svg {...iconProps}>
          <rect x="5.5" y="5.5" width="9" height="9" rx="1.25" />
          <rect x="2.75" y="2.75" width="14.5" height="14.5" rx="2" strokeDasharray="2.25 2" opacity={0.55} />
        </svg>
      </button>
      <button
        type="button"
        className={`canvas-tool-btn${edgeSeamPickingActive ? ' active' : ''}${dim}`}
        title="Nahtzugabe pro Kante (L)"
        disabled={selectedPieceIds.length !== 1}
        onClick={handleEdgeSeam}
      >
        <svg {...iconProps}>
          <path d="M4 15V5" />
          <path d="M8.5 15V5" strokeDasharray="2 2" opacity={0.55} />
          <path d="M4 10h4.5" />
          <path d="M11.5 15l5.5-10" />
        </svg>
      </button>

      <div className="canvas-tool-separator" />

      <button
        type="button"
        className={`canvas-tool-btn${isActive('profil') ? ' active' : ''}${dim}`}
        title="Profil zuordnen"
        onClick={() => {
          if (!guardContourEdit()) return
          setTool('profil')
          setRulerMode(false)
          setPendingNahtzugabeClick(false)
          setEdgeSeamPickingActive(false)
          setHorizontalLevelPickingActive(false)
        }}
      >
        <svg {...iconProps}>
          <path d="M2.5 14.5c2-2.8 4.2 2.2 7.5 0s5.5 2.8 7.5 0" />
          <path d="M2.5 9.5c2-2.8 4.2 2.2 7.5 0s5.5 2.8 7.5 0" opacity={0.65} />
        </svg>
      </button>
      <button
        type="button"
        className={`canvas-tool-btn${isActive('kante') ? ' active' : ''}${dim}`}
        title="Kante (K)"
        onClick={() => {
          if (!guardContourEdit()) return
          setTool('kante')
          setRulerMode(false)
          setPendingNahtzugabeClick(false)
          setEdgeSeamPickingActive(false)
          setHorizontalLevelPickingActive(false)
        }}
      >
        <svg {...iconProps}>
          <path d="M4.5 15.5L15.5 4.5" />
          <circle cx="4.5" cy="15.5" r="2" />
          <circle cx="15.5" cy="4.5" r="2" />
        </svg>
      </button>

      <div className="canvas-tool-separator" />

      <button
        type="button"
        className={`canvas-tool-btn${rulerMode ? ' active' : ''}${dim}`}
        title="Lineal"
        onClick={handleRuler}
      >
        <svg {...iconProps}>
          <path d="M4.5 14.5l11-11" />
          <path d="M5.8 13.2l1.1-1.1M8.2 10.8l1.1-1.1M10.6 8.4l1.1-1.1M13 6l1.1-1.1" opacity={0.7} />
        </svg>
      </button>
      <button
        type="button"
        className={`canvas-tool-btn${horizontalLevelPickingActive ? ' active' : ''}`}
        title="Wasserwaage: gerade Kante waagerecht ausrichten"
        disabled={selectedPieceIds.length !== 1}
        onClick={handleHorizontalLevel}
      >
        <svg {...iconProps}>
          <rect x="3.5" y="7" width="13" height="7" rx="1.5" />
          <circle cx="10" cy="10.5" r="2.2" fill="currentColor" stroke="none" opacity={0.35} />
          <circle cx="10" cy="10.5" r="1.1" fill="currentColor" stroke="none" />
          <path d="M3.5 5h13" opacity={0.55} />
        </svg>
      </button>
    </div>
  )
}
