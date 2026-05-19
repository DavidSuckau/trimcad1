import type { PatternPiece } from '../types/model'
import type { NestingPlan, NestingPlacement } from './nestingTypes'
import { EOL, fmt, downloadBlob, makeExportFilename } from '../dxf/dxfShared'
import { buildNestingPartGeometry, transformPlacementGrain, transformPlacementPolygon } from './nestingGeometry'
import type { NestingPartGeometry } from './nestingTypes'

function dxfPolylineRaw(layer: string, points: { x: number; y: number }[], closed: boolean): string {
  if (points.length < 2) return ''
  const lines: string[] = []
  lines.push('0' + EOL + 'POLYLINE' + EOL + '8' + EOL + layer + EOL + '66' + EOL + '1' + EOL + '70' + EOL + (closed ? '1' : '0') + EOL)
  for (const p of points) {
    lines.push('0' + EOL + 'VERTEX' + EOL + '8' + EOL + layer + EOL + '10' + EOL + fmt(p.x) + EOL + '20' + EOL + fmt(p.y) + EOL)
  }
  lines.push('0' + EOL + 'SEQEND' + EOL)
  return lines.join('')
}

function dxfLineRaw(layer: string, x1: number, y1: number, x2: number, y2: number): string {
  return (
    '0' + EOL + 'LINE' + EOL + '8' + EOL + layer + EOL +
    '10' + EOL + fmt(x1) + EOL + '20' + EOL + fmt(y1) + EOL +
    '11' + EOL + fmt(x2) + EOL + '21' + EOL + fmt(y2) + EOL
  )
}

function dxfTextRaw(layer: string, x: number, y: number, text: string, height = 8): string {
  const safe = text.replace(/\r?\n/g, ' ')
  return (
    '0' + EOL + 'TEXT' + EOL + '8' + EOL + layer + EOL +
    '10' + EOL + fmt(x) + EOL + '20' + EOL + fmt(y) + EOL +
    '40' + EOL + fmt(height) + EOL + '1' + EOL + safe + EOL
  )
}

export function exportNestingPlanToDxf(
  plan: NestingPlan,
  pieces: PatternPiece[],
  geometries: Map<string, NestingPartGeometry>,
  scale = 1,
): string {
  const out: string[] = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  const pieceById = new Map(pieces.map((p) => [p.id, p]))

  out.push('0' + EOL + 'SECTION' + EOL + '2' + EOL + 'HEADER' + EOL)
  out.push('9' + EOL + '$ACADVER' + EOL + '1' + EOL + 'AC1009' + EOL)
  out.push('9' + EOL + '$INSUNITS' + EOL + '70' + EOL + '5' + EOL)
  out.push('0' + EOL + 'ENDSEC' + EOL)
  out.push('0' + EOL + 'SECTION' + EOL + '2' + EOL + 'ENTITIES' + EOL)

  const rollW = plan.rollWidthMm * scale
  const rollH = plan.usedLengthMm * scale
  out.push(
    dxfPolylineRaw(
      'ROLL',
      [
        { x: 0, y: 0 },
        { x: rollW, y: 0 },
        { x: rollW, y: rollH },
        { x: 0, y: rollH },
      ],
      true,
    ),
  )
  minX = 0
  minY = 0
  maxX = rollW
  maxY = rollH

  for (const pl of plan.placements) {
    const geom = geometries.get(pl.pieceId)
    const piece = pieceById.get(pl.pieceId)
    if (!geom || !piece) continue
    const pts = transformPlacementPolygon(geom, pl).map((p) => ({ x: p.x * scale, y: p.y * scale }))
    out.push(dxfPolylineRaw('CUT', pts, true))
    for (const p of pts) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
    const grain = transformPlacementGrain(geom, pl)
    out.push(
      dxfLineRaw(
        'GRAIN',
        grain.start.x * scale,
        grain.start.y * scale,
        grain.end.x * scale,
        grain.end.y * scale,
      ),
    )
    const label = `${piece.name} #${pl.instanceIndex + 1}`
    const gx = grain.start.x * scale
    const gy = grain.start.y * scale
    out.push(dxfTextRaw('TEXT', gx + 5, gy - 5, label))
  }

  void minX
  void maxX
  void minY
  void maxY

  out.push('0' + EOL + 'ENDSEC' + EOL + '0' + EOL + 'EOF' + EOL)
  return out.join('')
}

export function buildGeometriesForPlan(
  pieces: PatternPiece[],
  plan: NestingPlan,
): Map<string, NestingPartGeometry> {
  const map = new Map<string, NestingPartGeometry>()
  const ids = new Set(plan.placements.map((p) => p.pieceId))
  for (const id of ids) {
    const piece = pieces.find((p) => p.id === id)
    if (!piece) continue
    const g = buildNestingPartGeometry(piece, plan.spacingMm, true)
    if (g) map.set(id, g)
  }
  return map
}

export function downloadNestingPlanDxf(
  plan: NestingPlan,
  pieces: PatternPiece[],
  scale = 1,
  filename?: string,
): void {
  const geometries = buildGeometriesForPlan(pieces, plan)
  const content = exportNestingPlanToDxf(plan, pieces, geometries, scale)
  if (!filename) filename = makeExportFilename('zuschnitt-dxf')
  downloadBlob(content, filename)
}

export function placementLabel(p: NestingPlacement, pieceName: string): string {
  return `${pieceName} #${p.instanceIndex + 1}`
}
