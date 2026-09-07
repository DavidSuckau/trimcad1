import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'

export function SchrumpfenModal() {
  const pieceId = useStore((s) => s.schrumpfenDialogPieceId)
  const setSchrumpfenDialogPieceId = useStore((s) => s.setSchrumpfenDialogPieceId)
  const applySchrumpfenPercent = useStore((s) => s.applySchrumpfenPercent)
  const piece = useStore((s) =>
    pieceId ? s.workspace.pieces.find((p) => p.id === pieceId) ?? null : null,
  )
  const [percentStr, setPercentStr] = useState('0')

  useEffect(() => {
    if (pieceId) setPercentStr('0')
  }, [pieceId])

  if (!pieceId || !piece) return null

  const parsed = Number.parseFloat(percentStr.replace(',', '.'))
  const factor = Number.isFinite(parsed) ? 1 + parsed / 100 : NaN
  const factorOk = Number.isFinite(factor) && factor > 0

  return (
    <div
      className="nahtzugabe-dialog-overlay"
      onClick={() => setSchrumpfenDialogPieceId(null)}
      role="dialog"
      aria-modal="true"
      aria-label="Schrumpfen"
    >
      <div className="nahtzugabe-dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 300 }}>
        <h3 className="nahtzugabe-dialog-title">Schrumpfen</h3>
        <div style={{ fontSize: '0.8125rem', color: '#333', marginBottom: '0.75rem', lineHeight: 1.5 }}>
          Teil: <strong>{piece.name || piece.number || piece.id}</strong>
          <div style={{ marginTop: 6, color: '#666', fontSize: '0.75rem' }}>
            Aktuelle Größe = 100 %. Positiv = größer (z. B. 2 → +2 %), negativ = kleiner (z. B. −2 → −2 %).
          </div>
        </div>
        <label style={{ display: 'block', fontSize: '0.8125rem', color: '#333', marginBottom: 6 }}>
          Änderung (%)
        </label>
        <input
          type="number"
          step={0.1}
          value={percentStr}
          autoFocus
          onChange={(e) => setPercentStr(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && factorOk) {
              e.preventDefault()
              applySchrumpfenPercent(parsed)
            }
          }}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '6px 8px',
            border: '1px solid #ccc',
            borderRadius: 4,
            fontSize: 14,
            marginBottom: '0.5rem',
          }}
        />
        <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '1rem' }}>
          {factorOk
            ? `Ergebnis: ${(factor * 100).toFixed(2)} % der aktuellen Größe (Faktor ${factor.toFixed(4)})`
            : 'Ungültig: Ergebnisgröße muss größer als 0 % sein.'}
        </div>
        <div className="nahtzugabe-dialog-actions" style={{ justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button
            type="button"
            style={{
              padding: '0.5rem 0.75rem',
              fontSize: '0.8125rem',
              border: '1px solid #ccc',
              borderRadius: 4,
              background: '#fff',
              color: '#333',
              cursor: 'pointer',
            }}
            onClick={() => setSchrumpfenDialogPieceId(null)}
          >
            Abbrechen
          </button>
          <button
            type="button"
            disabled={!factorOk}
            style={{
              padding: '0.5rem 0.75rem',
              fontSize: '0.8125rem',
              border: '1px solid #1976d2',
              borderRadius: 4,
              background: factorOk ? '#1976d2' : '#9e9e9e',
              color: '#fff',
              cursor: factorOk ? 'pointer' : 'default',
            }}
            onClick={() => applySchrumpfenPercent(parsed)}
          >
            Anwenden
          </button>
        </div>
      </div>
    </div>
  )
}
