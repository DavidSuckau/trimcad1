import { useState, useRef, useEffect } from 'react'
import { useStore } from '../store/useStore'
import { downloadDxf } from '../dxf/dxfWriter'
import { downloadAamaDxf } from '../dxf/aamaWriter'
import { downloadAstmDxf } from '../dxf/astmWriter'
import { importDxfFromString, parseExtraCutLayers } from '../dxf/dxfImporter'
import { downloadBlob } from '../dxf/dxfShared'
import {
  buildTrimTexProjectFile,
  stringifyTrimTexProject,
  parseTrimTexProjectJson,
  suggestedTrimTexProjectFilename,
} from '../persistence/trimtexProjectJson'
import { validateSeamAllowance } from '../geometry/offset'
import { SettingsModal } from './SettingsModal'
import { SeamAdjustmentModal } from './SeamAdjustmentModal'
import { SeamAssignmentMetaModal } from './SeamAssignmentMetaModal'
import { MassstabModal } from './MassstabModal'
import { ConfiguratorModal } from './ConfiguratorModal'
import { RockGeneratorModal } from './RockGeneratorModal'
import { StuecklisteModal } from './StuecklisteModal'

type ToolId =
  | 'select'
  | 'pan'
  | 'line'
  | 'bezier'
  | 'notch'
  | 'drill'
  | 'rectangle'
  | 'massstab'
  | 'note'
type MenuId = 'datei' | 'erzeugen' | 'bearbeiten' | 'naht' | 'material' | 'stueckliste' | 'pruefen' | 'hilfe' | null

const NAHTZUGABE_MM = 5

/** Anzeigename und optional Shortcut pro Werkzeug (für sichtbare Werkzeug-Anzeige in der Toolbar). */
const TOOL_DISPLAY: Record<string, { label: string; shortcut?: string }> = {
  select: { label: 'Auswahl' },
  pan: { label: 'Verschieben' },
  point: { label: 'Punkt', shortcut: 'P' },
  curvepoint: { label: 'Kurvenpunkt', shortcut: 'C' },
  notch: { label: 'Notch', shortcut: 'N' },
  kante: { label: 'Kante', shortcut: 'K' },
  massstab: { label: 'Maßstab', shortcut: 'M' },
  digitize: { label: 'Digitalisieren', shortcut: 'D' },
  rectangle: { label: 'Rechteck' },
  line: { label: 'Linie' },
  internalLine: { label: 'Linie (intern)' },
  drill: { label: 'Bohrung' },
  note: { label: 'Notiz' },
  internalCircle: { label: 'Kreis' },
  bezier: { label: 'Bézier' },
}
const VIEWBOX_CX = 400
const VIEWBOX_CY = 300

