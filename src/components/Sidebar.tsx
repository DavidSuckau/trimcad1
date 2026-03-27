import { useStore } from '../store/useStore'

export function Sidebar() {
  const { workspace, selectedPieceIds, addPiece, selectPiece, deletePiece, setPiecePropertiesDialogPieceId } = useStore()
  const { pieces } = workspace

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
              <span
                className="piece-name"
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  setPiecePropertiesDialogPieceId(p.id)
                }}
                title="Doppelklick: Teil-Eigenschaften (Name, Nummer, Füllung …)"
              >
                {p.name}
              </span>
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
    </aside>
  )
}
