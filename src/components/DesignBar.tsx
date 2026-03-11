import { useStore } from '../store/useStore'

export function DesignBar() {
  const {
    showGrid, setShowGrid,
    showPoints, setShowPoints,
    showGrain, setShowGrain,
    showNotches, setShowNotches,
    showDrills, setShowDrills,
    showInternalLines, setShowInternalLines,
    showPieceNames, setShowPieceNames,
  } = useStore()

  const items: { label: string; checked: boolean; toggle: (v: boolean) => void }[] = [
    { label: 'Raster', checked: showGrid, toggle: setShowGrid },
    { label: 'Punkte', checked: showPoints, toggle: setShowPoints },
    { label: 'Laufrichtung', checked: showGrain, toggle: setShowGrain },
    { label: 'Kerben', checked: showNotches, toggle: setShowNotches },
    { label: 'Bohrungen', checked: showDrills, toggle: setShowDrills },
    { label: 'Interne Linien', checked: showInternalLines, toggle: setShowInternalLines },
    { label: 'Teilnamen', checked: showPieceNames, toggle: setShowPieceNames },
  ]

  return (
    <footer className="design-bar">
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
