import { useState, useRef, useEffect } from 'react'
import { useStore } from '../store/useStore'

export function Sidebar() {
  const { workspace, selectedPieceIds, addPiece, selectPiece, deletePiece, updatePiece } = useStore()
  const { pieces } = workspace
  const selectedPiece = selectedPieceIds.length === 1 ? pieces.find((p) => p.id === selectedPieceIds[0]) : null
  const [editingNamePieceId, setEditingNamePieceId] = useState<string | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingNamePieceId) editInputRef.current?.focus()
  }, [editingNamePieceId])

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <h2 className="sidebar-heading">Teile</h2>
        <ul className="piece-list">
          {pieces.map((p) => (
            <li
              key={p.id}
              className={`piece-item ${selectedPieceIds.includes(p.id) ? 'selected' : ''}`}
              onClick={() => selectPiece(p.id)}
            >
              <span className="piece-number">{p.number}</span>
              {editingNamePieceId === p.id ? (
                <input
                  ref={editInputRef}
                  type="text"
                  className="piece-name-input"
                  value={p.name}
                  onChange={(e) => updatePiece(p.id, { name: e.target.value })}
                  onBlur={() => setEditingNamePieceId(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setEditingNamePieceId(null)
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  className="piece-name"
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    setEditingNamePieceId(p.id)
                  }}
                >
                  {p.name}
                </span>
              )}
              <button
                type="button"
                className="piece-delete"
                onClick={(e) => {
                  e.stopPropagation()
                  deletePiece(p.id)
                }}
                aria-label="Teil löschen"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="sidebar-btn" onClick={() => addPiece()}>
          + Teil hinzufügen
        </button>
      </div>
      {selectedPiece && (
        <div className="sidebar-section">
          <h2 className="sidebar-heading">Teil bearbeiten</h2>
          <label className="sidebar-label">
            <span>Teilnummer</span>
            <input
              type="text"
              className="sidebar-input"
              value={selectedPiece.number}
              onChange={(e) => updatePiece(selectedPiece.id, { number: e.target.value })}
            />
          </label>
        </div>
      )}
    </aside>
  )
}
