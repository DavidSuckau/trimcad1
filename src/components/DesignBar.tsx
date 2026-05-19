import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { useShallow } from 'zustand/react/shallow'

type DisplayToggle = {
  label: string
  checked: boolean
  toggle: (v: boolean) => void
}

type DisplaySection = {
  title: string
  items: DisplayToggle[]
}

function EyeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function ChevronUpIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.5 7.5 6 4l3.5 3.5" />
    </svg>
  )
}

export function DesignBar() {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const popoverId = useId()

  const {
    contourEditEnabled,
    setContourEditEnabled,
    showGrid,
    setShowGrid,
    showPoints,
    setShowPoints,
    showGrain,
    setShowGrain,
    showNotches,
    setShowNotches,
    showDrills,
    setShowDrills,
    showInternalLines,
    setShowInternalLines,
    showPieceNames,
    setShowPieceNames,
    showProfiles,
    setShowProfiles,
    showContourMeasurements,
    setShowContourMeasurements,
    showWorkspaceNotes,
    setShowWorkspaceNotes,
    showContourChangePreview,
    setShowContourChangePreview,
    showLiveBomCost,
    setShowLiveBomCost,
    showSeamPruefanzeigen,
    setShowSeamPruefanzeigen,
  } = useStore(
    useShallow((s) => ({
      contourEditEnabled: s.contourEditEnabled,
      setContourEditEnabled: s.setContourEditEnabled,
      showGrid: s.showGrid,
      setShowGrid: s.setShowGrid,
      showPoints: s.showPoints,
      setShowPoints: s.setShowPoints,
      showGrain: s.showGrain,
      setShowGrain: s.setShowGrain,
      showNotches: s.showNotches,
      setShowNotches: s.setShowNotches,
      showDrills: s.showDrills,
      setShowDrills: s.setShowDrills,
      showInternalLines: s.showInternalLines,
      setShowInternalLines: s.setShowInternalLines,
      showPieceNames: s.showPieceNames,
      setShowPieceNames: s.setShowPieceNames,
      showProfiles: s.showProfiles,
      setShowProfiles: s.setShowProfiles,
      showContourMeasurements: s.showContourMeasurements,
      setShowContourMeasurements: s.setShowContourMeasurements,
      showWorkspaceNotes: s.showWorkspaceNotes,
      setShowWorkspaceNotes: s.setShowWorkspaceNotes,
      showContourChangePreview: s.showContourChangePreview,
      setShowContourChangePreview: s.setShowContourChangePreview,
      showLiveBomCost: s.showLiveBomCost,
      setShowLiveBomCost: s.setShowLiveBomCost,
      showSeamPruefanzeigen: s.showSeamPruefanzeigen,
      setShowSeamPruefanzeigen: s.setShowSeamPruefanzeigen,
    })),
  )

  const sections: DisplaySection[] = [
    {
      title: 'Bearbeitung',
      items: [{ label: 'Kontur bearbeiten', checked: contourEditEnabled, toggle: setContourEditEnabled }],
    },
    {
      title: 'Ebenen',
      items: [
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
      ],
    },
    {
      title: 'Erweitert',
      items: [
        { label: 'Naht-Prüfanzeigen', checked: showSeamPruefanzeigen, toggle: setShowSeamPruefanzeigen },
        { label: 'Kontur: Vorher', checked: showContourChangePreview, toggle: setShowContourChangePreview },
        { label: 'Kosten live', checked: showLiveBomCost, toggle: setShowLiveBomCost },
      ],
    },
  ]

  const activeCount = sections.reduce((n, sec) => n + sec.items.filter((i) => i.checked).length, 0)
  const totalCount = sections.reduce((n, sec) => n + sec.items.length, 0)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const el = wrapRef.current
      if (el && !el.contains(e.target as Node)) close()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  return (
    <footer className="design-bar" role="toolbar" aria-label="Anzeige">
      <div className="design-bar-display-wrap" ref={wrapRef}>
        <button
          type="button"
          className={`design-bar-display-btn${open ? ' design-bar-display-btn--open' : ''}`}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls={popoverId}
          onClick={() => setOpen((v) => !v)}
          aria-label={`Anzeige, ${activeCount} von ${totalCount} Optionen aktiv`}
        >
          <EyeIcon />
          <span>Anzeige</span>
          <span className="design-bar-display-count">
            {activeCount}/{totalCount}
          </span>
          <ChevronUpIcon />
        </button>

        {open ? (
          <div
            id={popoverId}
            className="design-bar-popover"
            role="dialog"
            aria-label="Anzeige-Optionen"
          >
            {sections.map((section, sectionIndex) => (
              <div key={section.title} className="design-bar-popover-section">
                <div className="design-bar-popover-section-title">{section.title}</div>
                <ul className="design-bar-popover-list">
                  {section.items.map((item) => (
                    <li key={item.label}>
                      <label className="design-bar-popover-item">
                        <input
                          type="checkbox"
                          checked={item.checked}
                          onChange={(e) => item.toggle(e.target.checked)}
                        />
                        <span>{item.label}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                {sectionIndex < sections.length - 1 ? (
                  <div className="design-bar-popover-divider" role="presentation" />
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <span className="design-bar-hint">Ebenen und Optionen für die Arbeitsfläche</span>
    </footer>
  )
}
