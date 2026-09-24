import type { ProfileAssignment } from '../types/model'
import { PDFDocument } from 'pdf-lib'

export type ProfilePdfAttachment = {
  /** Eindeutiger Quell-String (data:… oder URL). */
  source: string
  /** Anzeige: Kennungen/Namen der Profile, die dieses PDF nutzen. */
  label: string
}

/**
 * Sammelt eindeutige Profil-PDFs (data-URL oder http(s)/Pfad).
 * Gleiche Quelle nur einmal — mehrere Profile mit derselben Zeichnung teilen eine Anlage.
 */
export function collectUniqueProfilePdfAttachments(
  assignments: ProfileAssignment[],
): ProfilePdfAttachment[] {
  const bySource = new Map<string, { keys: string[]; names: string[] }>()
  for (const pa of assignments) {
    const src = pa.pdfDocumentUrl?.trim()
    if (!src) continue
    const entry = bySource.get(src) ?? { keys: [], names: [] }
    if (pa.profileKey && !entry.keys.includes(pa.profileKey)) entry.keys.push(pa.profileKey)
    if (pa.profileName && !entry.names.includes(pa.profileName)) entry.names.push(pa.profileName)
    bySource.set(src, entry)
  }
  return [...bySource.entries()].map(([source, meta]) => {
    const keyPart = meta.keys.length ? meta.keys.join(', ') : 'Profil'
    const namePart = meta.names.length ? ` – ${meta.names.join(', ')}` : ''
    return { source, label: `${keyPart}${namePart}` }
  })
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new Error('Ungültige data-URL')
  const meta = dataUrl.slice(0, comma)
  const data = dataUrl.slice(comma + 1)
  if (meta.includes(';base64')) {
    const binary = atob(data)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  }
  return new TextEncoder().encode(decodeURIComponent(data))
}

/** Lädt PDF-Bytes aus data-URL oder Remote-URL. */
export async function loadPdfBytesFromSource(source: string): Promise<Uint8Array> {
  if (source.startsWith('data:')) {
    return dataUrlToUint8Array(source)
  }
  const res = await fetch(source)
  if (!res.ok) {
    throw new Error(`PDF konnte nicht geladen werden (${res.status})`)
  }
  return new Uint8Array(await res.arrayBuffer())
}

export type AppendProfilePdfsResult = {
  /** Fertige PDF-Bytes (Stückliste + angehängte Zeichnungen). */
  bytes: Uint8Array
  /** Anzahl angehängter Quell-PDFs. */
  attachedCount: number
  /** Anzahl hinzugefügter Seiten aus Profil-Zeichnungen. */
  attachedPages: number
  /** Fehler je Quelle (nicht abbrechen). */
  warnings: string[]
}

/**
 * Hängt Profil-Zeichnungs-PDFs an die Stücklisten-PDF an.
 * Jede Seite jeder Zeichnung wird als eigene Seite übernommen.
 */
export async function appendProfilePdfsToStueckliste(
  stuecklistePdfBytes: ArrayBuffer | Uint8Array,
  attachments: ProfilePdfAttachment[],
): Promise<AppendProfilePdfsResult> {
  const merged = await PDFDocument.create()
  const bomDoc = await PDFDocument.load(stuecklistePdfBytes)
  const bomPages = await merged.copyPages(bomDoc, bomDoc.getPageIndices())
  for (const page of bomPages) merged.addPage(page)

  let attachedCount = 0
  let attachedPages = 0
  const warnings: string[] = []

  for (const att of attachments) {
    try {
      const bytes = await loadPdfBytesFromSource(att.source)
      const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true })
      const indices = srcDoc.getPageIndices()
      if (indices.length === 0) {
        warnings.push(`${att.label}: PDF ohne Seiten übersprungen.`)
        continue
      }
      const pages = await merged.copyPages(srcDoc, indices)
      for (const page of pages) merged.addPage(page)
      attachedCount += 1
      attachedPages += pages.length
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unbekannter Fehler'
      warnings.push(`${att.label}: ${msg}`)
    }
  }

  const bytes = await merged.save()
  return { bytes, attachedCount, attachedPages, warnings }
}

/** Browser-Download einer PDF als Blob. */
export function downloadPdfBytes(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
