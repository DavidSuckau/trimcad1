import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { flattenDraftsToPiecePartials, flattenMeshToPieces } from '../scan3d/flatten'
import { useScan3dStore } from '../scan3d/useScan3dStore'
import type { ObjUnit } from '../scan3d/types'
import { useStore } from '../store/useStore'

const SUPPORTED_MESH_RE = /\.(obj|stl|step|stp)$/i

function isSupportedMeshFile(file: File): boolean {
  if (SUPPORTED_MESH_RE.test(file.name)) return true
  const t = (file.type || '').toLowerCase()
  return (
    t.includes('stl') ||
    t.includes('sla') ||
    t.includes('step') ||
    t.includes('model/obj') ||
    t === 'application/octet-stream'
  )
}

const Scan3dViewport = lazy(() =>
  import('./Scan3dViewport').then((m) => ({ default: m.Scan3dViewport })),
)

export function Scan3dModal() {
  const showScan3dModal = useStore((s) => s.showScan3dModal)
  const setShowScan3dModal = useStore((s) => s.setShowScan3dModal)
  const setToastMessage = useStore((s) => s.setToastMessage)
  const addPiece = useStore((s) => s.addPiece)

  const session = useScan3dStore((s) => s.session)
  const loadError = useScan3dStore((s) => s.loadError)
  const loadWarnings = useScan3dStore((s) => s.loadWarnings)
  const pendingUnit = useScan3dStore((s) => s.pendingUnit)
  const setPendingUnit = useScan3dStore((s) => s.setPendingUnit)
  const loadMeshFiles = useScan3dStore((s) => s.loadMeshFiles)
  const clearLoadError = useScan3dStore((s) => s.clearLoadError)
  const isLoading = useScan3dStore((s) => s.isLoading)
  const isBuildingGraph = useScan3dStore((s) => s.isBuildingGraph)
  const meshGraph = useScan3dStore((s) => s.meshGraph)
  const loadProgress = useScan3dStore((s) => s.loadProgress)
  const loadLabel = useScan3dStore((s) => s.loadLabel)
  const closeSession = useScan3dStore((s) => s.closeSession)
  const setTool = useScan3dStore((s) => s.setTool)
  const finishActiveSeam = useScan3dStore((s) => s.finishActiveSeam)
  const cancelActiveSeam = useScan3dStore((s) => s.cancelActiveSeam)
  const deleteSeam = useScan3dStore((s) => s.deleteSeam)
  const undoLastSegment = useScan3dStore((s) => s.undoLastSegment)
  const toggleWireframe = useScan3dStore((s) => s.toggleWireframe)
  const selectSeam = useScan3dStore((s) => s.selectSeam)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  /** Verhindert, dass Escape nach dem Dateidialog die Session/das Fenster sofort schließt. */
  const filePickerOpenRef = useRef(false)
  const ignoreEscapeUntilRef = useRef(0)
  const [dragOver, setDragOver] = useState(false)
  const [flattening, setFlattening] = useState(false)
  const trapRef = useFocusTrap<HTMLDivElement>(showScan3dModal)

  useEffect(() => {
    for (const w of loadWarnings) {
      if (w.includes('automatisch auf')) {
        setToastMessage(`success:${w}`)
      } else {
        setToastMessage(`warn:${w}`)
      }
    }
  }, [loadWarnings, setToastMessage])

  const handleClose = useCallback(() => {
    if (isLoading) return
    if (filePickerOpenRef.current) return
    if (Date.now() < ignoreEscapeUntilRef.current) return
    if (session && session.seams.length > 0) {
      const ok = window.confirm('3D-Session schließen? Gezeichnete Nähte gehen verloren.')
      if (!ok) return
    }
    closeSession()
    setShowScan3dModal(false)
  }, [session, isLoading, closeSession, setShowScan3dModal])

  useEffect(() => {
    if (!showScan3dModal) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (filePickerOpenRef.current || Date.now() < ignoreEscapeUntilRef.current) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
        if (session?.activeSeamId) {
          cancelActiveSeam()
        } else {
          handleClose()
        }
      } else if (e.key === 'Enter' && session?.activeSeamId) {
        finishActiveSeam()
      } else if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey) && session?.activeSeamId) {
        e.preventDefault()
        undoLastSegment()
      } else if (e.key === 'Backspace' && session?.activeSeamId) {
        e.preventDefault()
        undoLastSegment()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [showScan3dModal, session, handleClose, cancelActiveSeam, finishActiveSeam, undoLastSegment])

  const armFilePickerGuard = useCallback(() => {
    filePickerOpenRef.current = true
    ignoreEscapeUntilRef.current = Date.now() + 1500
    const onWindowFocus = () => {
      window.setTimeout(() => {
        filePickerOpenRef.current = false
        ignoreEscapeUntilRef.current = Date.now() + 800
      }, 300)
      window.removeEventListener('focus', onWindowFocus)
    }
    window.addEventListener('focus', onWindowFocus)
  }, [])

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      filePickerOpenRef.current = false
      ignoreEscapeUntilRef.current = Date.now() + 1200
      const files = Array.from(fileList)
      const meshFiles = files.filter((f) => isSupportedMeshFile(f) || SUPPORTED_MESH_RE.test(f.name))
      if (meshFiles.length === 0) {
        setToastMessage('warn:Unterstützt: OBJ, STL, STEP (.step / .stp).')
        return
      }
      if (isLoading) return
      clearLoadError()
      try {
        await loadMeshFiles(meshFiles)
      } catch (err) {
        console.error('[scan3d] handleFiles', err)
        setToastMessage(`error:${err instanceof Error ? err.message : 'Laden fehlgeschlagen'}`)
      }
    },
    [loadMeshFiles, isLoading, setToastMessage, clearLoadError],
  )

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files
      if (list?.length) void handleFiles(list)
      e.target.value = ''
    },
    [handleFiles],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      if (e.dataTransfer.files?.length) void handleFiles(e.dataTransfer.files)
    },
    [handleFiles],
  )

  const openFilePicker = useCallback(() => {
    armFilePickerGuard()
    fileInputRef.current?.click()
  }, [armFilePickerGuard])

  const openFolderPicker = useCallback(() => {
    armFilePickerGuard()
    folderInputRef.current?.click()
  }, [armFilePickerGuard])

  const handleFlatten = useCallback(async () => {
    if (!session || flattening || isLoading) return
    if (session.activeSeamId) {
      finishActiveSeam()
    }
    const fresh = useScan3dStore.getState().session
    if (!fresh) return

    setFlattening(true)
    await new Promise<void>((r) => setTimeout(r, 0))
    try {
      const baseName = fresh.fileName.replace(/\.(obj|stl|step|stp)$/i, '') || 'Abwicklung'
      const result = flattenMeshToPieces(fresh.mesh, fresh.seams, { baseName })
      if (!result.ok) {
        setToastMessage(`error:${result.error}`)
        for (const w of result.warnings) setToastMessage(`warn:${w}`)
        return
      }
      const partials = flattenDraftsToPiecePartials(result.pieces)
      for (const partial of partials) addPiece(partial)
      const hint = result.warnings.length ? ` ${result.warnings[0]}` : ''
      setToastMessage(
        `success:${result.pieces.length} Abwicklung(en) auf die Arbeitsfläche übernommen.${hint}`,
      )
      for (let i = 1; i < result.warnings.length; i++) {
        setToastMessage(`warn:${result.warnings[i]}`)
      }
      closeSession()
      setShowScan3dModal(false)
    } catch (err) {
      setToastMessage(`error:${err instanceof Error ? err.message : 'Abwicklung fehlgeschlagen'}`)
    } finally {
      setFlattening(false)
    }
  }, [
    session,
    flattening,
    isLoading,
    finishActiveSeam,
    addPiece,
    setToastMessage,
    closeSession,
    setShowScan3dModal,
  ])

  if (!showScan3dModal) return null

  const triangleCount = session ? session.mesh.indices.length / 3 : 0
  const canFlatten = Boolean(session) && !isLoading && !flattening
  const canDrawSeams = Boolean(session && meshGraph && !isBuildingGraph)

  return (
    <div className="scan3d-window" ref={trapRef} role="dialog" aria-modal="true" aria-label="3D → 2D Abwicklung">
      <header className="scan3d-window-header">
        <div className="scan3d-window-title">
          <h2>3D → 2D Abwicklung</h2>
          {session && (
            <span className="scan3d-window-subtitle">
              {session.fileName} · {triangleCount.toLocaleString('de-DE')} Dreiecke
            </span>
          )}
        </div>
        <div className="scan3d-window-header-actions">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".obj,.stl,.STL,.step,.stp,.STEP,.STP"
            className="scan3d-hidden-input"
            onChange={onFileChange}
          />
          <input
            ref={folderInputRef}
            type="file"
            className="scan3d-hidden-input"
            multiple
            {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
            onChange={onFileChange}
          />
          <button type="button" className="sidebar-btn" disabled={isLoading} onClick={openFilePicker}>
            OBJ / STL / STEP
          </button>
          <button type="button" className="sidebar-btn" disabled={isLoading} onClick={openFolderPicker}>
            Ordner
          </button>
          {session && (
            <>
              <button
                type="button"
                className={`sidebar-btn ${session.tool === 'navigate' ? 'primary' : ''}`}
                onClick={() => setTool('navigate')}
              >
                Navigation
              </button>
              <button
                type="button"
                className={`sidebar-btn ${session.tool === 'drawSeam' ? 'primary' : ''}`}
                disabled={!canDrawSeams}
                onClick={() => setTool('drawSeam')}
              >
                Freihand
              </button>
              <button
                type="button"
                className={`sidebar-btn ${session.tool === 'drawLine' ? 'primary' : ''}`}
                disabled={!canDrawSeams}
                onClick={() => setTool('drawLine')}
              >
                Gerade Naht
              </button>
              <button
                type="button"
                className={`sidebar-btn ${session.showWireframe ? 'primary' : ''}`}
                onClick={() => toggleWireframe()}
              >
                Drahtgitter
              </button>
              {session.activeSeamId && (
                <button type="button" className="sidebar-btn" onClick={() => finishActiveSeam()}>
                  Naht abschließen
                </button>
              )}
              <button
                type="button"
                className="sidebar-btn primary"
                disabled={!canFlatten}
                onClick={() => void handleFlatten()}
              >
                {flattening ? 'Abwicklung…' : '2D-Abwicklung'}
              </button>
            </>
          )}
          <button
            type="button"
            className="settings-close"
            disabled={isLoading}
            onClick={handleClose}
            aria-label="Fenster schließen"
          >
            ×
          </button>
        </div>
      </header>

      {isLoading && (
        <div className="scan3d-loading-overlay" role="status" aria-live="polite" aria-busy="true">
          <div className="scan3d-loading-card">
            <p className="scan3d-loading-title">3D-Modell wird geladen</p>
            <div className="nesting-progress">
              <div className="nesting-progress-track">
                <div
                  className={`nesting-progress-fill${loadProgress <= 5 ? ' nesting-progress-fill--indeterminate' : ''}`}
                  style={{ width: loadProgress <= 5 ? undefined : `${loadProgress}%` }}
                />
              </div>
              <span className="nesting-progress-label">
                {loadLabel}
                {loadProgress > 5 ? ` · ${loadProgress} %` : ''}
              </span>
            </div>
          </div>
        </div>
      )}

      {!session ? (
        <div className="scan3d-window-empty-wrap">
          <div
            className={`scan3d-window-empty ${dragOver && !isLoading ? 'scan3d-window-empty--drag' : ''}`}
            onDragOver={(e) => {
              if (isLoading) return
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            {loadError && (
              <div className="scan3d-load-error" role="alert">
                <strong>Laden fehlgeschlagen</strong>
                <p>{loadError}</p>
                <button type="button" className="sidebar-btn primary" onClick={openFilePicker}>
                  Erneut versuchen
                </button>
              </div>
            )}
            <p className="scan3d-format-list">
              <strong>Unterstützte 3D-Formate:</strong>
              <br />
              OBJ (mit Textur) · STL · STEP (.step / .stp)
            </p>
            <p>
              <strong>STL:</strong> Datei wählen oder hierher ziehen — das Modell erscheint danach direkt
              im 3D-Viewer (Standard: Millimeter).
            </p>
            <label className="scan3d-field">
              <span>Einheit im Modell</span>
              <select
                className="notch-input"
                value={pendingUnit}
                onChange={(e) => setPendingUnit(e.target.value as ObjUnit)}
              >
                <option value="mm">Millimeter (mm)</option>
                <option value="cm">Zentimeter (cm)</option>
                <option value="m">Meter (m)</option>
              </select>
            </label>
            <button type="button" className="sidebar-btn primary" disabled={isLoading} onClick={openFilePicker}>
              3D-Datei wählen (OBJ · STL · STEP)
            </button>
            <button type="button" className="sidebar-btn" disabled={isLoading} onClick={openFolderPicker}>
              Export-Ordner (Polycam)
            </button>
          </div>
        </div>
      ) : (
        <div className="scan3d-window-body">
          <aside className="scan3d-window-sidebar">
            <div className="scan3d-controls">
              <label className="scan3d-field">
                <span>Einheit (neu laden)</span>
                <select
                  className="notch-input"
                  value={pendingUnit}
                  onChange={(e) => setPendingUnit(e.target.value as ObjUnit)}
                >
                  <option value="mm">mm</option>
                  <option value="cm">cm</option>
                  <option value="m">m</option>
                </select>
              </label>
              <p className="scan3d-hint">
                <strong>Freihand:</strong> gedrückt halten und ziehen — jeder Strich wird eine Naht.
                <br />
                <strong>Gerade Naht:</strong> Startpunkt klicken, zum Endpunkt ziehen, loslassen.
                <br />
                Rücktaste = letzten Punkt entfernen · Drahtgitter hilft beim Kontrollieren.
                <br />
                <strong>2D-Abwicklung:</strong> Nähte teilen das Mesh in Regionen; jede Region wird
                flach als Schnittteil auf die Arbeitsfläche gelegt. Mehr Nähte = weniger Dehnung.
              </p>
              {isBuildingGraph && (
                <p className="scan3d-graph-status" role="status">
                  Modell sichtbar — Nahtgraph wird noch vorbereitet…
                  {loadProgress > 0 ? ` (${loadProgress} %)` : ''}
                </p>
              )}
              <button
                type="button"
                className="sidebar-btn primary scan3d-flatten-btn"
                disabled={!canFlatten}
                onClick={() => void handleFlatten()}
              >
                {flattening ? 'Abwicklung wird berechnet…' : '2D-Abwicklung erzeugen'}
              </button>
              <h3 className="scan3d-sidebar-heading">Nähte ({session.seams.length})</h3>
              {session.seams.length === 0 ? (
                <p className="scan3d-empty-list">Noch keine Nähte gezeichnet.</p>
              ) : (
                <ul className="scan3d-seam-list">
                  {session.seams.map((seam, idx) => (
                    <li key={seam.id} className={seam.id === session.activeSeamId ? 'active' : ''}>
                      <button type="button" className="scan3d-seam-btn" onClick={() => selectSeam(seam.id)}>
                        Naht {idx + 1}
                        {seam.closed ? ' (geschlossen)' : ''}
                        {' · '}
                        {seam.vertexPath.length > 0
                          ? seam.vertexPath.length
                          : Math.floor(seam.surfacePoints.length / 3)}{' '}
                        Punkte
                      </button>
                      <button
                        type="button"
                        className="scan3d-seam-delete"
                        onClick={() => deleteSeam(seam.id)}
                        aria-label={`Naht ${idx + 1} löschen`}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
          <main
            className="scan3d-window-main"
            onDoubleClick={() => {
              if (session.activeSeamId) finishActiveSeam()
            }}
          >
            <Suspense fallback={<div className="scan3d-main-placeholder">3D-Viewer wird geladen…</div>}>
              <Scan3dViewport />
            </Suspense>
          </main>
        </div>
      )}
    </div>
  )
}