export function Toolbar() {
  const {
    tool,
    setTool,
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
    setShowStuecklisteModal,
    setShowHelpModal,
    setShowShortcutListModal,
    dxfExportScale,
    dxfImportExtraCutLayers,
    dxfImportScale,
    dxfImportDetectVNotches,
    dxfImportCreateSeamLine,
    dxfImportSeamAllowanceMm,
    notchSettings,
    activeNotchPresetIndex,
    setActiveNotchPresetIndex,
    imageDigitizeSession,
    startDigitize,
    startImageSession,
    setToastMessage,
    loadProjectFromFile,
    updateWorkspace,
    createConfiguratorInstance,
    setShowConfiguratorModal,
    setShowRockGeneratorModal,
    batchSelectionTargets,
    batchDeleteMarqueeCompletePieces,
  } = useStore()
  const [nahtzugabeMm, setNahtzugabeMm] = useState('8')
  const { view } = workspace
  const [openMenu, setOpenMenu] = useState<MenuId>(null)
  const [erzeugenSubmenu, setErzeugenSubmenu] = useState<'interne-elemente' | 'konfigurator' | null>(null)
  const [dateiSubmenu, setDateiSubmenu] = useState<'exportieren' | null>(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  const dxfImportInputRef = useRef<HTMLInputElement>(null)
  const jsonImportInputRef = useRef<HTMLInputElement>(null)
  const imageImportInputRef = useRef<HTMLInputElement>(null)

  const MAX_IMAGE_DIMENSION_PX = 3000

  useEffect(() => {
    /** pointerdown statt mousedown: die Arbeitsfläche ruft preventDefault auf pointerdown auf und unterdrückt damit mousedown. */
    function handlePointerOutside(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
        setErzeugenSubmenu(null)
      }
    }
    if (openMenu) {
      document.addEventListener('pointerdown', handlePointerOutside, true)
      return () => document.removeEventListener('pointerdown', handlePointerOutside, true)
    }
  }, [openMenu])

  useEffect(() => {
    if (openMenu !== 'datei') setDateiSubmenu(null)
    if (openMenu !== 'erzeugen') setErzeugenSubmenu(null)
  }, [openMenu])

  useEffect(() => {
    function handlePointerOutside(e: PointerEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false)
      }
    }
    if (exportMenuOpen) {
      document.addEventListener('pointerdown', handlePointerOutside, true)
      return () => document.removeEventListener('pointerdown', handlePointerOutside, true)
    }
  }, [exportMenuOpen])

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

  const handleSaveProjectJson = () => {
    const fileName = suggestedTrimTexProjectFilename(workspace.name)
    updateWorkspace({ projectFileName: fileName })
    const file = buildTrimTexProjectFile({
      workspace: useStore.getState().workspace,
      dxfExportScale,
      dxfImportExtraCutLayers,
      dxfImportScale,
      dxfImportDetectVNotches,
      dxfImportCreateSeamLine,
      dxfImportSeamAllowanceMm,
      notchSettings,
      imageDigitizeSession,
    })
    const json = stringifyTrimTexProject(file)
    downloadBlob(json, fileName, 'application/json;charset=utf-8')
    closeMenu()
  }

  const handleImportProjectJson = () => {
    jsonImportInputRef.current?.click()
    closeMenu()
  }

  const handleImportDxf = () => {
    dxfImportInputRef.current?.click()
    closeMenu()
  }

  const handleJsonFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    closeMenu()
    const reader = new FileReader()
    reader.onerror = () => setToastMessage('error:Datei konnte nicht gelesen werden')
    reader.onload = () => {
      try {
        const text = reader.result as string
        const result = parseTrimTexProjectJson(text)
        if (!result.ok) {
          setToastMessage('error:' + result.error)
          return
        }
        loadProjectFromFile(result.data, { projectFileName: file.name })
        setToastMessage('success:Projekt geladen.')
      } catch (err) {
        setToastMessage('error:' + (err instanceof Error ? err.message : 'Laden fehlgeschlagen'))
      }
    }
    reader.readAsText(file, 'UTF-8')
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
        const result = importDxfFromString(content, {
          extraCutLayers: parseExtraCutLayers(dxfImportExtraCutLayers),
          importScale: dxfImportScale,
          detectVNotchesInPolyline: dxfImportDetectVNotches,
          createSeamLineOnImport: dxfImportCreateSeamLine,
          importSeamAllowanceMm: dxfImportSeamAllowanceMm,
        })
        if (result.error) {
          setToastMessage('error:' + result.error)
        } else if (result.pieces.length > 0) {
          for (const piece of result.pieces) {
            addPiece(piece)
          }
          const hint = result.warnings?.length ? ' ' + result.warnings.join(' ') : ''
          setToastMessage('success:' + result.pieces.length + ' Schnittteil(e) importiert.' + hint)
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

  const handleBearbeiten = (action: ToolId | 'nahtzugabe' | 'kante' | 'massstab') => {
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
        setToastMessage('error:Bitte genau ein Teil auswählen.')
      } else if (piece.cutLine.length < 3) {
        setToastMessage('error:Teil hat keine geschlossene Kontur.')
      } else {
        setToastMessage('success:Teil hat eine geschlossene Kontur.')
      }
    }
    if (action === 'alle') {
      const n = workspace.pieces.length
      const closed = workspace.pieces.filter((p) => p.cutLine.length >= 3).length
      setToastMessage(`success:${closed} von ${n} Teilen haben eine geschlossene Kontur.`)
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
      <img src="/logo-trimcad.png" alt="TrimCAD" className="menubar-logo" />
      <input
        ref={jsonImportInputRef}
        type="file"
        accept=".json,application/json"
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
        onChange={handleJsonFileChange}
      />
      <input
        ref={dxfImportInputRef}
        type="file"
        accept=".dxf"
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
        onChange={handleDxfFileChange}
      />
      <input
        ref={imageImportInputRef}
        type="file"
        accept="image/*"
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          closeMenu()

          const reader = new FileReader()
          reader.onerror = () => setToastMessage('error:Bild konnte nicht gelesen werden')
          reader.onload = () => {
            const originalDataUrl = reader.result as string

            const img = new Image()
            img.onerror = () => setToastMessage('error:Bild konnte nicht decodiert werden')
            img.onload = () => {
              const w = img.naturalWidth || 0
              const h = img.naturalHeight || 0
              if (!w || !h) {
                setToastMessage('error:Bild hat keine gueltigen Abmessungen')
                return
              }

              const scale = Math.min(1, MAX_IMAGE_DIMENSION_PX / Math.max(w, h))
              const targetW = Math.max(1, Math.round(w * scale))
              const targetH = Math.max(1, Math.round(h * scale))

              if (scale < 1) {
                const canvas = document.createElement('canvas')
                canvas.width = targetW
                canvas.height = targetH
                const ctx = canvas.getContext('2d')
                if (!ctx) {
                  setToastMessage('error:Canvas ist nicht verfuegbar')
                  return
                }
                ctx.drawImage(img, 0, 0, targetW, targetH)
                const downscaledDataUrl = canvas.toDataURL('image/jpeg', 0.92)
                startImageSession({ dataUrl: downscaledDataUrl, widthPx: targetW, heightPx: targetH })
              } else {
                startImageSession({ dataUrl: originalDataUrl, widthPx: w, heightPx: h })
              }
            }
            img.src = originalDataUrl
          }
          reader.readAsDataURL(file)
        }}
      />
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
                <button type="button" className="menubar-dropdown-btn" onClick={handleSaveProjectJson}>
                  Projekt speichern (JSON) …
                </button>
              </li>
              <li>
                <button type="button" className="menubar-dropdown-btn" onClick={handleImportProjectJson}>
                  Projekt öffnen (JSON) …
                </button>
              </li>
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
              <li>
                <button
                  type="button"
                  className="menubar-dropdown-btn"
                  onClick={() => {
                    imageImportInputRef.current?.click()
                    closeMenu()
                  }}
                >
                  Bild einfügen
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
              <li
                className="menubar-submenu-wrap"
                onMouseEnter={() => setErzeugenSubmenu('konfigurator')}
                onMouseLeave={() => setErzeugenSubmenu(null)}
              >
                <span className="menubar-dropdown-btn menubar-dropdown-btn-submenu">Konfigurator</span>
                {erzeugenSubmenu === 'konfigurator' && (
                  <ul className="menubar-dropdown menubar-submenu">
                    <li>
                      <button
                        type="button"
                        className="menubar-dropdown-btn"
                        onClick={() => {
                          createConfiguratorInstance('tshirt')
                          setShowConfiguratorModal(true)
                          closeMenu()
                          setErzeugenSubmenu(null)
                        }}
                      >
                        T-Shirt
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        className="menubar-dropdown-btn"
                        onClick={() => {
                          setShowRockGeneratorModal(true)
                          closeMenu()
                          setErzeugenSubmenu(null)
                        }}
                      >
                        Rock
                      </button>
                    </li>
                    <li className="menubar-separator" />
                    <li>
                      <button
                        type="button"
                        className="menubar-dropdown-btn"
                        onClick={() => {
                          setShowConfiguratorModal(true)
                          closeMenu()
                          setErzeugenSubmenu(null)
                        }}
                      >
                        Konfigurator bearbeiten
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
              <li>
                <button
                  type="button"
                  className={`menubar-dropdown-btn ${tool === 'note' ? 'active' : ''}`}
                  onClick={() => handleBearbeiten('note')}
                >
                  Notiz
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`menubar-dropdown-btn ${tool === 'kante' ? 'active' : ''}`}
                  onClick={() => handleBearbeiten('kante')}
                >
                  Kante <span className="menubar-shortcut">K</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`menubar-dropdown-btn ${tool === 'massstab' ? 'active' : ''}`}
                  onClick={() => handleBearbeiten('massstab')}
                >
                  Maßstab <span className="menubar-shortcut">M</span>
                </button>
              </li>
              <li className="menubar-separator" />
              <li>
                <button
                  type="button"
                  className="menubar-dropdown-btn"
                  onClick={() => {
                    const n = batchSelectionTargets.filter((t) => t.kind === 'piece').length
                    if (n === 0) {
                      batchDeleteMarqueeCompletePieces()
                      closeMenu()
                      return
                    }
                    const msg =
                      n === 1
                        ? 'Ein komplett erfasstes Teil aus der Fensterauswahl wirklich löschen?'
                        : `${n} komplett erfasste Teile aus der Fensterauswahl wirklich löschen?`
                    if (window.confirm(msg)) {
                      batchDeleteMarqueeCompletePieces()
                    }
                    closeMenu()
                  }}
                >
                  Komplette Teile löschen (Fensterauswahl)
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
          {openMenu === 'material' && (
            <ul className="menubar-dropdown">
              <li>
                <span className="menubar-dropdown-btn menubar-dropdown-btn-disabled">In Entwicklung</span>
              </li>
            </ul>
          )}
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
                <button
                  type="button"
                  className="menubar-dropdown-btn"
                  onClick={() => {
                    setShowStuecklisteModal(true)
                    closeMenu()
                  }}
                >
                  Stückliste anzeigen
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
              <li>
                <button
                  type="button"
                  className="menubar-dropdown-btn"
                  onClick={() => {
                    setShowShortcutListModal(true)
                    closeMenu()
                  }}
                >
                  Tastenkürzel
                </button>
              </li>
            </ul>
          )}
        </div>
      </nav>
      <div className="toolbar-tool-indicator" title="Aktives Werkzeug">
        {(() => {
          const d = TOOL_DISPLAY[tool]
          const label = d ? d.label : tool
          const shortcut = d?.shortcut
          return (
            <span className="toolbar-tool-label">
              Werkzeug: {label}
              {shortcut != null && <span className="menubar-shortcut">{shortcut}</span>}
            </span>
          )
        })()}
        {tool === 'notch' && (
          <label
            className="toolbar-notch-preset"
            style={{
              marginLeft: 16,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: '#333',
            }}
            title="Notch 1 ist der Standard. Werte kommen aus Einstellungen → Notches. Hier das Preset wählen, das beim Setzen einer neuen Kerbe verwendet wird."
          >
            <span>Aktives Notch-Preset (Notch 1 = Standard):</span>
            <select
              value={activeNotchPresetIndex}
              onChange={(e) => setActiveNotchPresetIndex(Number(e.target.value))}
              style={{ fontSize: 12, padding: '2px 6px', maxWidth: 280 }}
            >
              {notchSettings.map((n, i) => {
                const typLabel = n.type === 'kerbe' ? 'Kerbe' : n.type === 'keine' ? 'Keine' : 'Strich'
                return (
                  <option key={i} value={i}>
                    {i + 1}: {typLabel} ({n.widthMm}×{n.depthMm} mm)
                  </option>
                )
              })}
            </select>
          </label>
        )}
      </div>
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
        <div className="menubar-item-wrap toolbar-export-wrap" ref={exportMenuRef}>
          <button
            type="button"
            className={`toolbar-ruler-btn ${exportMenuOpen ? 'active' : ''}`}
            onClick={() => setExportMenuOpen(!exportMenuOpen)}
            aria-expanded={exportMenuOpen}
            title="DXF exportieren (2 Klicks)"
          >
            <span className="toolbar-ruler-btn-label">Export</span>
          </button>
          {exportMenuOpen && (
            <ul className="menubar-dropdown menubar-dropdown-right">
              <li>
                <button type="button" className="menubar-dropdown-btn" onClick={() => { handleExportDxf(); setExportMenuOpen(false) }}>
                  DXF (einfach)
                </button>
              </li>
              <li>
                <button type="button" className="menubar-dropdown-btn" onClick={() => { handleExportAama(); setExportMenuOpen(false) }}>
                  AAMA-DXF (.aam)
                </button>
              </li>
              <li>
                <button type="button" className="menubar-dropdown-btn" onClick={() => { handleExportAstm(); setExportMenuOpen(false) }}>
                  ASTM-DXF (Gerber)
                </button>
              </li>
            </ul>
          )}
        </div>
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
      <StuecklisteModal />
      <SeamAdjustmentModal />
      <SeamAssignmentMetaModal />
      <MassstabModal />
      <ConfiguratorModal />
      <RockGeneratorModal />
      {nahtzugabeDialogPieceId && (() => {
        const dialogPiece = workspace.pieces.find((p) => p.id === nahtzugabeDialogPieceId)
        const hasExisting = dialogPiece?.seamAllowanceMm != null
        const mm = parseFloat(nahtzugabeMm)
        const contourForValidation =
          dialogPiece && (dialogPiece.seamLine?.length ?? 0) >= 3 ? dialogPiece.seamLine : (dialogPiece?.cutLine ?? [])
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
