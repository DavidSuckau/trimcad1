import { useState, useEffect } from 'react'
import { useStore } from '../store/useStore'
import {
  SEAM_ASSIGNMENT_KIND_IDS,
  SEAM_ASSIGNMENT_KIND_LABELS,
  type SeamAssignmentKindId,
} from '../types/model'

export function SeamAssignmentMetaModal() {
  const seamAssignmentMetaDialogId = useStore((s) => s.seamAssignmentMetaDialogId)
  const setSeamAssignmentMetaDialogId = useStore((s) => s.setSeamAssignmentMetaDialogId)
  const updateSeamAssignmentMeta = useStore((s) => s.updateSeamAssignmentMeta)
  const setToastMessage = useStore((s) => s.setToastMessage)
  const workspace = useStore((s) => s.workspace)

  const assignment = workspace.seamAssignments.find((a) => a.id === seamAssignmentMetaDialogId)
  const pieceA = assignment ? workspace.pieces.find((p) => p.id === assignment.pieceIdA) : null
  const pieceB = assignment ? workspace.pieces.find((p) => p.id === assignment.pieceIdB) : null

  const [orderStr, setOrderStr] = useState('')
  const [kind, setKind] = useState<SeamAssignmentKindId | ''>('')

  useEffect(() => {
    if (!assignment) return
    setOrderStr(assignment.orderNumber != null ? String(assignment.orderNumber) : '')
    setKind((assignment.seamKind as SeamAssignmentKindId | undefined) ?? '')
  }, [assignment?.id, assignment?.orderNumber, assignment?.seamKind])

  if (!seamAssignmentMetaDialogId || !assignment || !pieceA || !pieceB) return null

  const nameA = pieceA.name || `Teil ${pieceA.number}`
  const nameB = pieceB.name || `Teil ${pieceB.number}`

  const save = () => {
    const trimmed = orderStr.trim()
    let orderNumber: number | null
    if (trimmed === '') {
      orderNumber = null
    } else {
      if (!/^\d+$/.test(trimmed)) {
        setToastMessage('error:Bitte eine ganze Zahl ≥ 1 oder leer lassen.')
        return
      }
      const n = parseInt(trimmed, 10)
      if (n < 1) {
        setToastMessage('error:Bitte eine ganze Zahl ≥ 1 oder leer lassen.')
        return
      }
      orderNumber = n
    }
    updateSeamAssignmentMeta(assignment.id, {
      orderNumber,
      seamKind: kind === '' ? null : kind,
    })
  }

  return (
    <div className="nahtzugabe-dialog-overlay" onClick={() => setSeamAssignmentMetaDialogId(null)}>
      <div className="nahtzugabe-dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 340 }}>
        <h3 className="nahtzugabe-dialog-title">Nahtzuordnung</h3>
        <p className="nahtzugabe-dialog-hint" style={{ marginBottom: '0.75rem' }}>
          {nameA} ↔ {nameB}
        </p>
        <label className="nahtzugabe-dialog-label">
          <span>Näh-Reihenfolge (Nummer, je Nummer nur einmal)</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className="nahtzugabe-dialog-input"
            value={orderStr}
            onChange={(e) => setOrderStr(e.target.value.replace(/\D/g, ''))}
            placeholder="Leer = keine Reihenfolge"
          />
        </label>
        <label className="nahtzugabe-dialog-label">
          <span>Art der Naht</span>
          <select
            className="nahtzugabe-dialog-input"
            value={kind}
            onChange={(e) => setKind((e.target.value || '') as SeamAssignmentKindId | '')}
          >
            <option value="">— nicht festgelegt —</option>
            {SEAM_ASSIGNMENT_KIND_IDS.map((id) => (
              <option key={id} value={id}>
                {SEAM_ASSIGNMENT_KIND_LABELS[id]}
              </option>
            ))}
          </select>
        </label>
        <div className="nahtzugabe-dialog-actions" style={{ justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button
            type="button"
            className="menubar-dropdown-btn"
            style={{ background: '#fff' }}
            onClick={() => setSeamAssignmentMetaDialogId(null)}
          >
            Abbrechen
          </button>
          <button
            type="button"
            className="menubar-dropdown-btn"
            style={{ background: '#1976d2', color: '#fff' }}
            onClick={save}
          >
            Speichern
          </button>
        </div>
      </div>
    </div>
  )
}
