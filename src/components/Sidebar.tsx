import { useStore } from '../store/useStore'
import { useShallow } from 'zustand/react/shallow'

function ChevronLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8.5 3.5L5 7l3.5 3.5" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5.5 3.5L9 7l-3.5 3.5" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

export function Sidebar() {
  const { workspace, selectedPieceIds, addPiece, selectPiece, deletePiece, setPiecePropertiesDialogPieceId, sidebarCollapsed, setSidebarCollapsed } =
    useStore(
      useShallow((s) => ({
        workspace: s.workspace,
        selectedPieceIds: s.selectedPieceIds,
        addPiece: s.addPiece,
        selectPiece: s.selectPiece,
        deletePiece: s.deletePiece,
        setPiecePropertiesDialogPieceId: s.setPiecePropertiesDialogPieceId,
        sidebarCollapsed: s.sidebarCollapsed,
        setSidebarCollapsed: s.setSidebarCollapsed,
      }))
    )
  const { pieces } = workspace

  return (
    <aside className={`sidebar${sidebarCollapsed ? ' sidebar--collapsed' : ''}`} aria-label="Teileliste">
      {sidebarCollapsed ? (
        <button
          type="button"
          className="sidebar-expand-btn"
          title="Teileliste einblenden"
          aria-expanded={false}
          onClick={() => setSidebarCollapsed(false)}
        >
          <ChevronRightIcon />
        </button>
      ) : (
        <>
          <div className="sidebar-header-row">
            <h2 className="sidebar-heading" id="sidebar-teile-heading">
              Teile
            </h2>
            <button
              type="button"
              className="sidebar-collapse-btn"
              title="Teileliste ausblenden (mehr Platz für die Arbeitsfläche)"
              aria-expanded={true}
              aria-controls="sidebar-piece-list-panel"
              onClick={() => setSidebarCollapsed(true)}
            >
              <ChevronLeftIcon />
            </button>
          </div>
          <div className="sidebar-section" id="sidebar-piece-list-panel" role="region" aria-labelledby="sidebar-teile-heading">
            <div className="piece-list-card">
              <ul className="piece-list">
                {pieces.map((p) => (
                  <li
                    key={p.id}
                    className={`piece-item ${selectedPieceIds.includes(p.id) ? 'selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-selected={selectedPieceIds.includes(p.id)}
                    onClick={() => selectPiece(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        selectPiece(p.id)
                      }
                    }}
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
                      <TrashIcon />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <button type="button" className="sidebar-btn sidebar-btn--add" onClick={() => addPiece()}>
              + Teil hinzufügen
            </button>
          </div>
        </>
      )}
    </aside>
  )
}
