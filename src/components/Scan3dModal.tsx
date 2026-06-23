import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useStore } from '../store/useStore'
import { useScan3dStore } from '../scan3d/useScan3dStore'
import type { ObjUnit } from '../scan3d/types'

const Scan3dViewport = lazy(() =>
  import('./Scan3dViewport').then((m) => ({ default: m.Scan3dViewport })),
)

export function Scan3dModal() {
  const showScan3dModal = useStore((s) => s.showScan3dModal)
  const setShowScan3dModal = useStore((s) => s.setShowScan3dModal)
  const setToastMessage = useStore((s) => s.setToastMessage)

  const session = useScan3dStore((s) => s.session)
  const loadError = useScan3dStore((s) => s.loadError)
  const loadWarnings = useScan3dStore((s) => s.loadWarnings)
  const pendingUnit = useScan3dStore((s) => s.pendingUnit)
  const setPendingUnit = useScan3dStore((s) => s.setPendingUnit)
  const loadObj = useScan3dStore((s) => s.loadObjAssets)
  const isLoading = useScan3dStore((s) => s.isLoading)
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
  const [dragOver, setDragOver] = useState(false)
  const trapRef = useFocusTrap<HTMLDivElement>(showScan3dModal)

  useEffect(() => {
    if (loadError) setToastMessage(`warn:${loadError}`)
  }, [loadError, setToastMessage])

  useEffect(() => {
    for (const w of loadWarnings) setToastMessage(`warn:${w}`)
  }, [loadWarnings, setToastMessage])

  const handleClose = useCallback(() => {
    if (isLoading) return
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
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showScan3dModal, session, handleClose, cancelActiveSeam, finishActiveSeam, undoLastSegment])

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList)
      if (!files.some((f) => /\.(obj|stl)$/i.test(f.name))) {
        setToastMessage('warn:Mindestens eine OBJ- oder STL-Datei wird benötigt.')
        return
      }
      if (isLoading) return
      await loadObj(files)
    },
    [loadObj, isLoading, setToastMessage],
  )

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) void handleFiles(e.target.files)
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

  if (!showScan3dModal) return null

  const triangleCount = session ? session.mesh.indices.length / 3 : 0

  return (
    <div className="scan3d-window" ref={trapRef} role="dialog" aria-modal="true" aria-label="3D-Scan zeichnen">
      <header className="scan3d-window-header">
        <div className="scan3d-window-title">
          <h2>3D-Scan zeichnen</h2>
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
            accept=".obj,.stl,.mtl,.jpg,.jpeg,.png,.webp,.bmp"
            multiple
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
          <button
            type="button"
            className="sidebar-btn"
            disabled={isLoading}
            onClick={() => fileInputRef.current?.click()}
          >
            OBJ / STL
          </button>
          <button
            type="button"
            className="sidebar-btn"
            disabled={isLoading}
            onClick={() => folderInputRef.current?.click()}
          >
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
                onClick={() => setTool('drawSeam')}
              >
                Freihand
              </button>
              <button
                type="button"
                className={`sidebar-btn ${session.tool === 'drawLine' ? 'primary' : ''}`}
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
          <p>
            <strong>OBJ (Polycam):</strong> OBJ und Texturdatei (.jpg/.png) gemeinsam wählen — per Drag &amp; Drop
            beide Dateien auf einmal ablegen oder „OBJ / STL wählen“. Optional: ganzen Export-Ordner laden
            (enthält oft auch .mtl).
          </p>
          <p>
            <strong>STL:</strong> Einzelne .stl-Datei (ASCII oder binär) — ohne Textur, grau dargestellt.
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
          <button
            type="button"
            className="sidebar-btn primary"
            disabled={isLoading}
            onClick={() => fileInputRef.current?.click()}
          >
            OBJ / STL wählen
          </button>
          <button
            type="button"
            className="sidebar-btn"
            disabled={isLoading}
            onClick={() => folderInputRef.current?.click()}
          >
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
              </p>
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
                        {seam.vertexPath.length > 0 ? seam.vertexPath.length : Math.floor(seam.surfacePoints.length / 3)} Punkte
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
