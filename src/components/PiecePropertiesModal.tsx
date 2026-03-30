import { useEffect } from 'react'
import { useStore } from '../store/useStore'

export function PiecePropertiesModal() {
  const {
    workspace,
    piecePropertiesDialogPieceId,
    setPiecePropertiesDialogPieceId,
    updatePiece,
    removeSeamAllowance,
  } = useStore()

  const piece =
    piecePropertiesDialogPieceId != null
      ? workspace.pieces.find((p) => p.id === piecePropertiesDialogPieceId)
      : null

  useEffect(() => {
    if (piecePropertiesDialogPieceId && !piece) {
      setPiecePropertiesDialogPieceId(null)
    }
  }, [piecePropertiesDialogPieceId, piece, setPiecePropertiesDialogPieceId])

  if (!piecePropertiesDialogPieceId || !piece) return null

  const fillOn = piece.fillInterior !== false

  return (
    <div
      className="nahtzugabe-dialog-overlay"
      onClick={() => setPiecePropertiesDialogPieceId(null)}
      role="presentation"
    >
      <div className="nahtzugabe-dialog" style={{ minWidth: 320 }} onClick={(e) => e.stopPropagation()}>
        <h3 className="nahtzugabe-dialog-title">Teil-Eigenschaften</h3>

        <label className="nahtzugabe-dialog-label">
          <span>Teilnummer</span>
          <input
            type="text"
            className="nahtzugabe-dialog-input"
            style={{ width: '100%', boxSizing: 'border-box' }}
            value={piece.number}
            onChange={(e) => updatePiece(piece.id, { number: e.target.value })}
            autoComplete="off"
          />
        </label>

        <label className="nahtzugabe-dialog-label">
          <span>Teilename</span>
          <input
            type="text"
            className="nahtzugabe-dialog-input"
            style={{ width: '100%', boxSizing: 'border-box' }}
            value={piece.name}
            onChange={(e) => updatePiece(piece.id, { name: e.target.value })}
            autoComplete="off"
          />
        </label>

        <label className="nahtzugabe-dialog-label">
          <span>Material (Stückliste)</span>
          <input
            type="text"
            className="nahtzugabe-dialog-input"
            style={{ width: '100%', boxSizing: 'border-box' }}
            value={piece.material ?? ''}
            onChange={(e) => updatePiece(piece.id, { material: e.target.value })}
            placeholder="z. B. Baumwolle"
            autoComplete="off"
          />
        </label>

        {piece.seamAllowanceMm != null && (
          <div
            className="nahtzugabe-dialog-label"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}
          >
            <span>
              Nahtzugabe: <strong>{piece.seamAllowanceMm}</strong> mm
            </span>
            <button
              type="button"
              className="sidebar-btn"
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={() => removeSeamAllowance(piece.id)}
            >
              Nahtzugabe entfernen
            </button>
          </div>
        )}

        <fieldset style={{ border: 'none', margin: '12px 0 0', padding: 0 }}>
          <legend className="nahtzugabe-dialog-label" style={{ marginBottom: 8, padding: 0 }}>
            Fläche auf der Arbeitsfläche
          </legend>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="radio"
                name="fillInterior"
                checked={fillOn}
                onChange={() => updatePiece(piece.id, { fillInterior: true })}
              />
              <span>
                <strong>Mit Füllung</strong> (hellgelb, wie bisher)
              </span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="radio"
                name="fillInterior"
                checked={!fillOn}
                onChange={() => updatePiece(piece.id, { fillInterior: false })}
              />
              <span>
                <strong>Ohne Füllung</strong> (transparent, nur Kontur)
              </span>
            </label>
          </div>
        </fieldset>

        <div className="nahtzugabe-dialog-actions" style={{ marginTop: 16 }}>
          <button type="button" className="sidebar-btn primary" onClick={() => setPiecePropertiesDialogPieceId(null)}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  )
}
