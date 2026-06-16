import { useStore } from '../store/useStore'
import { evaluateSeamAdjustment } from '../geometry/seamAdjustmentCheck'

export function SeamAdjustmentModal() {
  const seamAdjustmentDialog = useStore((s) => s.seamAdjustmentDialog)
  const setSeamAdjustmentDialog = useStore((s) => s.setSeamAdjustmentDialog)
  const setSeamAdjustmentHoverPieceId = useStore((s) => s.setSeamAdjustmentHoverPieceId)
  const adjustSeamNotches = useStore((s) => s.adjustSeamNotches)
  const workspace = useStore((s) => s.workspace)

  if (!seamAdjustmentDialog) return null

  const assignment = workspace.seamAssignments.find((a) => a.id === seamAdjustmentDialog)
  if (!assignment) return null

  const pieceA = workspace.pieces.find((p) => p.id === assignment.pieceIdA)
  const pieceB = workspace.pieces.find((p) => p.id === assignment.pieceIdB)
  if (!pieceA || !pieceB) return null

  const nameA = pieceA.name || `Teil ${pieceA.number}`
  const nameB = pieceB.name || `Teil ${pieceB.number}`

  const ev = evaluateSeamAdjustment(assignment, pieceA, pieceB)
  if (!ev) return null

  const { lenA, ncA, ncB, notchMismatch, diffs, canAdjust } = ev

  return (
    <div
      className="nahtzugabe-dialog-overlay"
      onClick={() => setSeamAdjustmentDialog(null)}
      role="dialog"
      aria-modal="true"
      aria-label="Nahtanpassung"
    >
      <div className="nahtzugabe-dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 320 }}>
        <h3 className="nahtzugabe-dialog-title">Nahtanpassung</h3>

        <div style={{ fontSize: '0.8125rem', color: '#333', marginBottom: '0.75rem', lineHeight: 1.5 }}>
          <div style={{ marginBottom: '0.35rem' }}>
            Kantenlänge: {lenA.toFixed(1)} mm, je {ncA} Notch{ncA !== 1 ? 'es' : ''}
          </div>

          {notchMismatch && (
            <div style={{ color: '#c62828', marginBottom: '0.25rem' }}>
              Notch-Anzahl ungleich ({ncA} vs {ncB}) — keine automatische Anpassung möglich
            </div>
          )}
          {diffs.length > 0 && (
            <div style={{ color: '#e65100', marginBottom: '0.25rem' }}>
              {diffs.length === 1
                ? `Abschnitt ${diffs[0].idx} weicht um ${diffs[0].diff.toFixed(1)} mm ab`
                : `${diffs.length} Abschnitte weichen ab (max ${Math.max(...diffs.map((d) => d.diff)).toFixed(1)} mm)`
              }
            </div>
          )}
        </div>

        <div style={{ fontSize: '0.8125rem', color: '#555', marginBottom: '1rem' }}>
          {canAdjust
            ? 'Notch-Abstände automatisch anpassen?'
            : 'Automatische Anpassung nicht möglich.'
          }
        </div>

        <div className="nahtzugabe-dialog-actions" style={{ flexDirection: 'column', gap: '0.4rem' }}>
          <button
            disabled={!canAdjust}
            style={{
              padding: '0.5rem 0.75rem',
              fontSize: '0.8125rem',
              border: '1px solid #ccc',
              borderRadius: 4,
              background: canAdjust ? '#1976d2' : '#e0e0e0',
              color: canAdjust ? '#fff' : '#999',
              cursor: canAdjust ? 'pointer' : 'default',
            }}
            onMouseEnter={() => setSeamAdjustmentHoverPieceId(pieceB.id)}
            onMouseLeave={() => setSeamAdjustmentHoverPieceId(null)}
            onClick={() => adjustSeamNotches(seamAdjustmentDialog, 'A')}
          >
            „{nameB}" anpassen ({nameA} bleibt)
          </button>
          <button
            disabled={!canAdjust}
            style={{
              padding: '0.5rem 0.75rem',
              fontSize: '0.8125rem',
              border: '1px solid #ccc',
              borderRadius: 4,
              background: canAdjust ? '#1976d2' : '#e0e0e0',
              color: canAdjust ? '#fff' : '#999',
              cursor: canAdjust ? 'pointer' : 'default',
            }}
            onMouseEnter={() => setSeamAdjustmentHoverPieceId(pieceA.id)}
            onMouseLeave={() => setSeamAdjustmentHoverPieceId(null)}
            onClick={() => adjustSeamNotches(seamAdjustmentDialog, 'B')}
          >
            „{nameA}" anpassen ({nameB} bleibt)
          </button>
          <button
            style={{
              padding: '0.5rem 0.75rem',
              fontSize: '0.8125rem',
              border: '1px solid #ccc',
              borderRadius: 4,
              background: '#fff',
              color: '#333',
              cursor: 'pointer',
            }}
            onMouseEnter={() => setSeamAdjustmentHoverPieceId(null)}
            onMouseLeave={() => setSeamAdjustmentHoverPieceId(null)}
            onClick={() => setSeamAdjustmentDialog(null)}
          >
            Nicht anpassen
          </button>
        </div>

      </div>
    </div>
  )
}
