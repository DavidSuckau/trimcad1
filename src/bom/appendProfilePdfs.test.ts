import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  appendProfilePdfsToStueckliste,
  collectUniqueProfilePdfAttachments,
} from './appendProfilePdfs'
import type { ProfileAssignment } from '../types/model'

function pa(partial: Partial<ProfileAssignment> & Pick<ProfileAssignment, 'id' | 'profileKey' | 'profileName'>): ProfileAssignment {
  return {
    pieceId: 'p1',
    edgeIndex: 0,
    ...partial,
  }
}

describe('collectUniqueProfilePdfAttachments', () => {
  it('dedupliziert gleiche PDF-Quelle und sammelt Kennungen', () => {
    const list = collectUniqueProfilePdfAttachments([
      pa({ id: '1', profileKey: 'A', profileName: 'Rohr', pdfDocumentUrl: 'data:application/pdf;base64,AAA' }),
      pa({ id: '2', profileKey: 'B', profileName: 'Rohr2', pdfDocumentUrl: 'data:application/pdf;base64,AAA' }),
      pa({ id: '3', profileKey: 'C', profileName: 'Anderes', pdfDocumentUrl: 'https://example.com/x.pdf' }),
      pa({ id: '4', profileKey: 'D', profileName: 'Ohne' }),
    ])
    expect(list).toHaveLength(2)
    expect(list[0].source).toContain('base64')
    expect(list[0].label).toContain('A')
    expect(list[0].label).toContain('B')
    expect(list[1].source).toContain('example.com')
  })
})

describe('appendProfilePdfsToStueckliste', () => {
  it('hängt jede Seite der Zeichnung als eigene Seite an', async () => {
    const bom = await PDFDocument.create()
    bom.addPage([841.89, 595.28]) // A3 landscape-ish
    const bomBytes = await bom.save()

    const drawing = await PDFDocument.create()
    drawing.addPage([595.28, 841.89])
    drawing.addPage([595.28, 841.89])
    const drawingBytes = await drawing.save()
    // data-URL
    let binary = ''
    for (let i = 0; i < drawingBytes.length; i++) binary += String.fromCharCode(drawingBytes[i]!)
    const dataUrl = `data:application/pdf;base64,${btoa(binary)}`

    const result = await appendProfilePdfsToStueckliste(bomBytes, [
      { source: dataUrl, label: 'A – Test' },
    ])
    expect(result.attachedCount).toBe(1)
    expect(result.attachedPages).toBe(2)
    expect(result.warnings).toHaveLength(0)

    const merged = await PDFDocument.load(result.bytes)
    expect(merged.getPageCount()).toBe(3) // 1 BOM + 2 Zeichnung
  })
})
