import { useStore } from '../store/useStore'
import { countNotchesOnEdge, getSubSegments, edgeTotalLength } from '../geometry/seamUtils'

export function SeamAdjustmentModal() {
  const seamAdjustmentDialog = useStore((s) => s.seamAdjustmentDialog)
  const setSeamAdjustmentDialog = useStore((s) => s.setSeamAdjustmentDialog)
  const adjustSeamNotches = useStore((s) => s.adjustSeamNotches)
  const adjustSeamCorners = useStore((s) => s.adjustSeamCorners)
  const workspace = useStore((s) => s.workspace)

  if (!seamAdjustmentDialog) return null

  const assignment = workspace.seamAssignments.find((a) => a.id === seamAdjustmentDialog)
  if (!assignment) return null

  const pieceA = workspace.pieces.find((p) => p.id === assignment.pieceIdA)
  const pieceB = workspace.pieces.find((p) => p.id === assignment.pieceIdB)
  if (!pieceA || !pieceB) return null

  const nameA = pieceA.name || `Teil ${pieceA.number}`
  const nameB = pieceB.name || `Teil ${pieceB.number}`

  const lenA = edgeTotalLength(pieceA, assignment.curveIndicesA)
  const ncA = countNotchesOnEdge(pieceA, assignment.curveIndicesA)
  const ncB = countNotchesOnEdge(pieceB, assignment.curveIndicesB)
  const notchMismatch = ncA !== ncB

  const subsA = getSubSegments(pieceA, assignment.curveIndicesA)
  const subsB = getSubSegments(pieceB, assignment.curveIndicesB)
  const diffs: { idx: number; diff: number }[] = []
  if (!notchMismatch && subsA.length === subsB.length && subsA.length >= 2) {
    for (let i = 0; i < subsA.length; i++) {
      const sb = subsB[subsB.length - 1 - i]
      const d = Math.abs(subsA[i].length - sb.length)
      if (d >= 0.1) diffs.push({ idx: i + 1, diff: d })
    }
  }

  const canAdjust = !notchMismatch && ncA >= 1 && diffs.length > 0

  return (
    <div className="nahtzugabe-dialog-overlay" onClick={() => setSeamAdjustmentDialog(null)}>
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
            onClick={() => setSeamAdjustmentDialog(null)}
          >
            Nicht anpassen
          </button>
        </div>

        <div style={{ marginTop: '1rem', borderTop: '1px solid #eee', paddingTop: '0.6rem' }}>
          <div style={{ fontSize: '0.8125rem', color: '#555', marginBottom: '0.5rem' }}>
            Ecken der Nahtzugabe an dieser Naht bündig machen (beide Teile)?
          </div>
          <div className="nahtzugabe-dialog-actions" style={{ flexDirection: 'column', gap: '0.35rem' }}>
            <button
              style={{
                padding: '0.45rem 0.75rem',
                fontSize: '0.8125rem',
                border: '1px solid #ccc',
                borderRadius: 4,
                background: '#1976d2',
                color: '#fff',
                cursor: 'pointer',
              }}
              onClick={() => adjustSeamCorners(seamAdjustmentDialog)}
            >
              Ecken anpassen (beide Teile)
            </button>
            <button
              style={{
                padding: '0.45rem 0.75rem',
                fontSize: '0.8125rem',
                border: '1px solid #ccc',
                borderRadius: 4,
                background: '#fff',
                color: '#333',
                cursor: 'pointer',
              }}
              onClick={() => setSeamAdjustmentDialog(null)}
            >
              Ecken nicht anpassen
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
