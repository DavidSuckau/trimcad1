import type { PatternPiece, ProfileAssignment } from '../types/model'
import { closedPathD, bezierDerivativeAt, signedAreaCurves } from '../geometry/curveToPath'
import {
  cutLineWithNotchCutouts,
  getNotchPositionAndAngleOnCutLine,
  seamLineWithNotchCutouts,
} from '../geometry/notchOnCurve'
import { getGrainArrowLayout } from '../geometry/grainArrowLayout'
import { getCurvesForSeamEdge } from '../geometry/seamUtils'
import { enumerateEdges } from '../geometry/edgeEnumeration'
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
  profileAssignments?: ProfileAssignment[],
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
    const pieceProfiles = (profileAssignments ?? []).filter((pa) => pa.pieceId === p.id)
    for (const pa of pieceProfiles) {
      const masterK = getCurvesForSeamEdge(p)
      const edges = enumerateEdges(p)
      const edge = edges.find((e) => e.edgeIndex === pa.edgeIndex)
      if (!edge) continue
      const curves = edge.curveIndices.map((ci) => masterK[ci]).filter(Boolean)
      if (curves.length === 0) continue

      const OFFSET = 20
      const area = signedAreaCurves(masterK)
      const outSign = area >= 0 ? -1 : 1

      let pathD = ''
      for (const seg of curves) {
        if (seg.type === 'line') {
          const tdx = seg.end.x - seg.start.x
          const tdy = seg.end.y - seg.start.y
          const tlen = Math.hypot(tdx, tdy) || 1
          const ox = outSign * (-tdy / tlen) * OFFSET
          const oy = outSign * (tdx / tlen) * OFFSET
          const sx = seg.start.x + ox, sy = seg.start.y + oy
          const ex = seg.end.x + ox, ey = seg.end.y + oy
          pathD += `M ${sx} ${sy} L ${ex} ${ey} `
        } else {
          const dd0 = bezierDerivativeAt(seg, 0)
          const dd1 = bezierDerivativeAt(seg, 1)
          const len0 = Math.hypot(dd0.x, dd0.y) || 1
          const len1 = Math.hypot(dd1.x, dd1.y) || 1
          const o0x = outSign * (-dd0.y / len0) * OFFSET
          const o0y = outSign * (dd0.x / len0) * OFFSET
          const o1x = outSign * (-dd1.y / len1) * OFFSET
          const o1y = outSign * (dd1.x / len1) * OFFSET
          pathD += `M ${seg.start.x + o0x} ${seg.start.y + o0y} C ${seg.cp1.x + o0x} ${seg.cp1.y + o0y} ${seg.cp2.x + o1x} ${seg.cp2.y + o1y} ${seg.end.x + o1x} ${seg.end.y + o1y} `
        }
      }
      if (pathD) {
        parts.push(
          `<path d="${escapeXmlAttr(pathD)}" fill="none" stroke="#7b1fa2" stroke-width="1.5" stroke-opacity="0.7" stroke-dasharray="6 3"/>`,
        )
        const firstSeg = curves[0]
        const lastSeg = curves[curves.length - 1]
        const midX = (firstSeg.start.x + lastSeg.end.x) / 2
        const midY = (firstSeg.start.y + lastSeg.end.y) / 2
        const edgeDx = lastSeg.end.x - firstSeg.start.x
        const edgeDy = lastSeg.end.y - firstSeg.start.y
        const edgeLen = Math.hypot(edgeDx, edgeDy) || 1
        const nx = outSign * (-edgeDy / edgeLen) * (OFFSET + 12)
        const ny = outSign * (edgeDx / edgeLen) * (OFFSET + 12)
        const lx = midX + nx
        const ly = midY + ny
        const ang = (Math.atan2(edgeDy, edgeDx) * 180) / Math.PI
        parts.push(
          `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="central" fill="#7b1fa2" font-size="5" font-family="sans-serif" font-weight="700" transform="rotate(${ang},${lx},${ly})">${escapeXmlAttr(pa.profileKey)}</text>`,
        )
      }
    }

    parts.push('</g>')
  }
  parts.push('</svg>')
  return parts.join('')
}
