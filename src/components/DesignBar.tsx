import { useStore } from '../store/useStore'
import { useShallow } from 'zustand/react/shallow'

export function DesignBar() {
  const {
    contourEditEnabled, setContourEditEnabled,
    showGrid, setShowGrid,
    showPoints, setShowPoints,
    showGrain, setShowGrain,
    showNotches, setShowNotches,
    showDrills, setShowDrills,
    showInternalLines, setShowInternalLines,
    showPieceNames, setShowPieceNames,
    showProfiles, setShowProfiles,
    showContourMeasurements, setShowContourMeasurements,
    showWorkspaceNotes, setShowWorkspaceNotes,
  } = useStore(useShallow((s) => ({
    contourEditEnabled: s.contourEditEnabled,
    setContourEditEnabled: s.setContourEditEnabled,
    showGrid: s.showGrid, setShowGrid: s.setShowGrid,
    showPoints: s.showPoints, setShowPoints: s.setShowPoints,
    showGrain: s.showGrain, setShowGrain: s.setShowGrain,
    showNotches: s.showNotches, setShowNotches: s.setShowNotches,
    showDrills: s.showDrills, setShowDrills: s.setShowDrills,
    showInternalLines: s.showInternalLines, setShowInternalLines: s.setShowInternalLines,
    showPieceNames: s.showPieceNames, setShowPieceNames: s.setShowPieceNames,
    showProfiles: s.showProfiles, setShowProfiles: s.setShowProfiles,
    showContourMeasurements: s.showContourMeasurements, setShowContourMeasurements: s.setShowContourMeasurements,
    showWorkspaceNotes: s.showWorkspaceNotes, setShowWorkspaceNotes: s.setShowWorkspaceNotes,
  })))

  const items: { label: string; checked: boolean; toggle: (v: boolean) => void }[] = [
    { label: 'Kontur bearbeiten', checked: contourEditEnabled, toggle: setContourEditEnabled },
    { label: 'Raster', checked: showGrid, toggle: setShowGrid },
    { label: 'Punkte', checked: showPoints, toggle: setShowPoints },
    { label: 'Laufrichtung', checked: showGrain, toggle: setShowGrain },
    { label: 'Kerben', checked: showNotches, toggle: setShowNotches },
    { label: 'Bohrungen', checked: showDrills, toggle: setShowDrills },
    { label: 'Interne Linien', checked: showInternalLines, toggle: setShowInternalLines },
    { label: 'Teilnamen', checked: showPieceNames, toggle: setShowPieceNames },
    { label: 'Profile', checked: showProfiles, toggle: setShowProfiles },
    { label: 'Konturmaße', checked: showContourMeasurements, toggle: setShowContourMeasurements },
    { label: 'Notizen', checked: showWorkspaceNotes, toggle: setShowWorkspaceNotes },
  ]

  return (
    <footer className="design-bar" role="toolbar" aria-label="Anzeige-Optionen">
      {items.map((item) => (
        <label key={item.label} className="design-bar-item">
          <input
            type="checkbox"
            checked={item.checked}
            onChange={(e) => item.toggle(e.target.checked)}
          />
          <span>{item.label}</span>
        </label>
      ))}
    </footer>
  )
}
