import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import type { Workspace } from '../types/model'
import { aggregateBomByMaterial, getCutLineAreaMm2, getCutLinePerimeterMm, materialLabelForBom } from './pieceBomStats'
import { aggregateProfileBom } from './profileBomStats'
import { buildMaterialPieSvgDocument } from './buildMaterialPieSvg'
import { computeMaterialAreaShares } from './materialAreaShare'
import { buildNaehplanRows } from './naehplan'
import { buildWorkspaceOverviewSvgDocument } from '../workspace/buildWorkspaceOverviewSvg'
import type { OverviewImageSession } from '../workspace/workspaceOverviewBounds'

function fmtAreaM2(mm2: number): string {
  return (mm2 / 1_000_000).toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}

function fmtLenM(mm: number): string {
  return (mm / 1000).toLocaleString('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
}

function fmtTotalArea(m2: number): string {
  return m2.toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}

function fmtTotalPerimeter(m: number): string {
  return m.toLocaleString('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
}

function safeFilenamePart(name: string): string {
  return name.replace(/[^\w\u00C0-\u024f-]+/g, '_').replace(/_+/g, '_').slice(0, 60) || 'trimtex'
}

/** SVG (inkl. eingebetteter data-URL-Bilder) zu PNG-Daten-URL; max. Kantenlänge in Pixeln. */
function svgDocumentToPngDataUrl(svg: string, maxSidePx: number): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width
        const h = img.naturalHeight || img.height
        if (!w || !h) {
          URL.revokeObjectURL(url)
          resolve(null)
          return
        }
        const scale = maxSidePx / Math.max(w, h)
        const cw = Math.max(1, Math.round(w * scale))
        const ch = Math.max(1, Math.round(h * scale))
        const canvas = document.createElement('canvas')
        canvas.width = cw
        canvas.height = ch
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          URL.revokeObjectURL(url)
          resolve(null)
          return
        }
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, cw, ch)
        ctx.drawImage(img, 0, 0, cw, ch)
        const dataUrl = canvas.toDataURL('image/png')
        URL.revokeObjectURL(url)
        resolve(dataUrl)
      } catch {
        URL.revokeObjectURL(url)
        resolve(null)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

export type StuecklistePdfParams = {
  workspace: Workspace
  docDateLabel: string
  imageSession: OverviewImageSession | null
  imageDataUrl: string | null
}

type TechnicalPreviewPageParams = {
  pageW: number
  pageH: number
  png: string
  workspaceName: string
  docDateLabel: string
  projectFileName?: string
  bomDocumentVersion?: string
  bomDeveloperName: string
  bomEngineerName: string
}

/**
 * Eine volle Seite mit Zeichnungsrahmen (DIN-nah: Außenrahmen, Innenrahmen, Plankopf mit Maßstab).
 */
function drawWorkspacePreviewTechnicalPage(doc: jsPDF, p: TechnicalPreviewPageParams): void {
  const M = 10
  const FRAME_GAP = 2.5
  const TITLE_BLOCK_H = 26
  const HEADER_H = 14

  const { pageW, pageH } = p
  const outerW = pageW - 2 * M
  const outerH = pageH - 2 * M

  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.65)
  doc.rect(M, M, outerW, outerH, 'S')

  doc.setLineWidth(0.22)
  doc.rect(M + FRAME_GAP, M + FRAME_GAP, outerW - 2 * FRAME_GAP, outerH - 2 * FRAME_GAP, 'S')

  const innerLeft = M + FRAME_GAP
  const innerTop = M + FRAME_GAP
  const innerW = outerW - 2 * FRAME_GAP
  const innerBottom = M + outerH - FRAME_GAP
  const titleTop = innerBottom - TITLE_BLOCK_H

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(30, 30, 30)
  doc.text('Vorschau Arbeitsfläche', innerLeft + 3, innerTop + 6)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(90, 90, 90)
  doc.text('Technische Vektoransicht · Schnitt-/Nahtkontur, Laufrichtung (mm)', innerLeft + 3, innerTop + 11)
  doc.setTextColor(0, 0, 0)

  const drawFieldTop = innerTop + HEADER_H + 2
  const drawFieldH = Math.max(24, titleTop - drawFieldTop - 2)

  const imgProps = doc.getImageProperties(p.png)
  const iwPx = imgProps.width
  const ihPx = imgProps.height
  const aspect = ihPx / iwPx
  const pad = 6
  let dwMm = innerW - 2 * pad
  let dhMm = dwMm * aspect
  if (dhMm > drawFieldH) {
    dhMm = drawFieldH
    dwMm = dhMm / aspect
  }
  const imgX = innerLeft + (innerW - dwMm) / 2
  const imgY = drawFieldTop + (drawFieldH - dhMm) / 2
  doc.addImage(p.png, 'PNG', imgX, imgY, dwMm, dhMm, undefined, 'MEDIUM')

  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.3)
  doc.line(innerLeft, titleTop, innerLeft + innerW, titleTop)

  const col1 = innerW * 0.26
  const col2 = innerW * 0.26
  const col3 = innerW * 0.22
  const x1 = innerLeft + col1
  const x2 = innerLeft + col1 + col2
  const x3 = innerLeft + col1 + col2 + col3

  doc.setLineWidth(0.18)
  doc.line(x1, titleTop, x1, innerBottom)
  doc.line(x2, titleTop, x2, innerBottom)
  doc.line(x3, titleTop, x3, innerBottom)

  const tbY = titleTop + 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(70, 70, 70)
  doc.text('Projekt / Arbeitsfläche', innerLeft + 2, tbY)
  doc.text('Datei', x1 + 2, tbY)
  doc.text('Version', x2 + 2, tbY)
  doc.text('Datum', x3 + 2, tbY)

  doc.setFontSize(8)
  doc.setTextColor(0, 0, 0)
  const projLines = doc.splitTextToSize(p.workspaceName, col1 - 4)
  doc.text(projLines, innerLeft + 2, tbY + 3.5)
  doc.text(p.projectFileName?.trim() ? p.projectFileName : '—', x1 + 2, tbY + 3.5)
  doc.text(p.bomDocumentVersion?.trim() ? p.bomDocumentVersion : '—', x2 + 2, tbY + 3.5)
  doc.text(p.docDateLabel, x3 + 2, tbY + 3.5)

  const tbY2 = titleTop + 16
  doc.setFontSize(6.5)
  doc.setTextColor(70, 70, 70)
  doc.text('Maßstab', innerLeft + 2, tbY2)
  doc.text('Entwickler', x1 + 2, tbY2)
  doc.text('Ingenieur', x2 + 2, tbY2)

  doc.setFontSize(8)
  doc.setTextColor(0, 0, 0)
  doc.text('Modellmaße in mm (Papier skaliert)', innerLeft + 2, tbY2 + 3.5)
  doc.text(p.bomDeveloperName || '—', x1 + 2, tbY2 + 3.5)
  doc.text(p.bomEngineerName || '—', x2 + 2, tbY2 + 3.5)

  doc.setFontSize(6.5)
  doc.setTextColor(100, 100, 100)
  doc.text(
    'Hinweis: Darstellung auf dem Papier skaliert; Maße im Modell in mm.',
    innerLeft + 2,
    innerBottom - 3,
  )
}

