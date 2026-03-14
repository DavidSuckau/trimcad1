import { useState, useRef, useEffect } from 'react'
import { useStore } from '../store/useStore'
import { downloadDxf } from '../dxf/dxfWriter'
import { downloadAamaDxf } from '../dxf/aamaWriter'
import { downloadAstmDxf } from '../dxf/astmWriter'
import { importDxfFromString } from '../dxf/dxfImporter'
import { validateSeamAllowance } from '../geometry/offset'
import { SettingsModal } from './SettingsModal'
import { SeamAdjustmentModal } from './SeamAdjustmentModal'

type ToolId = 'select' | 'pan' | 'line' | 'bezier' | 'notch' | 'drill' | 'rectangle'
type MenuId = 'datei' | 'erzeugen' | 'bearbeiten' | 'naht' | 'material' | 'stueckliste' | 'pruefen' | 'hilfe' | null

const NAHTZUGABE_MM = 5
const VIEWBOX_CX = 400
const VIEWBOX_CY = 300

export function Toolbar() {
  const {
    tool,
    setTool,
    showGrid,
    setShowGrid,
    showPoints,
    setShowPoints,
    rulerMode,
    setRulerMode,
    setRulerLine,
    addPiece,
    workspace,
    setView,
    selectedPieceIds,
    applyOffset,
    removeSeamAllowance,
    rotatePiece90,
    alignPieceToGrain,
    pendingNahtzugabeClick: _pendingNahtzugabeClick,
    setPendingNahtzugabeClick,
    nahtzugabeDialogPieceId,
    setNahtzugabeDialogPieceId,
    nahtzuordnungMode,
    setNahtzuordnungMode,
    setShowSettingsModal,
    setShowHelpModal,
    dxfExportScale,
    startDigitize,
    setToastMessage,
  } = useStore()
  const [nahtzugabeMm, setNahtzugabeMm] = useState('8')
  const { view } = workspace
  const [openMenu, setOpenMenu] = useState<MenuId>(null)
  const [erzeugenSubmenu, setErzeugenSubmenu] = useState<'interne-elemente' | null>(null)
  const [bearbeitenSubmenu, setBearbeitenSubmenu] = useState<'kante' | null>(null)
  const [nahtSubmenu, setNahtSubmenu] = useState<'nahtecken' | null>(null)
  const [dateiSubmenu, setDateiSubmenu] = useState<'exportieren' | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const dxfImportInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
        setErzeugenSubmenu(null)
        setBearbeitenSubmenu(null)
        setNahtSubmenu(null)
      }
    }
    if (openMenu) {
      document.addEventListener('mousedown', handleClickOutside, true)
      return () => document.removeEventListener('mousedown', handleClickOutside, true)
    }
  }, [openMenu])

  useEffect(() => {
    if (openMenu !== 'datei') setDateiSubmenu(null)
    if (openMenu !== 'erzeugen') setErzeugenSubmenu(null)
    if (openMenu !== 'bearbeiten') setBearbeitenSubmenu(null)
    if (openMenu !== 'naht') setNahtSubmenu(null)
  }, [openMenu])

  const closeMenu = () => setOpenMenu(null)

  const handleExportDxf = () => {
    downloadDxf(workspace, dxfExportScale)
    closeMenu()
  }

  const handleExportAama = () => {
    downloadAamaDxf(workspace, dxfExportScale)
    closeMenu()
  }

  const handleExportAstm = () => {
    downloadAstmDxf(workspace, dxfExportScale)
    closeMenu()
  }

  const handleImportDxf = () => {
    dxfImportInputRef.current?.click()
    closeMenu()
  }

  const handleDxfFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    closeMenu()
    const reader = new FileReader()
    reader.onerror = () => setToastMessage('error:Datei konnte nicht gelesen werden')
    reader.onload = () => {
      try {
        const content = reader.result as string
        const result = importDxfFromString(content)
        if (result.error) {
          setToastMessage('error:' + result.error)
        } else if (result.pieces.length > 0) {
          for (const piece of result.pieces) {
            addPiece(piece)
          }
          setToastMessage('success:' + result.pieces.length + ' Schnittteil(e) importiert')
        } else {
          setToastMessage('error:Keine Schnittteile in der DXF-Datei gefunden')
        }
      } catch (err) {
        setToastMessage('error:' + (err instanceof Error ? err.message : 'Import-Fehler'))
      }
    }
    reader.readAsText(file, 'UTF-8')
  }

  const handleErzeugen = (
    action: 'rectangle' | 'addPiece' | 'point' | 'curvepoint' | 'line' | 'circle' | 'drill' | 'steppung' | 'notch' | 'kante'
  ) => {
    if (action === 'rectangle') setTool('rectangle')
    if (action === 'point') setTool('point')
    if (action === 'curvepoint') setTool('curvepoint')
    if (action === 'addPiece') addPiece()
    if (action === 'line') setTool('internalLine')
    if (action === 'drill') setTool('drill')
    if (action === 'circle') setTool('internalCircle')
    if (action === 'steppung') setTool('internalLine')
    if (action === 'notch') setTool('notch')
    if (action === 'kante') setTool('kante')
    closeMenu()
    setErzeugenSubmenu(null)
  }

  const handleBearbeiten = (action: ToolId | 'nahtzugabe') => {
    if (action === 'nahtzugabe') {
      selectedPieceIds.forEach((id) => applyOffset(id, NAHTZUGABE_MM))
    } else {
      setTool(action)
    }
    closeMenu()
  }

  const handlePruefen = (action: 'geschlossen' | 'alle') => {
    if (action === 'geschlossen') {
      const piece = selectedPieceIds.length === 1 ? workspace.pieces.find((p) => p.id === selectedPieceIds[0]) : null
      if (!piece) {
        alert('Bitte genau ein Teil auswählen.')
      } else if (piece.cutLine.length < 3) {
        alert('Teil hat keine geschlossene Kontur.')
      } else {
        alert('Teil hat eine geschlossene Kontur.')
      }
    }
    if (action === 'alle') {
      const n = workspace.pieces.length
      const closed = workspace.pieces.filter((p) => p.cutLine.length >= 3).length
      alert(`${closed} von ${n} Teilen haben eine geschlossene Kontur.`)
    }
    closeMenu()
  }

  const handleZoomIn = () => {
    const newZoom = Math.min(10, view.zoom * 1.25)
    setView({
      zoom: newZoom,
      panX: VIEWBOX_CX - ((VIEWBOX_CX - view.panX) / view.zoom) * newZoom,
      panY: VIEWBOX_CY - ((VIEWBOX_CY - view.panY) / view.zoom) * newZoom,
    })
  }
  const handleZoomOut = () => {
    const newZoom = Math.max(0.1, view.zoom / 1.25)
    setView({
      zoom: newZoom,
      panX: VIEWBOX_CX - ((VIEWBOX_CX - view.panX) / view.zoom) * newZoom,
      panY: VIEWBOX_CY - ((VIEWBOX_CY - view.panY) / view.zoom) * newZoom,
    })
  }

  return (
    <header className="menubar" ref={menuRef}>
      <input
        ref={dxfImportInputRef}
        type="file"
        accept=".dxf"
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
        onChange={handleDxfFileChange}
      />
      <img src="/logo-trimcad.png" alt="TrimCAD" className="menubar-logo" />
      <nav className="menubar-nav">
        <div className="menubar-item-wrap">
          <button
            type="button"
            className="menubar-item"
            aria-expanded={openMenu === 'datei'}
            onClick={() => setOpenMenu(openMenu === 'datei' ? null : 'datei')}
          >
            Datei
          </button>
          {openMenu === 'datei' && (
            <ul className="menubar-dropdown">
              <li>
                <button type="button" className="menubar-dropdown-btn" onClick={handleImportDxf}>
                  DXF importieren …
                </button>
              </li>
              <li
                className="menubar-submenu-wrap"
                onMouseEnter={() => setDateiSubmenu('exportieren')}
                onMouseLeave={() => setDateiSubmenu(null)}
              >
                <span className="menubar-dropdown-btn menubar-dropdown-btn-submenu">Exportieren</span>
                {dateiSubmenu === 'exportieren' && (
                  <ul className="menubar-dropdown menubar-submenu">
                    <li>
                      <button type="button" className="menubar-dropdown-btn" onClick={handleExportDxf}>
                        DXF (einfach)
                      </button>
                    </li>
                    <li>
                      <button type="button" className="menubar-dropdown-btn" onClick={handleExportAama}>
                        AAMA-DXF (.aam)
                      </button>
                    </li>
                    <li>
                      <button type="button" className="menubar-dropdown-btn" onClick={handleExportAstm}>
                        ASTM-DXF (Gerber)
                      </button>
                    </li>
                  </ul>
                )}
              </li>
              <li>
                <button
                  type="button"
                  className="menubar-dropdown-btn"
                  onClick={() => {
                    setShowGrid(!showGrid)
                    closeMenu()
                  }}
                >
                  {showGrid ? 'Raster ausblenden' : 'Raster einblenden'}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="menubar-dropdown-btn"
                  onClick={() => {
                    setShowSettingsModal(true)
                    closeMenu()
                  }}
                >
                  Einstellungen
                </button>
              </li>
            </ul>
          )}
        </div>
        <div className="menubar-item-wrap">
          <button
            type="button"
            className="menubar-item"
            aria-expanded={openMenu === 'erzeugen'}
            onClick={() => setOpenMenu(openMenu === 'erzeugen' ? null : 'erzeugen')}
          >
            Erzeugen
          </button>
          {openMenu === 'erzeugen' && (
            <ul className="menubar-dropdown">
              <li>
                <button
                  type="button"
                  className={`menubar-dropdown-btn ${tool === 'digitize' ? 'active' : ''}`}
                  onClick={() => {
                    setTool('digitize')
                    startDigitize()
                    closeMenu()
                  }}
                >
                  Digitalisieren <span className="menubar-shortcut">D</span>
                </button>
              </li>
              <li className="menubar-separator" />
              <li>
                <button type="button" className="menubar-dropdown-btn" onClick={() => handleErzeugen('rectangle')}>
                  Rechteck
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="menubar-dropdown-btn"
                  onClick={() => handleErzeugen('point')}
                  title="Punkt auf der Kontur einfügen (blauer Punkt)"
                >
                  Punkt <span className="menubar-shortcut">P</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="menubar-dropdown-btn"
                  onClick={() => handleErzeugen('curvepoint')}
                  title="Punkt einfügen oder Linie in Kurve umwandeln (Klick auf Linie = Bézier, Klick auf Kurve = Punkt)"
                >
                  Kurvenpunkt <span className="menubar-shortcut">C</span>
                </button>
              </li>
              <li>
                <button type="button" className="menubar-dropdown-btn" onClick={() => handleErzeugen('notch')}>
                  Notch <span className="menubar-shortcut">N</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`menubar-dropdown-btn ${tool === 'kante' ? 'active' : ''}`}
                  onClick={() => handleErzeugen('kante')}
                >
                  Kante <span className="menubar-shortcut">K</span>
                </button>
              </li>
              <li
                className="menubar-submenu-wrap"
                onMouseEnter={() => setErzeugenSubmenu('interne-elemente')}
                onMouseLeave={() => setErzeugenSubmenu(null)}
              >
                <span className="menubar-dropdown-btn menubar-dropdown-btn-submenu">Interne Elemente</span>
                {erzeugenSubmenu === 'interne-elemente' && (
                  <ul className="menubar-dropdown menubar-submenu">
                    <li>
                      <button
                        type="button"
                        className="menubar-dropdown-btn"
                        onClick={() => handleErzeugen('line')}
                      >
                        Linie
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        className="menubar-dropdown-btn"
                        onClick={() => handleErzeugen('circle')}
                      >
                        Kreis
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        className="menubar-dropdown-btn"
                        onClick={() => handleErzeugen('drill')}
                      >
                        Bohrloch
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        className="menubar-dropdown-btn"
                        onClick={() => handleErzeugen('steppung')}
                      >
                        Steppung
                      </button>
                    </li>
                  </ul>
                )}
              </li>
              <li>
                <button type="button" className="menubar-dropdown-btn" onClick={() => handleErzeugen('addPiece')}>
                  Teil hinzufügen
                </button>
              </li>
            </ul>
          )}
        </div>
        <div className="menubar-item-wrap">
          <button
            type="button"
            className="menubar-item"
            aria-expanded={openMenu === 'bearbeiten'}
            onClick={() => setOpenMenu(openMenu === 'bearbeiten' ? null : 'bearbeiten')}
          >
            Bearbeiten
          </button>
          {openMenu === 'bearbeiten' && (
            <ul className="menubar-dropdown">
              <li>
                <button
                  type="button"
                  className={`menubar-dropdown-btn ${tool === 'select' ? 'active' : ''}`}
                  onClick={() => handleBearbeiten('select')}
                >
                  Auswahl
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`menubar-dropdown-btn ${tool === 'pan' ? 'active' : ''}`}
                  onClick={() => handleBearbeiten('pan')}
                >
                  Verschieben
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`menubar-dropdown-btn ${tool === 'line' ? 'active' : ''}`}
                  onClick={() => handleBearbeiten('line')}
                >
                  Linie
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`menubar-dropdown-btn ${tool === 'notch' ? 'active' : ''}`}
                  onClick={() => handleBearbeiten('notch')}
                >
                  Notch <span className="menubar-shortcut">N</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`menubar-dropdown-btn ${tool === 'drill' ? 'active' : ''}`}
                  onClick={() => handleBearbeiten('drill')}
                >
                  Bohrung
                </button>
              </li>
              <li
                className="menubar-submenu-wrap"
                onMouseEnter={() => setBearbeitenSubmenu('kante')}
                onMouseLeave={() => setBearbeitenSubmenu(null)}
              >
                <span className="menubar-dropdown-btn menubar-dropdown-btn-submenu">Kante</span>
                {bearbeitenSubmenu === 'kante' && (
                  <ul className="menubar-dropdown menubar-submenu">
                    <li>
                      <button
                        type="button"
                        className="menubar-dropdown-btn"
                        onClick={() => {
                          setTool('select')
                          closeMenu()
                          setBearbeitenSubmenu(null)
                        }}
                      >
                        Kanten-Menü (Kante anfahren)
                      </button>
                    </li>
                  </ul>
                )}
              </li>
              <li className="menubar-separator" />
              <li>
                <button
                  type="button"
                  className={`menubar-dropdown-btn ${showPoints ? 'active' : ''}`}
                  onClick={() => {
                    setShowPoints(!showPoints)
                    closeMenu()
                  }}
                >
                  {showPoints ? 'Punkte ausblenden' : 'Punkte einblenden'}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="menubar-dropdown-btn"
                  onClick={() => handleBearbeiten('nahtzugabe')}
                  disabled={selectedPieceIds.length === 0}
                >
                  Nahtzugabe {NAHTZUGABE_MM} mm
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="menubar-dropdown-btn"
                  onClick={() => {
                    selectedPieceIds.forEach((id) => rotatePiece90(id))
                    closeMenu()
                  }}
                  disabled={selectedPieceIds.length === 0}
                >
                  90° drehen <span className="menubar-shortcut">R</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="menubar-dropdown-btn"
                  onClick={() => {
                    selectedPieceIds.forEach((id) => alignPieceToGrain(id))
                    closeMenu()
                  }}
                  disabled={selectedPieceIds.length === 0}
                >
                  An Laufrichtung ausrichten <span className="menubar-shortcut">A</span>
                </button>
              </li>
            </ul>
          )}
        </div>
        <div className="menubar-item-wrap">
          <button
            type="button"
            className="menubar-item"
            aria-expanded={openMenu === 'naht'}
            onClick={() => setOpenMenu(openMenu === 'naht' ? null : 'naht')}
          >
            Naht
          </button>
          {openMenu === 'naht' && (
            <ul className="menubar-dropdown">
              <li>
                <button
                  type="button"
                  className="menubar-dropdown-btn"
                  onClick={() => {
                    setPendingNahtzugabeClick(true)
                    closeMenu()
                  }}
                >
                  Nahtzugabe … <span className="menubar-shortcut">S</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="menubar-dropdown-btn"
                  disabled={!selectedPieceIds.some((id) => workspace.pieces.find((p) => p.id === id)?.seamAllowanceMm != null)}
                  onClick={() => {
                    selectedPieceIds.forEach((id) => {
                      const p = workspace.pieces.find((pp) => pp.id === id)
                      if (p?.seamAllowanceMm != null) removeSeamAllowance(id)
                    })
                    closeMenu()
                  }}
                >
                  Nahtzugabe entfernen
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="menubar-dropdown-btn"
                  onClick={() => {
                    setNahtzuordnungMode('first')
                    closeMenu()
                  }}
                >
                  Nahtzuordnung
                </button>
              </li>
              <li
                className="menubar-submenu-wrap"
                onMouseEnter={() => setNahtSubmenu('nahtecken')}
                onMouseLeave={() => setNahtSubmenu(null)}
              >
                <span className="menubar-dropdown-btn menubar-dropdown-btn-submenu">Nahtecken</span>
                {nahtSubmenu === 'nahtecken' && (
                  <ul className="menubar-dropdown menubar-submenu">
                    <li>
                      <button type="button" className="menubar-dropdown-btn" onClick={() => closeMenu()}>
                        Abgeschnitten
                      </button>
                    </li>
                    <li>
                      <button type="button" className="menubar-dropdown-btn" onClick={() => closeMenu()}>
                        Faccete
                      </button>
                    </li>
                    <li>
                      <button type="button" className="menubar-dropdown-btn" onClick={() => closeMenu()}>
                        Ecke
                      </button>
                    </li>
                    <li>
                      <button type="button" className="menubar-dropdown-btn" onClick={() => closeMenu()}>
                        usw.
                      </button>
                    </li>
                  </ul>
                )}
              </li>
            </ul>
          )}
        </div>
        <div className="menubar-item-wrap">
          <button
            type="button"
            className="menubar-item"
            aria-expanded={openMenu === 'material'}
            onClick={() => setOpenMenu(openMenu === 'material' ? null : 'material')}
          >
            Material
          </button>
          {openMenu === 'material' && <ul className="menubar-dropdown" />}
        </div>
        <div className="menubar-item-wrap">
          <button
            type="button"
            className="menubar-item"
            aria-expanded={openMenu === 'stueckliste'}
            onClick={() => setOpenMenu(openMenu === 'stueckliste' ? null : 'stueckliste')}
          >
            Stückliste
          </button>
          {openMenu === 'stueckliste' && (
            <ul className="menubar-dropdown">
              <li>
                <button type="button" className="menubar-dropdown-btn" onClick={() => closeMenu()}>
                  Stückliste
                </button>
              </li>
            </ul>
          )}
        </div>
        <div className="menubar-item-wrap">
          <button
            type="button"
            className="menubar-item"
            aria-expanded={openMenu === 'pruefen'}
            onClick={() => setOpenMenu(openMenu === 'pruefen' ? null : 'pruefen')}
          >
            Prüfen
          </button>
          {openMenu === 'pruefen' && (
            <ul className="menubar-dropdown">
              <li>
                <button type="button" className="menubar-dropdown-btn" onClick={() => handlePruefen('geschlossen')}>
                  Geschlossene Kontur prüfen
                </button>
              </li>
              <li>
                <button type="button" className="menubar-dropdown-btn" onClick={() => handlePruefen('alle')}>
                  Alle Teile prüfen
                </button>
              </li>
            </ul>
          )}
        </div>
        <div className="menubar-item-wrap">
          <button
            type="button"
            className="menubar-item"
            aria-expanded={openMenu === 'hilfe'}
            onClick={() => setOpenMenu(openMenu === 'hilfe' ? null : 'hilfe')}
          >
            Hilfe
          </button>
          {openMenu === 'hilfe' && (
            <ul className="menubar-dropdown">
              <li>
                <button
                  type="button"
                  className="menubar-dropdown-btn"
                  onClick={() => {
                    setShowHelpModal(true)
                    closeMenu()
                  }}
                >
                  Anleitung <span className="menubar-shortcut">F1</span>
                </button>
              </li>
            </ul>
          )}
        </div>
      </nav>
      <div className="menubar-right">
        {nahtzuordnungMode !== 'idle' && (
          <span className="nahtzuordnung-hint">
            {nahtzuordnungMode === 'first' ? 'Erste Kante anklicken (Konturlinie eines Teils)' : 'Zweite Kante anklicken (anderes Teil)'}
            <button
              type="button"
              className="nahtzuordnung-abbrechen"
              onClick={() => setNahtzuordnungMode('idle')}
            >
              Abbrechen
            </button>
          </span>
        )}
        <button
          type="button"
          className={`toolbar-ruler-btn ${rulerMode ? 'active' : ''}`}
          onClick={() => {
            const next = !rulerMode
            setRulerMode(next)
            if (!next) setRulerLine(null)
          }}
          title={rulerMode ? 'Linial ausschalten' : 'Strecke messen (Linial)'}
          aria-pressed={rulerMode}
        >
          <span className="toolbar-ruler-btn-icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="9" width="20" height="6" rx="0.5" />
              <path d="M4 9v2M8 9v2.5M12 9v2M16 9v2.5M20 9v2" />
            </svg>
          </span>
          <span className="toolbar-ruler-btn-label">Linial</span>
        </button>
        <div className="toolbar-zoom">
          <button type="button" className="toolbar-zoom-btn" onClick={handleZoomOut} aria-label="Verkleinern">
            −
          </button>
          <span className="toolbar-zoom-label" title="Arbeitsfläche in mm, maßstabsgetreu">{Math.round(view.zoom * 100)}% · mm</span>
          <button type="button" className="toolbar-zoom-btn" onClick={handleZoomIn} aria-label="Vergrößern">
            +
          </button>
        </div>
      </div>
      <SettingsModal />
      <SeamAdjustmentModal />
      {nahtzugabeDialogPieceId && (() => {
        const dialogPiece = workspace.pieces.find((p) => p.id === nahtzugabeDialogPieceId)
        const hasExisting = dialogPiece?.seamAllowanceMm != null
        const mm = parseFloat(nahtzugabeMm)
        const contourForValidation = dialogPiece?.seamLine.length >= 3 ? dialogPiece.seamLine : dialogPiece?.cutLine ?? []
        const validation = dialogPiece && Number.isFinite(mm) && mm > 0
          ? validateSeamAllowance(contourForValidation, mm)
          : null
        return (
        <div className="nahtzugabe-dialog-overlay" onClick={() => setNahtzugabeDialogPieceId(null)}>
          <div className="nahtzugabe-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="nahtzugabe-dialog-title">Nahtzugabe</h3>
            {hasExisting && (
              <p style={{ margin: '0 0 4px', fontSize: '12px', color: '#555' }}>
                Aktuell: {dialogPiece!.seamAllowanceMm} mm
              </p>
            )}
            <p className="nahtzugabe-dialog-hint">
              Die bestehende Kontur wird zur Nahtlinie; die CutLine (Schnittlinie) wird um diesen Abstand nach außen hinzugefügt.
            </p>
            <label className="nahtzugabe-dialog-label">
              <span>Nahtzugabe (mm)</span>
              <input
                type="number"
                min={0.5}
                max={50}
                step={0.5}
                value={nahtzugabeMm}
                onChange={(e) => setNahtzugabeMm(e.target.value)}
                className="nahtzugabe-dialog-input"
              />
            </label>
            {validation?.warning && (
              <p style={{
                margin: '6px 0 0',
                fontSize: '12px',
                color: validation.valid ? '#e65100' : '#c62828',
                lineHeight: 1.3,
              }}>
                {validation.warning}
              </p>
            )}
            <div className="nahtzugabe-dialog-actions">
              {hasExisting && (
                <button
                  type="button"
                  className="sidebar-btn"
                  style={{ color: '#c62828' }}
                  onClick={() => {
                    removeSeamAllowance(nahtzugabeDialogPieceId)
                    setNahtzugabeDialogPieceId(null)
                  }}
                >
                  Entfernen
                </button>
              )}
              <button
                type="button"
                className="sidebar-btn"
                onClick={() => setNahtzugabeDialogPieceId(null)}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="sidebar-btn primary"
                disabled={validation != null && !validation.valid}
                onClick={() => {
                  if (Number.isFinite(mm) && mm >= 0.5 && mm <= 50 && validation?.valid !== false) {
                    applyOffset(nahtzugabeDialogPieceId, mm)
                    setNahtzugabeDialogPieceId(null)
                  }
                }}
              >
                Übernehmen
              </button>
            </div>
          </div>
        </div>
        )
      })()}
    </header>
  )
}
