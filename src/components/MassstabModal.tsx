import { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'

export function MassstabModal() {
  const massstabDialog = useStore((s) => s.massstabDialog)
  const setMassstabDialog = useStore((s) => s.setMassstabDialog)
  const applyMassstab = useStore((s) => s.applyMassstab)
  const tool = useStore((s) => s.tool)
  const [targetMm, setTargetMm] = useState('')

  useEffect(() => {
    if (massstabDialog) {
      setTargetMm(String(Math.round(massstabDialog.currentLengthMm * 100) / 100))
    }
  }, [massstabDialog])

  useEffect(() => {
    if (tool !== 'massstab' && massstabDialog) {
      setMassstabDialog(null)
    }
  }, [tool, massstabDialog, setMassstabDialog])

  if (!massstabDialog) return null

  const { currentLengthMm } = massstabDialog

  return (
    <div className="nahtzugabe-dialog-overlay" onClick={() => setMassstabDialog(null)} role="dialog" aria-modal="true" aria-label="Maßstab">
      <div className="nahtzugabe-dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 300 }}>
        <h3 className="nahtzugabe-dialog-title">Maßstab (Referenzkante)</h3>
        <div style={{ fontSize: '0.8125rem', color: '#333', marginBottom: '0.75rem', lineHeight: 1.5 }}>
          Aktuelle Kantenlänge: <strong>{currentLengthMm.toFixed(1)} mm</strong>
        </div>
        <label style={{ display: 'block', fontSize: '0.8125rem', color: '#333', marginBottom: 6 }}>
          Ziel-Länge (mm)
        </label>
        <input
          type="number"
          step={0.1}
          min={0.01}
          value={targetMm}
          onChange={(e) => setTargetMm(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '6px 8px',
            border: '1px solid #ccc',
            borderRadius: 4,
            fontSize: 14,
            marginBottom: '1rem',
          }}
        />
        <div className="nahtzugabe-dialog-actions" style={{ justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button
            type="button"
            style={{
              padding: '0.5rem 0.75rem',
              fontSize: '0.8125rem',
              border: '1px solid #ccc',
              borderRadius: 4,
              background: '#fff',
              color: '#333',
              cursor: 'pointer',
            }}
            onClick={() => setMassstabDialog(null)}
          >
            Abbrechen
          </button>
          <button
            type="button"
            style={{
              padding: '0.5rem 0.75rem',
              fontSize: '0.8125rem',
              border: '1px solid #1976d2',
              borderRadius: 4,
              background: '#1976d2',
              color: '#fff',
              cursor: 'pointer',
            }}
            onClick={() => {
              const n = parseFloat(targetMm.replace(',', '.'))
              applyMassstab(n)
            }}
          >
            Anwenden
          </button>
        </div>
      </div>
    </div>
  )
}
