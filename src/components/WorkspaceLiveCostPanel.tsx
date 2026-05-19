import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store/useStore'
import {
  computeLiveBomSummary,
  fmtLiveBomAreaM2,
  fmtLiveBomEuro,
  fmtLiveBomPerimeterM,
} from '../bom/liveBomSummary'

/**
 * Live-Kosten/Fläche aus der Stückliste – unten rechts auf der Arbeitsfläche.
 * Aktualisiert sich bei jeder Änderung an Schnittkontur, Stückzahl oder Material.
 */
export function WorkspaceLiveCostPanel() {
  const { showLiveBomCost, pieces } = useStore(
    useShallow((s) => ({
      showLiveBomCost: s.showLiveBomCost,
      pieces: s.workspace.pieces,
    })),
  )

  const summary = useMemo(() => computeLiveBomSummary(pieces), [pieces])

  if (!showLiveBomCost) return null

  return (
    <div
      className="workspace-live-cost"
      role="status"
      aria-live="polite"
      aria-label="Live Stückliste Kosten"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="workspace-live-cost-title">Stückliste (live)</div>
      <div className="workspace-live-cost-row">
        <span className="workspace-live-cost-label">Teile</span>
        <span className="workspace-live-cost-value">{summary.pieceCount}</span>
      </div>
      <div className="workspace-live-cost-row">
        <span className="workspace-live-cost-label">Σ Fläche</span>
        <span className="workspace-live-cost-value">{fmtLiveBomAreaM2(summary.totalAreaM2)} m²</span>
      </div>
      <div className="workspace-live-cost-row">
        <span className="workspace-live-cost-label">Σ Umfang</span>
        <span className="workspace-live-cost-value">{fmtLiveBomPerimeterM(summary.totalPerimeterM)} m</span>
      </div>
      <div className="workspace-live-cost-row workspace-live-cost-row--emph">
        <span className="workspace-live-cost-label">Σ Material</span>
        <span className="workspace-live-cost-value">{fmtLiveBomEuro(summary.totalMaterialEuro)}</span>
      </div>
      {summary.unpricedPieceCount > 0 ? (
        <p className="workspace-live-cost-hint">
          {summary.unpricedPieceCount} Teil{summary.unpricedPieceCount === 1 ? '' : 'e'} ohne Katalogpreis
        </p>
      ) : null}
    </div>
  )
}
