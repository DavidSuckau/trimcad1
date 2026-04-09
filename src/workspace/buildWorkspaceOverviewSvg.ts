import type { PatternPiece } from '../types/model'
import { closedPathD } from '../geometry/curveToPath'
import {
  cutLineWithNotchCutouts,
  getNotchPositionAndAngleOnCutLine,
  seamLineWithNotchCutouts,
} from '../geometry/notchOnCurve'
import { getGrainArrowLayout } from '../geometry/grainArrowLayout'
import {
  boundsForWorkspaceImage,
  computeWorkspaceOverviewViewBox,
  type OverviewImageSession,
} from './workspaceOverviewBounds'

function pieceGroupTransform(p: PatternPiece): string {
  const { x, y, rotation, mirrored } = p.transform
  return `translate(${x},${y}) rotate(${rotation}) scale(${mirrored ? -1 : 1},1)`
}

/** XML-Attributwert für doppelte Anführungszeichen. */
function escapeXmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/**
 * Vollständiges SVG-Dokument (z. B. für PDF-Rasterung), inkl. Nahtzugabe (Naht+Schnitt) und Laufrichtung.
 */
export function buildWorkspaceOverviewSvgDocument(
  pieces: PatternPiece[],
  imageSession: OverviewImageSession | null,
  imageDataUrl: string | null,
): string | null {
  const viewBox = computeWorkspaceOverviewViewBox(pieces, imageSession)
  if (!viewBox) return null
  const imgBounds = imageDataUrl && imageSession ? boundsForWorkspaceImage(imageSession) : null
  const iw = imgBounds ? imgBounds.maxX - imgBounds.minX : 0
  const ih = imgBounds ? imgBounds.maxY - imgBounds.minY : 0

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">`,
  )
  if (imgBounds && imageDataUrl && iw > 0 && ih > 0) {
    parts.push(
      `<image href="${escapeXmlAttr(imageDataUrl)}" x="${imgBounds.minX}" y="${imgBounds.minY}" width="${iw}" height="${ih}" opacity="0.42" preserveAspectRatio="xMidYMid meet"/>`,
    )
  }
  for (const p of pieces) {
    const tx = pieceGroupTransform(p)
    const useFill = p.fillInterior !== false
    const fill = useFill ? '#fef9c3' : 'none'
    const fillOp = useFill ? '0.82' : '0'

    const mergedCut = cutLineWithNotchCutouts(p.cutLine, p.notches, p.seamLine)
    const mergedSeam = seamLineWithNotchCutouts(p.cutLine, p.notches, p.seamLine)
    const cutPath = closedPathD(mergedCut)
    const seamPath = closedPathD(mergedSeam)
    const hasSeam = !!(seamPath && p.seamLine.length >= 3)

    parts.push(`<g transform="${escapeXmlAttr(tx)}">`)
    if (hasSeam && cutPath && seamPath) {
      parts.push(
        `<path d="${escapeXmlAttr(cutPath)}" fill="${fill}" fill-opacity="${fillOp}" stroke="#888888" stroke-width="0.5"/>`,
      )
      parts.push(
        `<path d="${escapeXmlAttr(seamPath)}" fill="${fill}" fill-opacity="${fillOp}" stroke="#1a1a1a" stroke-width="0.5"/>`,
      )
    } else if (cutPath) {
      parts.push(
        `<path d="${escapeXmlAttr(cutPath)}" fill="${fill}" fill-opacity="${fillOp}" stroke="#1a1a1a" stroke-width="0.45"/>`,
      )
    } else {
      parts.push(`<circle cx="0" cy="0" r="3" fill="none" stroke="#bbbbbb" stroke-width="0.5"/>`)
    }

    for (const n of p.notches) {
      if (n.type !== 'single') continue
      const { position, angle } = getNotchPositionAndAngleOnCutLine(n, p.cutLine, p.seamLine)
      const rad = (angle * Math.PI) / 180
      const d = Math.max(1e-6, n.depth)
      const x2 = position.x + d * Math.cos(rad)
      const y2 = position.y + d * Math.sin(rad)
      parts.push(
        `<line x1="${position.x}" y1="${position.y}" x2="${x2}" y2="${y2}" stroke="#1a1a1a" stroke-width="0.5" stroke-linecap="round" fill="none"/>`,
      )
    }

    const grain = getGrainArrowLayout(p)
    if (grain && p.cutLine.length >= 3) {
      const { line, tickStart, tickEnd, triangleD } = grain
      parts.push(
        `<line x1="${line.start.x}" y1="${line.start.y}" x2="${line.end.x}" y2="${line.end.y}" stroke="#333333" stroke-width="0.35" stroke-dasharray="5 3" fill="none"/>`,
      )
      parts.push(
        `<line x1="${tickStart.x}" y1="${tickStart.y}" x2="${tickEnd.x}" y2="${tickEnd.y}" stroke="#333333" stroke-width="0.35" fill="none"/>`,
      )
      parts.push(`<path d="${escapeXmlAttr(triangleD)}" fill="none" stroke="#333333" stroke-width="0.35"/>`)
    }
    parts.push('</g>')
  }
  parts.push('</svg>')
  return parts.join('')
}
