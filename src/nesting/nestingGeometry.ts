import type { PatternPiece, Point } from '../types/model'
import { getExportContour } from '../dxf/dxfShared'
import { curveToPolylinePoints } from '../dxf/dxfShared'
import { pieceLocalToWorld } from '../geometry/pieceTransform'
import { getPieceGrainLine } from '../geometry/grainArrowLayout'
import type { NestingPartGeometry } from './nestingTypes'
import { getCutLineAreaMm2 } from '../bom/pieceBomStats'
// @ts-expect-error clipper-lib has no types
import ClipperLib from 'clipper-lib'

const CLIPPER_SCALE = 1000

export type NestPoint = { x: number; y: number }

function toClipperPath(pts: NestPoint[]): ClipperLib.IntPoint[] {
  return pts.map((p) => new ClipperLib.IntPoint(Math.round(p.x * CLIPPER_SCALE), Math.round(p.y * CLIPPER_SCALE)))
}

function fromClipperPath(path: ClipperLib.IntPoint[]): NestPoint[] {
  return path.map((p) => ({ x: p.X / CLIPPER_SCALE, y: p.Y / CLIPPER_SCALE }))
}

export function polygonSignedArea(pts: NestPoint[]): number {
  if (pts.length < 3) return 0
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return a / 2
}

export function polygonBounds(pts: NestPoint[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { minX, minY, maxX, maxY }
}

export function polygonCentroid(pts: NestPoint[]): NestPoint {
  const a = polygonSignedArea(pts)
  if (Math.abs(a) < 1e-9) {
    const b = polygonBounds(pts)
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
  }
  let cx = 0
  let cy = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    const cross = pts[i].x * pts[j].y - pts[j].x * pts[i].y
    cx += (pts[i].x + pts[j].x) * cross
    cy += (pts[i].y + pts[j].y) * cross
  }
  const f = 1 / (6 * a)
  return { x: cx * f, y: cy * f }
}

export function rotatePoint(p: NestPoint, rad: number, origin: NestPoint): NestPoint {
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = p.x - origin.x
  const dy = p.y - origin.y
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  }
}

export function rotatePolygon(pts: NestPoint[], deg: number, origin?: NestPoint): NestPoint[] {
  const c = origin ?? polygonCentroid(pts)
  const rad = (deg * Math.PI) / 180
  return pts.map((p) => rotatePoint(p, rad, c))
}

export function translatePolygon(pts: NestPoint[], dx: number, dy: number): NestPoint[] {
  return pts.map((p) => ({ x: p.x + dx, y: p.y + dy }))
}

