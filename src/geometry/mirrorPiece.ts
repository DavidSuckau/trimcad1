import type { Curve, Drill, Notch, PatternPiece, Point, RoundedCorner } from '../types/model'
import { curvesBounds } from './curveToPath'
import { deriveCutLineForPiece } from './deriveCutLineForPiece'
import { rematerializeNotchesAfterGeometricMirror } from './notchResyncCutLine'
import { offsetCurvesInwardForSeam } from './offset'
import { preferStableCutAfterGeometricMirror } from './seamAllowanceInvariants'
import { useSeamLineForVertexEditing } from './vertexMaster'
import { facingOffsetBesideParent, isFacingDerivedPiece, syncFacingPiecesFromParents } from './facingPiece'

function mirrorX(p: Point, cx: number): Point {
  return { x: 2 * cx - p.x, y: p.y }
}

function mirrorCurve(c: Curve, cx: number): Curve {
  if (c.type === 'line') {
    return { type: 'line', start: mirrorX(c.start, cx), end: mirrorX(c.end, cx) }
  }
  return {
    type: 'bezier',
    start: mirrorX(c.start, cx),
    end: mirrorX(c.end, cx),
    cp1: mirrorX(c.cp1, cx),
    cp2: mirrorX(c.cp2, cx),
  }
}

