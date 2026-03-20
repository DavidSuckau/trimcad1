import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import type { Point } from '../types/model'

export function ImageReferenceModal({
  referenceLinePx,
  onConfirm,
  onCancel,
}: {
  referenceLinePx: { start: Point; end: Point }
  onConfirm: () => void
  onCancel: () => void
}) {
  const setImageCalibration = useStore((s) => s.setImageCalibration)
  const startImageDigitize = useStore((s) => s.startImageDigitize)

  const pixelLength = useMemo(
    () => Math.hypot(referenceLinePx.end.x - referenceLinePx.start.x, referenceLinePx.end.y - referenceLinePx.start.y),
    [referenceLinePx]
  )

  const [lengthMmStr, setLengthMmStr] = useState('100')

  // Fuer MVP: Nutzer kann auch "400 mm" oder "400,5" eingeben.
  // Extrahiert die erste Zahl aus dem String und interpretiert sie als mm.
  const lengthMm = useMemo(() => {
    const normalized = lengthMmStr.trim().replace(',', '.')
    const match = normalized.match(/-?\d+(\.\d+)?/)
    if (!match) return NaN
    return parseFloat(match[0])
  }, [lengthMmStr])
  // Fuer MVP: keine harte Mindestlaenge erzwingen.
  // Entscheidend ist nur: reale Laenge > 0 und Pixellaenge ist nicht praktisch 0.
  const lengthOk = Number.isFinite(lengthMm) && lengthMm > 0
  const pixelOk = Number.isFinite(pixelLength) && pixelLength > 0
  const canConfirm = lengthOk && pixelOk

  return (
    <div className="nahtzugabe-dialog-overlay" onClick={onCancel}>
      <div className="nahtzugabe-dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 320 }}>
        <h3 className="nahtzugabe-dialog-title">Bild kalibrieren</h3>

        <div style={{ fontSize: '0.8125rem', color: '#333', marginBottom: '0.75rem', lineHeight: 1.5 }}>
          Referenzlinie: {pixelLength.toFixed(1)} px
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '1rem' }}>
          <label style={{ fontSize: '0.8125rem', color: '#555' }}>
            Reale Länge der Referenzlinie (mm)
          </label>
          <input
            step={0.1}
            value={lengthMmStr}
            autoFocus
            onChange={(e) => {
              setLengthMmStr(e.target.value)
            }}
            style={{
              width: '100%',
              padding: '0.5rem 0.6rem',
              borderRadius: 6,
              border: '1px solid #ccc',
              fontSize: '0.8125rem',
            }}
          />
          {!canConfirm && (
            <div style={{ color: '#c62828', fontSize: '0.8125rem' }}>
              {!lengthOk ? (
                <>Bitte eine gueltige Laenge eingeben (Einheit: mm).</>
              ) : (
                <>Die Referenzlinie ist ungueltig (Pixellaenge zu klein).</>
              )}
            </div>
          )}
        </div>

        <div className="nahtzugabe-dialog-actions" style={{ flexDirection: 'column', gap: '0.4rem' }}>
          <button
            disabled={!canConfirm}
            style={{
              padding: '0.5rem 0.75rem',
              fontSize: '0.8125rem',
              border: '1px solid #ccc',
              borderRadius: 4,
              background: canConfirm ? '#1976d2' : '#e0e0e0',
              color: canConfirm ? '#fff' : '#999',
              cursor: canConfirm ? 'pointer' : 'default',
            }}
            onClick={() => {
              if (!canConfirm) return
              const mmPerPixel = lengthMm / pixelLength
              setImageCalibration({ mmPerPixel, referenceLinePx })
              startImageDigitize()
              onConfirm()
            }}
          >
            OK
          </button>
          <button
            style={{
              padding: '0.5rem 0.75rem',
              fontSize: '0.8125rem',
              border: '1px solid #ccc',
              borderRadius: 4,
              background: '#fff',
              color: '#333',
              cursor: 'pointer',
            }}
            onClick={onCancel}
          >
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  )
}