/** Weltwinkel der Laufrichtung (Grad, 0 = +X, 90 = +Y). */
export function getWorldGrainAngleDeg(piece: PatternPiece): number {
  const grain = getPieceGrainLine(piece)
  const start = pieceLocalToWorld(grain.start, piece.transform)
  const end = pieceLocalToWorld(grain.end, piece.transform)
  return (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI
}

/** Kontur in Weltkoordinaten (wie Arbeitsfläche), dann Kette → +Y. */
export function buildWorldContourPolygon(piece: PatternPiece): NestPoint[] {
  const contour = getExportContour(piece)
  const localPts = curveToPolylinePoints(contour)
  return localPts.map((p) => pieceLocalToWorld(p, piece.transform))
}

export function alignPolygonGrainToPositiveY(pts: NestPoint[], worldGrainAngleDeg: number): NestPoint[] {
  const target = 90
  let delta = target - worldGrainAngleDeg
  while (delta > 180) delta -= 360
  while (delta < -180) delta += 360
  const c = polygonCentroid(pts)
  return rotatePolygon(pts, delta, c)
}

export function offsetPolygonOutward(pts: NestPoint[], deltaMm: number): NestPoint[] {
  if (pts.length < 3 || deltaMm <= 0) return pts
  const path = toClipperPath(pts)
  const co = new ClipperLib.ClipperOffset()
  co.AddPath(path, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon)
  const solution: ClipperLib.Paths = []
  co.Execute(solution, deltaMm * CLIPPER_SCALE)
  if (!solution.length || solution[0].length < 3) return pts
  return fromClipperPath(solution[0])
}

export function normalizePolygonToCentroidOrigin(pts: NestPoint[]): NestPoint[] {
  const c = polygonCentroid(pts)
  return translatePolygon(pts, -c.x, -c.y)
}

/** Verschiebt Polygon so minX/minY = 0 (Platzierungsanker unten links). */
export function normalizePolygonToMinOrigin(pts: NestPoint[]): NestPoint[] {
  const b = polygonBounds(pts)
  return translatePolygon(pts, -b.minX, -b.minY)
}

export function grainLineInNestCoords(
  piece: PatternPiece,
  worldGrainAngleDeg: number,
): { start: Point; end: Point } {
  const grain = getPieceGrainLine(piece)
  const start = pieceLocalToWorld(grain.start, piece.transform)
  const end = pieceLocalToWorld(grain.end, piece.transform)
  const c = polygonCentroid(buildWorldContourPolygon(piece))
  const target = 90
  let delta = target - worldGrainAngleDeg
  while (delta > 180) delta -= 360
  while (delta < -180) delta += 360
  return {
    start: rotatePoint(start, (delta * Math.PI) / 180, c),
    end: rotatePoint(end, (delta * Math.PI) / 180, c),
  }
}

export function buildNestingPartGeometry(
  piece: PatternPiece,
  spacingMm: number,
  allowRotate180: boolean,
): NestingPartGeometry | null {
  if (piece.cutLine.length < 3) return null
  const worldGrain = getWorldGrainAngleDeg(piece)
  let poly = buildWorldContourPolygon(piece)
  if (poly.length < 3) return null
  poly = alignPolygonGrainToPositiveY(poly, worldGrain)
  const halfSpacing = spacingMm / 2
  if (halfSpacing > 0) poly = offsetPolygonOutward(poly, halfSpacing)
  poly = normalizePolygonToMinOrigin(poly)

  const grainAligned = grainLineInNestCoords(piece, worldGrain)
  const b0 = polygonBounds(poly)
  const grain0 = {
    start: { x: grainAligned.start.x - b0.minX, y: grainAligned.start.y - b0.minY },
    end: { x: grainAligned.end.x - b0.minX, y: grainAligned.end.y - b0.minY },
  }

  const w = b0.maxX - b0.minX
  const h = b0.maxY - b0.minY
  const pivot = { x: w / 2, y: h / 2 }
  let poly180: NestPoint[] | null = null
  let grain180: { start: Point; end: Point } | null = null
  if (allowRotate180) {
    poly180 = normalizePolygonToMinOrigin(rotatePolygon(poly, 180, pivot))
    const b1 = polygonBounds(poly180)
    const gs = rotatePoint(grain0.start, Math.PI, pivot)
    const ge = rotatePoint(grain0.end, Math.PI, pivot)
    grain180 = {
      start: { x: gs.x - b1.minX, y: gs.y - b1.minY },
      end: { x: ge.x - b1.minX, y: ge.y - b1.minY },
    }
  }

  return {
    pieceId: piece.id,
    name: piece.name,
    areaMm2: getCutLineAreaMm2(piece),
    polygon0: poly,
    polygon180: poly180,
    grain0,
    grain180,
  }
}

export function transformPlacementPolygon(
  geom: NestingPartGeometry,
  placement: { x: number; y: number; rotationDeg: 0 | 180 },
): NestPoint[] {
  const base = placement.rotationDeg === 180 && geom.polygon180 ? geom.polygon180 : geom.polygon0
  return translatePolygon(base, placement.x, placement.y)
}

export function transformPlacementGrain(
  geom: NestingPartGeometry,
  placement: { x: number; y: number; rotationDeg: 0 | 180 },
): { start: Point; end: Point } {
  const g = placement.rotationDeg === 180 && geom.grain180 ? geom.grain180 : geom.grain0
  return {
    start: { x: g.start.x + placement.x, y: g.start.y + placement.y },
    end: { x: g.end.x + placement.x, y: g.end.y + placement.y },
  }
}