function remapSoftVertexIndicesByPointMap(
  oldCurves: Curve[],
  newCurves: Curve[],
  soft: number[] | undefined,
  mapPoint: (p: Point) => Point,
  maxDistMm = 3
): number[] {
  if (!soft?.length || oldCurves.length < 3 || newCurves.length < 3) return []
  const out: number[] = []
  for (const vi of soft) {
    if (vi < 0 || vi >= oldCurves.length) continue
    const oldP = oldCurves[vi]!.start
    const target = mapPoint(oldP)
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < newCurves.length; i++) {
      const q = newCurves[i]!.start
      const d = Math.hypot(q.x - target.x, q.y - target.y)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    if (best >= 0 && bestD <= maxDistMm) out.push(best)
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

function remapRoundedCornersByPointMap(
  oldMaster: Curve[],
  newMaster: Curve[],
  rounded: RoundedCorner[] | undefined,
  mapPoint: (p: Point) => Point,
  maxDistMm = 3
): RoundedCorner[] | undefined {
  if (!rounded?.length || oldMaster.length < 3 || newMaster.length < 3) return undefined
  const out: RoundedCorner[] = []
  for (const r of rounded) {
    if (r.masterVertexIndex < 0 || r.masterVertexIndex >= oldMaster.length) continue
    const oldP = oldMaster[r.masterVertexIndex]!.start
    const target = mapPoint(oldP)
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < newMaster.length; i++) {
      const q = newMaster[i]!.start
      const d = Math.hypot(q.x - target.x, q.y - target.y)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    if (best >= 0 && bestD <= maxDistMm) {
      out.push({ ...r, masterVertexIndex: best })
    }
  }
  return out.length > 0 ? out : undefined
}

/**
 * Geometrie einer abhängigen Spiegelkopie aus der Mutter
 * (vertikal gespiegelt um die Schnitt-BBox-Mitte, wie flipPieceAlongGrain).
 */
export function buildMirrorGeometryFromParent(parent: PatternPiece): {
  cutLine: Curve[]
  seamLine: Curve[]
  seamAllowanceMm: PatternPiece['seamAllowanceMm']
  edgeSeamAllowances: PatternPiece['edgeSeamAllowances']
  cutLineDeviatesFromSeamAllowanceOffset: PatternPiece['cutLineDeviatesFromSeamAllowanceOffset']
  notches: Notch[]
  drills: Drill[]
  grainLine: PatternPiece['grainLine']
  internalLines: Curve[]
  internalLineSoftJunctions: PatternPiece['internalLineSoftJunctions']
  internalCircles: PatternPiece['internalCircles']
  softVertices: number[]
  softVerticesMaster: number[]
  roundedCorners: PatternPiece['roundedCorners']
  fillInterior: PatternPiece['fillInterior']
  material: string
  description: string
  bomQuantity: number
  layer: string
  kind: 'mirror'
} {
  const bounds = curvesBounds(parent.cutLine.length >= 3 ? parent.cutLine : parent.seamLine)
  const cx = bounds ? (bounds.minX + bounds.maxX) / 2 : 0
  const oldCutLine = parent.cutLine
  const oldInternalLines = parent.internalLines
  const mirroredCutLine = oldCutLine.map((c) => mirrorCurve(c, cx))
  let cutLine: Curve[]
  let seamLine: Curve[]
  if (useSeamLineForVertexEditing(parent) && parent.seamLine.length >= 3) {
    seamLine = parent.seamLine.map((c) => mirrorCurve(c, cx))
    if (parent.cutLineDeviatesFromSeamAllowanceOffset === true) {
      const derived = deriveCutLineForPiece({ ...parent, seamLine }, seamLine, parent.seamAllowanceMm!)
      cutLine = preferStableCutAfterGeometricMirror(
        seamLine,
        mirroredCutLine,
        derived.ok ? derived.cutLine : null,
        parent.seamAllowanceMm!
      )
    } else {
      const derived = deriveCutLineForPiece({ ...parent, seamLine }, seamLine, parent.seamAllowanceMm!)
      cutLine = derived.ok ? derived.cutLine : mirroredCutLine
    }
  } else {
    cutLine = mirroredCutLine
    seamLine =
      parent.seamAllowanceMm != null && cutLine.length >= 3
        ? offsetCurvesInwardForSeam(cutLine, parent.seamAllowanceMm)
        : []
  }
  const internalLines = oldInternalLines.map((c) => mirrorCurve(c, cx))
  const notches = rematerializeNotchesAfterGeometricMirror({
    notches: parent.notches,
    oldCutLine,
    mirroredCutLine,
    finalCutLine: cutLine,
    oldInternalLines,
    mirroredInternalLines: internalLines,
    mapPoint: (p) => mirrorX(p, cx),
  })
  const drills = parent.drills.map((d) => ({ ...d, center: mirrorX(d.center, cx) }))
  const internalCircles = parent.internalCircles.map((ic) => ({
    ...ic,
    center: mirrorX(ic.center, cx),
  }))
  const grainLine = parent.grainLine
    ? { start: mirrorX(parent.grainLine.start, cx), end: mirrorX(parent.grainLine.end, cx) }
    : null
  const softVerticesMaster = remapSoftVertexIndicesByPointMap(
    parent.seamLine.length >= 3 ? parent.seamLine : parent.cutLine,
    seamLine.length >= 3 ? seamLine : cutLine,
    parent.softVerticesMaster,
    (p) => mirrorX(p, cx)
  )
  const softVertices = remapSoftVertexIndicesByPointMap(
    parent.cutLine,
    cutLine,
    parent.softVertices,
    (p) => mirrorX(p, cx)
  )
  const oldMaster = parent.seamLine.length >= 3 ? parent.seamLine : parent.cutLine
  const newMaster = seamLine.length >= 3 ? seamLine : cutLine
  const roundedCorners = remapRoundedCornersByPointMap(
    oldMaster,
    newMaster,
    parent.roundedCorners,
    (p) => mirrorX(p, cx)
  )

  return {
    cutLine,
    seamLine,
    seamAllowanceMm: parent.seamAllowanceMm ?? null,
    edgeSeamAllowances: parent.edgeSeamAllowances
      ? parent.edgeSeamAllowances.map((e) => ({ ...e }))
      : undefined,
    cutLineDeviatesFromSeamAllowanceOffset: parent.cutLineDeviatesFromSeamAllowanceOffset,
    notches,
    drills,
    grainLine,
    internalLines,
    internalLineSoftJunctions: parent.internalLineSoftJunctions
      ? [...parent.internalLineSoftJunctions]
      : undefined,
    internalCircles,
    softVertices,
    softVerticesMaster,
    roundedCorners,
    fillInterior: parent.fillInterior,
    material: parent.material ?? '',
    description: parent.description ?? '',
    bomQuantity: parent.bomQuantity ?? 1,
    layer: parent.layer,
    kind: 'mirror',
  }
}

/** Abstand neben die Mutter (mm) – gleiche Logik wie Kaschierung. */
export function mirrorOffsetBesideParent(parent: PatternPiece): Point {
  return facingOffsetBesideParent(parent)
}

/**
 * Synchronisiert alle Spiegelkopien aus ihren Mutterteilen.
 * Behält Transform, id, number, name, material, grainLine und mirrorParentId der Kinder.
 */
export function syncMirrorPiecesFromParents(pieces: PatternPiece[]): PatternPiece[] {
  const byId = new Map(pieces.map((p) => [p.id, p]))
  let changed = false
  const next = pieces.map((p) => {
    const parentId = p.mirrorParentId
    if (!parentId) return p
    const parent = byId.get(parentId)
    if (!parent || isLinkedDerivedPiece(parent)) return p
    const geom = buildMirrorGeometryFromParent(parent)
    const synced: PatternPiece = {
      ...p,
      ...geom,
      id: p.id,
      number: p.number,
      name: p.name,
      material: p.material ?? '',
      grainLine: p.grainLine
        ? { start: { ...p.grainLine.start }, end: { ...p.grainLine.end } }
        : geom.grainLine,
      transform: { ...p.transform },
      mirrorParentId: parentId,
      kind: 'mirror',
      symmetryConstraint: undefined,
      facingParentId: undefined,
    }
    changed = true
    return synced
  })
  return changed ? next : pieces
}

/** Kaschierungen + Spiegelkopien nach Mutter-Änderung aktualisieren. */
export function syncLinkedPiecesFromParents(pieces: PatternPiece[]): PatternPiece[] {
  return syncMirrorPiecesFromParents(syncFacingPiecesFromParents(pieces))
}

export function mirrorChildIds(pieces: PatternPiece[], parentId: string): string[] {
  return pieces.filter((p) => p.mirrorParentId === parentId).map((p) => p.id)
}

/** Alle abhängigen Töchter (Kaschierung + Spiegelkopie) einer Mutter. */
export function linkedChildIds(pieces: PatternPiece[], parentId: string): string[] {
  return [
    ...pieces.filter((p) => p.facingParentId === parentId).map((p) => p.id),
    ...pieces.filter((p) => p.mirrorParentId === parentId).map((p) => p.id),
  ]
}

export function isMirrorDerivedPiece(piece: PatternPiece | null | undefined): boolean {
  return !!piece && (piece.kind === 'mirror' || !!piece.mirrorParentId)
}

/** Kaschierung oder Spiegelkopie – Geometrie nur über Sync von der Mutter. */
export function isLinkedDerivedPiece(piece: PatternPiece | null | undefined): boolean {
  return isFacingDerivedPiece(piece) || isMirrorDerivedPiece(piece)
}
