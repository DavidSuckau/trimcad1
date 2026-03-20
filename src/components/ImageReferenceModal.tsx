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

  const lengthMm = useMemo(() => parseFloat(lengthMmStr), [lengthMmStr])
  const MIN_REFERENCE_LENGTH_MM = 100
  const canConfirm = Number.isFinite(lengthMm) && lengthMm >= MIN_REFERENCE_LENGTH_MM && pixelLength >= 1e-9

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
            type="number"
            min={MIN_REFERENCE_LENGTH_MM}
            step={0.1}
            value={lengthMmStr}
            onChange={(e) => setLengthMmStr(e.target.value)}
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
              Bitte mindestens {MIN_REFERENCE_LENGTH_MM} mm eingeben.
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