/**
 * Stückliste als DIN A3 Querformat-PDF (Übersicht: Kopf, Tabellen, optional Vorschau-Grafik).
 */
export async function downloadStuecklistePdf(params: StuecklistePdfParams): Promise<void> {
  const { workspace, docDateLabel, imageSession, imageDataUrl } = params
  const { pieces } = workspace
  const aggregate = aggregateBomByMaterial(
    pieces.map((p) => ({
      materialKey: p.material ?? '',
      quantity: p.bomQuantity ?? 1,
      areaMm2: getCutLineAreaMm2(p),
      perimeterMm: getCutLinePerimeterMm(p),
    })),
  )

  const margin = 12
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const contentW = pageW - 2 * margin

  let y = margin

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('Stückliste', margin, y)
  y += 9

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  const metaLines: string[] = []
  metaLines.push(`Arbeitsfläche: ${workspace.name}`)
  if (workspace.projectFileName) metaLines.push(`Datei: ${workspace.projectFileName}`)
  metaLines.push(`Datum: ${docDateLabel}`)
  if (workspace.bomDocumentVersion) metaLines.push(`Version: ${workspace.bomDocumentVersion}`)
  const devName = (workspace.bomDeveloperName ?? '').trim()
  const engName = (workspace.bomEngineerName ?? '').trim()
  metaLines.push(`Entwickler: ${devName || '—'}`)
  metaLines.push(`Ingenieur: ${engName || '—'}`)

  for (const line of metaLines) {
    doc.text(line, margin, y)
    y += 5
  }
  y += 3

  const bodyRows: (string | number)[][] = pieces.map((p, i) => {
    const areaMm2 = getCutLineAreaMm2(p)
    const perMm = getCutLinePerimeterMm(p)
    const q = p.bomQuantity ?? 1
    const desc = (p.description ?? '').trim()
    return [
      i + 1,
      p.name,
      desc || '—',
      q,
      fmtAreaM2(areaMm2),
      fmtLenM(perMm),
      p.notches.length,
      p.material?.trim() ? p.material : '—',
    ]
  })

  autoTable(doc, {
    startY: y,
    head: [['Nr.', 'Name', 'Beschreibung', 'Stückzahl', 'Fläche (m²)', 'Umfang (m)', 'Kerben', 'Material']],
    body: bodyRows.length ? bodyRows : [['—', 'Keine Teile', '—', '—', '—', '—', '—', '—']],
    showHead: 'everyPage',
    styles: { fontSize: 8, cellPadding: 1.2, overflow: 'linebreak' },
    headStyles: { fillColor: [230, 230, 233], textColor: 20, fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [252, 252, 253] },
    margin: { left: margin, right: margin },
    tableWidth: contentW,
    theme: 'grid',
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 32 },
      2: { cellWidth: 38 },
      3: { cellWidth: 16 },
      4: { cellWidth: 22 },
      5: { cellWidth: 20 },
      6: { cellWidth: 14 },
      7: { cellWidth: 'auto' },
    },
  })

  const docExt = doc as { lastAutoTable?: { finalY: number } }
  y = (docExt.lastAutoTable?.finalY ?? y) + 10

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Summen je Material', margin, y)
  y += 6

  const matBody = aggregate.byMaterial.map((g) => [
    materialLabelForBom(g.materialKey),
    g.quantitySum,
    fmtTotalArea(g.totalAreaM2),
    fmtTotalPerimeter(g.totalPerimeterM),
  ])

  autoTable(doc, {
    startY: y,
    head: [['Material', 'Σ Stückzahl', 'Σ Fläche (m²)', 'Σ Umfang (m)']],
    body: matBody.length ? matBody : [['—', '—', '—', '—']],
    styles: { fontSize: 8, cellPadding: 1.2 },
    headStyles: { fillColor: [230, 230, 233], fontStyle: 'bold', fontSize: 8 },
    margin: { left: margin, right: margin },
    tableWidth: Math.min(contentW, 160),
    theme: 'grid',
  })

  y = (docExt.lastAutoTable?.finalY ?? y) + 6

  const materialShares = computeMaterialAreaShares(aggregate.byMaterial, aggregate.grand.totalAreaM2)
  const pieSvg = buildMaterialPieSvgDocument(materialShares)
  if (pieSvg) {
    const piePng = await svgDocumentToPngDataUrl(pieSvg, 900)
    if (piePng) {
      if (y > pageH - margin - 30) {
        doc.addPage()
        y = margin
      }
      const pieProps = doc.getImageProperties(piePng)
      const iw = pieProps.width
      const ih = pieProps.height
      const maxPieW = contentW
      const maxPieH = Math.min(72, pageH - y - margin - 8)
      let dwMm = maxPieW
      let dhMm = (dwMm * ih) / iw
      if (dhMm > maxPieH) {
        dhMm = maxPieH
        dwMm = (dhMm * iw) / ih
      }
      doc.addImage(piePng, 'PNG', margin, y, dwMm, dhMm, undefined, 'MEDIUM')
      y += dhMm + 8
    }
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(
    `Gesamt: Fläche ${fmtTotalArea(aggregate.grand.totalAreaM2)} m² · Umfang ${fmtTotalPerimeter(aggregate.grand.totalPerimeterM)} m`,
    margin,
    y,
  )
  y += 12

  const naehplanRows = buildNaehplanRows(workspace)
  if (naehplanRows.length > 0) {
    if (y > pageH - margin - 40) {
      doc.addPage()
      y = margin
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Nähplan', margin, y)
    y += 6
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    for (const row of naehplanRows) {
      const lines = doc.splitTextToSize(row.line, contentW)
      if (y + lines.length * 4.5 > pageH - margin) {
        doc.addPage()
        y = margin
      }
      doc.text(lines, margin, y)
      y += lines.length * 4.5 + 1
    }
  }

  const profileRows = aggregateProfileBom(workspace.profileAssignments ?? [], pieces)
  if (profileRows.length > 0) {
    if (y > pageH - margin - 40) {
      doc.addPage()
      y = margin
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text('Komponenten / Profile', margin, y)
    y += 6

    autoTable(doc, {
      startY: y,
      head: [['Kennung', 'Bezeichnung', 'Artikelnr.', 'Lieferant', 'Σ Länge (mm)', 'Anzahl']],
      body: profileRows.map((r) => [
        r.profileKey,
        r.profileName,
        r.internalArticleNumber ?? '—',
        r.supplierNumber ?? '—',
        r.totalLengthMm.toFixed(1),
        r.count,
      ]),
      styles: { fontSize: 8, cellPadding: 1.2 },
      headStyles: { fillColor: [230, 230, 233], fontStyle: 'bold', fontSize: 8 },
      margin: { left: margin, right: margin },
      tableWidth: Math.min(contentW, 200),
      theme: 'grid',
    })
    y = (docExt.lastAutoTable?.finalY ?? y) + 10
  }

  const svg = buildWorkspaceOverviewSvgDocument(pieces, imageSession, imageDataUrl, workspace.profileAssignments)
  if (svg) {
    const maxPreviewPx = 2400
    const png = await svgDocumentToPngDataUrl(svg, maxPreviewPx)
    if (png) {
      doc.addPage()
      drawWorkspacePreviewTechnicalPage(doc, {
        pageW,
        pageH,
        png,
        workspaceName: workspace.name,
        docDateLabel,
        projectFileName: workspace.projectFileName,
        bomDocumentVersion: workspace.bomDocumentVersion,
        bomDeveloperName: devName,
        bomEngineerName: engName,
      })
    }
  }

  const totalPages = doc.getNumberOfPages()
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(130, 130, 130)
    const pw = doc.internal.pageSize.getWidth()
    const ph = doc.internal.pageSize.getHeight()
    doc.text(`Seite ${i} / ${totalPages}`, pw - margin - 1, ph - 4, { align: 'right' })
    doc.text(`TrimTex · ${workspace.name}`, margin, ph - 4)
  }

  const datePart = new Date().toISOString().slice(0, 10)
  const fname = `Stueckliste_${safeFilenamePart(workspace.name)}_${datePart}.pdf`
  doc.save(fname)
}
