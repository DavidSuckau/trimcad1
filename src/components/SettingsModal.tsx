import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store/useStore'
import type { NotchType } from '../store/useStore'
import { useFocusTrap } from '../hooks/useFocusTrap'

type SettingsTab = 'allgemein' | 'farben' | 'pfade' | 'notches'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'allgemein', label: 'Allgemein' },
  { id: 'farben', label: 'Farben' },
  { id: 'pfade', label: 'Pfade' },
  { id: 'notches', label: 'Notches' },
]

export function SettingsModal() {
  const {
    showSettingsModal,
    setShowSettingsModal,
    notchSettings,
    updateNotchSetting,
    dxfExportScale,
    setDxfExportScale,
    dxfImportExtraCutLayers,
    setDxfImportExtraCutLayers,
    dxfImportScale,
    setDxfImportScale,
    dxfImportDetectVNotches,
    setDxfImportDetectVNotches,
    dxfImportCreateSeamLine,
    setDxfImportCreateSeamLine,
    dxfImportSeamAllowanceMm,
    setDxfImportSeamAllowanceMm,
    canvasRotationUiScale,
    setCanvasRotationUiScale,
    canvasDigitizeUiScale,
    setCanvasDigitizeUiScale,
    canvasVertexPointUiScale,
    setCanvasVertexPointUiScale,
    showPivotRotationUi,
    setShowPivotRotationUi,
    uiTextScale,
    setUiTextScale,
  } = useStore(
    useShallow((s) => ({
      showSettingsModal: s.showSettingsModal,
      setShowSettingsModal: s.setShowSettingsModal,
      notchSettings: s.notchSettings,
      updateNotchSetting: s.updateNotchSetting,
      dxfExportScale: s.dxfExportScale,
      setDxfExportScale: s.setDxfExportScale,
      dxfImportExtraCutLayers: s.dxfImportExtraCutLayers,
      setDxfImportExtraCutLayers: s.setDxfImportExtraCutLayers,
      dxfImportScale: s.dxfImportScale,
      setDxfImportScale: s.setDxfImportScale,
      dxfImportDetectVNotches: s.dxfImportDetectVNotches,
      setDxfImportDetectVNotches: s.setDxfImportDetectVNotches,
      dxfImportCreateSeamLine: s.dxfImportCreateSeamLine,
      setDxfImportCreateSeamLine: s.setDxfImportCreateSeamLine,
      dxfImportSeamAllowanceMm: s.dxfImportSeamAllowanceMm,
      setDxfImportSeamAllowanceMm: s.setDxfImportSeamAllowanceMm,
      canvasRotationUiScale: s.canvasRotationUiScale,
      setCanvasRotationUiScale: s.setCanvasRotationUiScale,
      canvasDigitizeUiScale: s.canvasDigitizeUiScale,
      setCanvasDigitizeUiScale: s.setCanvasDigitizeUiScale,
      canvasVertexPointUiScale: s.canvasVertexPointUiScale,
      setCanvasVertexPointUiScale: s.setCanvasVertexPointUiScale,
      showPivotRotationUi: s.showPivotRotationUi,
      setShowPivotRotationUi: s.setShowPivotRotationUi,
      uiTextScale: s.uiTextScale,
      setUiTextScale: s.setUiTextScale,
    })),
  )
  const [activeTab, setActiveTab] = useState<SettingsTab>('allgemein')
  const trapRef = useFocusTrap<HTMLDivElement>(showSettingsModal)

  if (!showSettingsModal) return null

  return (
    <div className="settings-overlay" onClick={() => setShowSettingsModal(false)} role="dialog" aria-modal="true" aria-label="Einstellungen">
      <div className="settings-modal" onClick={(e) => e.stopPropagation()} ref={trapRef}>
        <div className="settings-header">
          <h2 className="settings-title">Einstellungen</h2>
          <button
            type="button"
            className="settings-close"
            onClick={() => setShowSettingsModal(false)}
            aria-label="Schließen"
          >
            &times;
          </button>
        </div>

        <div className="settings-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="settings-body">
          {activeTab === 'allgemein' && (
            <div className="settings-section">
              <h3 style={{ margin: '0 0 12px', fontSize: '14px' }}>DXF-Export</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <label style={{ fontSize: '13px' }}>
                  Skalierungsfaktor (Koordinaten × Faktor = mm im DXF)
                </label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="number"
                    style={{ width: '100px', padding: '4px 6px', fontSize: '13px' }}
                    min={0.0001}
                    step={0.01}
                    value={dxfExportScale}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value)
                      if (v > 0) setDxfExportScale(v)
                    }}
                  />
                  <span style={{ fontSize: '12px', color: '#888' }}>
                    Aktuell: ×{dxfExportScale}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {[
                    { label: '1:1 (mm)', value: 1 },
                    { label: '×0.1', value: 0.1 },
                    { label: '×0.01', value: 0.01 },
                    { label: '×0.001', value: 0.001 },
                    { label: 'px→mm (96dpi)', value: 25.4 / 96 },
                    { label: 'in→mm', value: 25.4 },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      className="sidebar-btn"
                      style={{ fontSize: '11px', padding: '3px 8px' }}
                      onClick={() => setDxfExportScale(preset.value)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <p style={{ fontSize: '11px', color: '#999', margin: '4px 0 0' }}>
                  Falls der Zuschnitt auf dem Cutter zu gross ist: Faktor verkleinern (z.B. 0.1 oder 0.01).
                  Falls zu klein: Faktor vergroessern.
                </p>
              </div>
              <h3 style={{ margin: '20px 0 12px', fontSize: '14px' }}>DXF-Import</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '13px' }}>
                  Import-Maßstab (nach DXF-Units, Standard <code>1</code>)
                </label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="number"
                    style={{ width: '100px', padding: '4px 6px', fontSize: '13px' }}
                    min={0.0001}
                    step={0.1}
                    value={dxfImportScale}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value)
                      if (v > 0) setDxfImportScale(v)
                    }}
                  />
                  <span style={{ fontSize: '12px', color: '#888' }}>
                    Aktuell: ×{dxfImportScale}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {[1, 10, 0.1].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className="sidebar-btn"
                      style={{ fontSize: '11px', padding: '3px 8px' }}
                      onClick={() => setDxfImportScale(preset)}
                    >
                      ×{preset}
                    </button>
                  ))}
                </div>
                <label style={{ fontSize: '13px' }}>
                  Zusätzliche Schnitt-Layer (Komma-getrennt, z. B. <code>MUSTER,MY_CUT</code>)
                </label>
                <input
                  type="text"
                  style={{ width: '100%', maxWidth: '420px', padding: '6px 8px', fontSize: '13px' }}
                  value={dxfImportExtraCutLayers}
                  onChange={(e) => setDxfImportExtraCutLayers(e.target.value)}
                  placeholder="z.B. MUSTER, FABRIC"
                />
                <p style={{ fontSize: '11px', color: '#999', margin: '4px 0 0' }}>
                  Falls Teile 10x zu klein importiert werden: Import-Maßstab auf <code>10</code> setzen.
                </p>
                <p style={{ fontSize: '11px', color: '#999', margin: '0' }}>
                  Wenn die Schnittkontur in der DXF-Datei auf einem anderen Layer liegt als die Standard-Layer (CUT),
                  hier die exakten Namen eintragen. Siehe auch docs/DXF-IMPORT-FREMDSYSTEME.md.
                </p>
                <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
                  <input
                    type="checkbox"
                    checked={dxfImportDetectVNotches}
                    onChange={(e) => setDxfImportDetectVNotches(e.target.checked)}
                  />
                  V-Kerben aus Kontur erkennen
                </label>
                <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                  <input
                    type="checkbox"
                    checked={dxfImportCreateSeamLine}
                    onChange={(e) => setDxfImportCreateSeamLine(e.target.checked)}
                  />
                  Nahtlinie beim Import erzeugen (wenn die DXF keine Naht-Polyline enthält)
                </label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '6px' }}>
                  <span style={{ fontSize: '13px' }}>Nahtzugabe (mm)</span>
                  <input
                    type="number"
                    style={{ width: '100px', padding: '4px 6px', fontSize: '13px' }}
                    min={0.1}
                    step={0.5}
                    disabled={!dxfImportCreateSeamLine}
                    value={dxfImportSeamAllowanceMm}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value)
                      if (v > 0) setDxfImportSeamAllowanceMm(v)
                    }}
                  />
                </div>
                <p style={{ fontSize: '11px', color: '#999', margin: '4px 0 0' }}>
                  Nahtlinie: Offset nach innen aus der Schnittkontur; die Schnittkontur wird für die Seam-as-Master-Logik
                  aus der Naht neu abgeleitet (Clipper kann geringfügig von der importierten Polylinie abweichen).
                </p>
              </div>

              <h3 style={{ margin: '20px 0 12px', fontSize: '14px' }}>Darstellung</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                <label style={{ fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                  Textgröße (Oberfläche und Beschriftungen auf der Arbeitsfläche)
                </label>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="range"
                    min={0.75}
                    max={1.75}
                    step={0.05}
                    value={uiTextScale}
                    onChange={(e) => setUiTextScale(parseFloat(e.target.value))}
                    style={{ width: 'min(100%, 280px)' }}
                    aria-valuetext={`${uiTextScale.toFixed(2)}×`}
                  />
                  <span style={{ fontSize: '12px', color: '#888', minWidth: '52px' }}>
                    {uiTextScale.toFixed(2)}×
                  </span>
                </div>
                <p style={{ fontSize: '11px', color: '#999', margin: '6px 0 0' }}>
                  Menüs, Seitenleiste und Teilnamen, Maße sowie Nahtbeschriftungen skalieren gemeinsam. Wird mit dem Projekt gespeichert.
                </p>
              </div>

              <h3 style={{ margin: '20px 0 12px', fontSize: '14px' }}>Arbeitsfläche</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <label style={{ fontSize: '13px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  <input
                    type="checkbox"
                    checked={showPivotRotationUi}
                    onChange={(e) => setShowPivotRotationUi(e.target.checked)}
                  />
                  <span>
                    Drehpunkt, Drehring und Drehgriff am Teil anzeigen
                    <span style={{ display: 'block', fontSize: '11px', color: '#999', marginTop: '4px', fontWeight: 400 }}>
                      Ausblenden räum die Bedienelemente weg; Drehen per Alt+D (Drehmodus) und Tastenkürzel bleiben möglich.
                    </span>
                  </span>
                </label>
                <div>
                  <label style={{ fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                    Drehring und Drehgriff (blau) — Größe
                  </label>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="range"
                      min={0.5}
                      max={2.5}
                      step={0.05}
                      value={canvasRotationUiScale}
                      onChange={(e) => setCanvasRotationUiScale(parseFloat(e.target.value))}
                      style={{ width: 'min(100%, 280px)' }}
                      aria-valuetext={`${canvasRotationUiScale.toFixed(2)}×`}
                    />
                    <span style={{ fontSize: '12px', color: '#888', minWidth: '52px' }}>
                      {canvasRotationUiScale.toFixed(2)}×
                    </span>
                  </div>
                  <p style={{ fontSize: '11px', color: '#999', margin: '6px 0 0' }}>
                    Sichtbare Größe bleibt beim Zoomen gleich; nur hier änderbar (wird mit dem Projekt gespeichert).
                  </p>
                </div>
                <div>
                  <label style={{ fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                    Digitalisieren — Punkte (inkl. grün zum Schließen)
                  </label>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="range"
                      min={0.5}
                      max={2.5}
                      step={0.05}
                      value={canvasDigitizeUiScale}
                      onChange={(e) => setCanvasDigitizeUiScale(parseFloat(e.target.value))}
                      style={{ width: 'min(100%, 280px)' }}
                      aria-valuetext={`${canvasDigitizeUiScale.toFixed(2)}×`}
                    />
                    <span style={{ fontSize: '12px', color: '#888', minWidth: '52px' }}>
                      {canvasDigitizeUiScale.toFixed(2)}×
                    </span>
                  </div>
                  <p style={{ fontSize: '11px', color: '#999', margin: '6px 0 0' }}>
                    Ebenfalls unabhängig vom Zoom; der grüne „Schließen“-Kreis beim ersten Punkt skaliert mit.
                  </p>
                </div>
                <div>
                  <label style={{ fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                    Eckpunkte (rot), weiche Punkte (blau), Kurvenpunkte (Bézier-Mitte)
                  </label>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="range"
                      min={0.5}
                      max={2.5}
                      step={0.05}
                      value={canvasVertexPointUiScale}
                      onChange={(e) => setCanvasVertexPointUiScale(parseFloat(e.target.value))}
                      style={{ width: 'min(100%, 280px)' }}
                      aria-valuetext={`${canvasVertexPointUiScale.toFixed(2)}×`}
                    />
                    <span style={{ fontSize: '12px', color: '#888', minWidth: '52px' }}>
                      {canvasVertexPointUiScale.toFixed(2)}×
                    </span>
                  </div>
                  <p style={{ fontSize: '11px', color: '#999', margin: '6px 0 0' }}>
                    Gilt bei „Punkte anzeigen“ bzw. Punkt-Werkzeugen; Klick-/Hover-Toleranz skaliert mit.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'farben' && (
            <div className="settings-placeholder">
              <p>Farbeinstellungen werden hier später verfügbar sein.</p>
            </div>
          )}

          {activeTab === 'pfade' && (
            <div className="settings-placeholder">
              <p>Pfad-Einstellungen werden hier später verfügbar sein.</p>
            </div>
          )}

          {activeTab === 'notches' && (
            <div className="settings-notches">
              <table className="settings-notch-table">
                <thead>
                  <tr>
                    <th>Nr.</th>
                    <th>Typ</th>
                    <th>Breite (mm)</th>
                    <th>Tiefe (mm)</th>
                  </tr>
                </thead>
                <tbody>
                  {notchSettings.map((notch, i) => (
                    <tr key={i}>
                      <td className="notch-nr">{i + 1}</td>
                      <td>
                        <select
                          className="notch-select"
                          value={notch.type}
                          onChange={(e) =>
                            updateNotchSetting(i, { type: e.target.value as NotchType })
                          }
                        >
                          <option value="keine">Keine Notch</option>
                          <option value="strich">Strich</option>
                          <option value="kerbe">Kerbe</option>
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          className="notch-input"
                          min={0.5}
                          max={20}
                          step={0.5}
                          value={notch.widthMm}
                          onChange={(e) =>
                            updateNotchSetting(i, { widthMm: parseFloat(e.target.value) || 0 })
                          }
                          disabled={notch.type === 'strich' || notch.type === 'keine'}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="notch-input"
                          min={0.5}
                          max={20}
                          step={0.5}
                          value={notch.depthMm}
                          onChange={(e) =>
                            updateNotchSetting(i, { depthMm: parseFloat(e.target.value) || 0 })
                          }
                          disabled={notch.type === 'keine'}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="settings-footer">
          <button
            type="button"
            className="sidebar-btn primary"
            onClick={() => setShowSettingsModal(false)}
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  )
}
