import { useState } from 'react'
import { useStore } from '../store/useStore'
import type { NotchType } from '../store/useStore'

type SettingsTab = 'allgemein' | 'farben' | 'pfade' | 'notches'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'allgemein', label: 'Allgemein' },
  { id: 'farben', label: 'Farben' },
  { id: 'pfade', label: 'Pfade' },
  { id: 'notches', label: 'Notches' },
]

export function SettingsModal() {
  const { showSettingsModal, setShowSettingsModal, notchSettings, updateNotchSetting, dxfExportScale, setDxfExportScale } = useStore()
  const [activeTab, setActiveTab] = useState<SettingsTab>('allgemein')

  if (!showSettingsModal) return null

  return (
    <div className="settings-overlay" onClick={() => setShowSettingsModal(false)}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
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
                          disabled={notch.type === 'strich'}
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
