import { useState, useEffect, useMemo, useRef } from 'react'
import { useStore } from '../store/useStore'
import { enumerateEdges } from '../geometry/edgeEnumeration'
import { edgeTotalLength } from '../geometry/seamUtils'

export function ProfileAssignmentDialog() {
  const {
    workspace,
    profileDialogAssignmentId,
    setProfileDialogAssignmentId,
    updateProfileAssignment,
    removeProfileAssignment,
  } = useStore()

  const assignment =
    profileDialogAssignmentId != null
      ? (workspace.profileAssignments ?? []).find((pa) => pa.id === profileDialogAssignmentId)
      : null

  const piece = assignment ? workspace.pieces.find((p) => p.id === assignment.pieceId) : null

  const [profileName, setProfileName] = useState('')
  const [profileKey, setProfileKey] = useState('')
  const [supplierNumber, setSupplierNumber] = useState('')
  const [internalArticleNumber, setInternalArticleNumber] = useState('')
  const [seamAllowanceStr, setSeamAllowanceStr] = useState('')
  const [pdfDocumentUrl, setPdfDocumentUrl] = useState('')

  useEffect(() => {
    if (assignment) {
      setProfileName(assignment.profileName)
      setProfileKey(assignment.profileKey)
      setSupplierNumber(assignment.supplierNumber ?? '')
      setInternalArticleNumber(assignment.internalArticleNumber ?? '')
      setSeamAllowanceStr(assignment.seamAllowanceMm != null ? String(assignment.seamAllowanceMm) : '')
      setPdfDocumentUrl(assignment.pdfDocumentUrl ?? '')
    }
  }, [assignment?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const edgeLengthMm = useMemo(() => {
    if (!piece || !assignment) return 0
    const edges = enumerateEdges(piece)
    const edge = edges.find((e) => e.edgeIndex === assignment.edgeIndex)
    if (!edge) return 0
    return edgeTotalLength(piece, edge.curveIndices)
  }, [piece, assignment])

  useEffect(() => {
    if (profileDialogAssignmentId && !assignment) {
      setProfileDialogAssignmentId(null)
    }
  }, [profileDialogAssignmentId, assignment, setProfileDialogAssignmentId])

  if (!profileDialogAssignmentId || !assignment || !piece) return null

  const isValid = profileName.trim().length > 0 && profileKey.trim().length > 0

  const handleSave = () => {
    if (!isValid) return
    const seamMm = parseFloat(seamAllowanceStr)
    updateProfileAssignment(assignment.id, {
      profileName: profileName.trim(),
      profileKey: profileKey.trim(),
      supplierNumber: supplierNumber.trim() || undefined,
      internalArticleNumber: internalArticleNumber.trim() || undefined,
      seamAllowanceMm: Number.isFinite(seamMm) && seamMm > 0 ? seamMm : undefined,
      pdfDocumentUrl: pdfDocumentUrl.trim() || undefined,
    })
    setProfileDialogAssignmentId(null)
  }

  const handleDelete = () => {
    removeProfileAssignment(assignment.id)
  }

  const handleClose = () => {
    setProfileDialogAssignmentId(null)
  }

  return (
    <div className="nahtzugabe-dialog-overlay" onClick={handleClose} role="presentation">
      <div className="nahtzugabe-dialog" style={{ minWidth: 360 }} onClick={(e) => e.stopPropagation()}>
        <h3 className="nahtzugabe-dialog-title">Profil – Kante {assignment.edgeIndex + 1}</h3>

        <label className="nahtzugabe-dialog-label">
          <span>Profilbezeichnung *</span>
          <input
            type="text"
            className="nahtzugabe-dialog-input"
            style={{ width: '100%', boxSizing: 'border-box' }}
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            autoComplete="off"
            autoFocus
          />
        </label>

        <label className="nahtzugabe-dialog-label">
          <span>Kennung (Buchstabe) *</span>
          <input
            type="text"
            className="nahtzugabe-dialog-input"
            style={{ width: 80, boxSizing: 'border-box' }}
            value={profileKey}
            maxLength={3}
            onChange={(e) => setProfileKey(e.target.value.toUpperCase())}
            autoComplete="off"
          />
        </label>

        <label className="nahtzugabe-dialog-label">
          <span>Lieferantennummer</span>
          <input
            type="text"
            className="nahtzugabe-dialog-input"
            style={{ width: '100%', boxSizing: 'border-box' }}
            value={supplierNumber}
            onChange={(e) => setSupplierNumber(e.target.value)}
            autoComplete="off"
          />
        </label>

        <label className="nahtzugabe-dialog-label">
          <span>Interne Artikelnummer</span>
          <input
            type="text"
            className="nahtzugabe-dialog-input"
            style={{ width: '100%', boxSizing: 'border-box' }}
            value={internalArticleNumber}
            onChange={(e) => setInternalArticleNumber(e.target.value)}
            autoComplete="off"
          />
        </label>

        <label className="nahtzugabe-dialog-label">
          <span>Nahtzugabe (mm)</span>
          <input
            type="number"
            className="nahtzugabe-dialog-input"
            style={{ width: 100, boxSizing: 'border-box' }}
            value={seamAllowanceStr}
            min={0}
            step={0.5}
            onChange={(e) => setSeamAllowanceStr(e.target.value)}
            placeholder="optional"
          />
        </label>

        <div className="nahtzugabe-dialog-label" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <span>Profillänge:</span>
          <strong>{edgeLengthMm.toFixed(1)} mm</strong>
        </div>

        <PdfDocumentField value={pdfDocumentUrl} onChange={setPdfDocumentUrl} />

        <div className="nahtzugabe-dialog-actions" style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="sidebar-btn primary"
            onClick={handleSave}
            disabled={!isValid}
          >
            Speichern
          </button>
          <button
            type="button"
            className="sidebar-btn"
            style={{ color: '#c62828' }}
            onClick={handleDelete}
          >
            Löschen
          </button>
          <button type="button" className="sidebar-btn" onClick={handleClose}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  )
}

function PdfDocumentField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  useEffect(() => {
    if (value.startsWith('data:')) {
      if (!fileName) setFileName('(eingebettete PDF)')
    } else {
      setFileName(null)
    }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileSelect = () => fileRef.current?.click()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type !== 'application/pdf') {
      alert('Bitte eine PDF-Datei auswählen.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      onChange(dataUrl)
      setFileName(file.name)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleClear = () => {
    onChange('')
    setFileName(null)
  }

  const isDataUrl = value.startsWith('data:')

  return (
    <div className="nahtzugabe-dialog-label">
      <span>PDF-Dokument</span>
      {isDataUrl ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#555', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fileName ?? '(PDF geladen)'}
          </span>
          <button
            type="button"
            className="sidebar-btn"
            style={{ fontSize: 11, padding: '2px 8px' }}
            onClick={handleFileSelect}
          >
            Andere PDF …
          </button>
          <button
            type="button"
            style={{ background: 'none', border: 'none', color: '#c62828', cursor: 'pointer', fontSize: 12, padding: '2px 4px' }}
            onClick={handleClear}
            title="PDF entfernen"
          >
            ✕
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="text"
            className="nahtzugabe-dialog-input"
            style={{ flex: 1, boxSizing: 'border-box' }}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="URL oder PDF laden →"
            autoComplete="off"
          />
          <button
            type="button"
            className="sidebar-btn"
            style={{ fontSize: 11, padding: '4px 10px', whiteSpace: 'nowrap' }}
            onClick={handleFileSelect}
          >
            PDF laden
          </button>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </div>
  )
}
