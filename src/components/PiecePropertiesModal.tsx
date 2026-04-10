import { useEffect, useState, useMemo } from 'react'
import { useStore } from '../store/useStore'
import { enumerateEdges } from '../geometry/edgeEnumeration'
import { edgeTotalLength } from '../geometry/seamUtils'
import { useFocusTrap } from '../hooks/useFocusTrap'

export function PiecePropertiesModal() {
  const {
    workspace,
    piecePropertiesDialogPieceId,
    setPiecePropertiesDialogPieceId,
    updatePiece,
    removeSeamAllowance,
    setEdgeSeamAllowance,
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

  const trapRef = useFocusTrap<HTMLDivElement>()

  if (!piecePropertiesDialogPieceId || !piece) return null

  const fillOn = piece.fillInterior !== false

  return (
    <div
      className="nahtzugabe-dialog-overlay"
      onClick={() => setPiecePropertiesDialogPieceId(null)}
      role="dialog"
      aria-modal="true"
      aria-label="Teil-Eigenschaften"
    >
      <div className="nahtzugabe-dialog" style={{ minWidth: 320 }} onClick={(e) => e.stopPropagation()} ref={trapRef}>
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

        {piece.seamAllowanceMm != null && piece.seamLine.length >= 3 && (
          <EdgeSeamAllowanceSection
            piece={piece}
            defaultAllowance={piece.seamAllowanceMm}
            onSetEdgeAllowance={(edgeIndex, mm) => setEdgeSeamAllowance(piece.id, edgeIndex, mm)}
          />
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

import type { PatternPiece } from '../types/model'

function EdgeSeamAllowanceSection({
  piece,
  defaultAllowance,
  onSetEdgeAllowance,
}: {
  piece: PatternPiece
  defaultAllowance: number
  onSetEdgeAllowance: (edgeIndex: number, mm: number) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const edges = useMemo(() => enumerateEdges(piece), [piece])
  const overrideMap = useMemo(() => {
    const m = new Map<number, number>()
    for (const o of piece.edgeSeamAllowances ?? []) m.set(o.edgeIndex, o.allowanceMm)
    return m
  }, [piece.edgeSeamAllowances])

  if (edges.length === 0) return null

  return (
    <fieldset style={{ border: 'none', margin: '12px 0 0', padding: 0 }}>
      <legend
        className="nahtzugabe-dialog-label"
        style={{ marginBottom: 8, padding: 0, cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? '▾' : '▸'} Nahtzugabe pro Kante
        {(piece.edgeSeamAllowances?.length ?? 0) > 0 && (
          <span style={{ fontSize: 11, color: '#888', marginLeft: 6 }}>
            ({piece.edgeSeamAllowances!.length} Override{piece.edgeSeamAllowances!.length > 1 ? 's' : ''})
          </span>
        )}
      </legend>
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          {edges.map((edge) => {
            const lengthMm = edgeTotalLength(piece, edge.curveIndices)
            const currentMm = overrideMap.get(edge.edgeIndex) ?? defaultAllowance
            const isOverridden = overrideMap.has(edge.edgeIndex)
            return (
              <EdgeAllowanceRow
                key={edge.edgeIndex}
                edgeIndex={edge.edgeIndex}
                lengthMm={lengthMm}
                currentMm={currentMm}
                defaultMm={defaultAllowance}
                isOverridden={isOverridden}
                onChange={(mm) => onSetEdgeAllowance(edge.edgeIndex, mm)}
              />
            )
          })}
        </div>
      )}
    </fieldset>
  )
}

function EdgeAllowanceRow({
  edgeIndex,
  lengthMm,
  currentMm,
  defaultMm,
  isOverridden,
  onChange,
}: {
  edgeIndex: number
  lengthMm: number
  currentMm: number
  defaultMm: number
  isOverridden: boolean
  onChange: (mm: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [inputVal, setInputVal] = useState(String(currentMm))

  const handleCommit = () => {
    const parsed = parseFloat(inputVal)
    if (Number.isFinite(parsed) && parsed >= 0) {
      onChange(parsed)
    }
    setEditing(false)
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 0',
        fontWeight: isOverridden ? 600 : 400,
        color: isOverridden ? '#1a6fb5' : undefined,
      }}
    >
      <span style={{ minWidth: 70, fontSize: 12 }}>
        Kante {edgeIndex + 1}
      </span>
      <span style={{ fontSize: 11, color: '#888', minWidth: 55 }}>
        ({lengthMm.toFixed(1)} mm)
      </span>
      {editing ? (
        <input
          type="number"
          className="nahtzugabe-dialog-input"
          style={{ width: 60, padding: '2px 4px', fontSize: 12 }}
          value={inputVal}
          min={0}
          step={0.5}
          autoFocus
          onChange={(e) => setInputVal(e.target.value)}
          onBlur={handleCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCommit()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <span
          style={{ cursor: 'pointer', minWidth: 40, textAlign: 'right' }}
          onClick={() => {
            setInputVal(String(currentMm))
            setEditing(true)
          }}
        >
          {currentMm} mm
        </span>
      )}
      {isOverridden && (
        <button
          type="button"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 11,
            color: '#888',
            padding: '0 2px',
          }}
          title={`Auf Standard zurücksetzen (${defaultMm} mm)`}
          onClick={() => onChange(defaultMm)}
        >
          ✕
        </button>
      )}
    </div>
  )
}
