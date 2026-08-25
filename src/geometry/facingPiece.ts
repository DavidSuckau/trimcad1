import type { Curve, Drill, Notch, PatternPiece, Point } from '../types/model'
import { bezierAt, curvesBounds, pointAtPathLength, totalPathLength } from './curveToPath'
import { deriveCutLineForPiece } from './deriveCutLineForPiece'
import { chamferCutLineCornersInSeamAllowance } from './facingChamfer'
import { nearestCurveIndexAndPoint } from './nearestOnCurve'
import { resyncNotchesAfterCutLineRebuilt } from './notchResyncCutLine'

function cloneCurves(curves: Curve[]): Curve[] {
  return curves.map((c) =>
    c.type === 'line'
      ? { type: 'line' as const, start: { ...c.start }, end: { ...c.end } }
      : {
          type: 'bezier' as const,
          start: { ...c.start },
          end: { ...c.end },
          cp1: { ...c.cp1 },
          cp2: { ...c.cp2 },
        }
  )
}

function cloneNotches(notches: Notch[]): Notch[] {
  return notches.map((n) => ({
    ...n,
    position: { ...n.position },
  }))
}

function cloneDrills(drills: Drill[]): Drill[] {
  return drills.map((d) => ({ ...d, center: { ...d.center } }))
}

function cloneGrain(grain: PatternPiece['grainLine']): PatternPiece['grainLine'] {
  if (!grain) return null
  return { start: { ...grain.start }, end: { ...grain.end } }
}

function cloneCircles(circles: PatternPiece['internalCircles']): PatternPiece['internalCircles'] {
  return circles.map((c) => ({ ...c, center: { ...c.center } }))
}

/**
 * Abstand Naht→Schnitt an der **Kantenmitte** (eine Probe pro Naht-Segment).
 * Für Chamfer-Rollback: Ecken-Proben würden absichtlich kleiner werden.
 */
export function seamToCutMidEdgeDistances(seam: Curve[], cut: Curve[]): number[] {
  const out: number[] = []
  if (cut.length < 3) return out
  for (const c of seam) {
    const pt =
      c.type === 'line'
        ? { x: (c.start.x + c.end.x) / 2, y: (c.start.y + c.end.y) / 2 }
        : bezierAt(c, 0.5)
    const d = nearestCurveIndexAndPoint(pt, cut)?.distance
    if (d != null) out.push(d)
  }
  return out
}

/**
 * Abstände Naht→Schnitt entlang jeder Naht-Kurve (mehrere Proben, nicht nur Mitte).
 * So fällt „NZ verschwindet zum Teil“ auf einer Kante auf.
 */
export function seamToCutSampleDistances(seam: Curve[], cut: Curve[], samplesPerCurve = 3): number[] {
  const out: number[] = []
  if (cut.length < 3) return out
  for (const c of seam) {
    const len = totalPathLength([c])
    if (len < 1e-9) continue
    for (let s = 1; s <= samplesPerCurve; s++) {
      const t = s / (samplesPerCurve + 1)
      const pt =
        c.type === 'line'
          ? { x: c.start.x + (c.end.x - c.start.x) * t, y: c.start.y + (c.end.y - c.start.y) * t }
          : bezierAt(c, t)
      // Bei Einzelsegment-Bézier: pointAtPathLength auf [c] ist robuster für t entlang Bogen
      const along = pointAtPathLength([c], t * len)
      const p = along?.point ?? pt
      const d = nearestCurveIndexAndPoint(p, cut)?.distance
      if (d != null) out.push(d)
    }
  }
  return out
}

/** true, wenn Chamfer die parallele Kanten-NZ (Mitte je Kante) merklich auffrisst. */
export function chamferCollapsesSeamAllowance(
  seam: Curve[],
  cutBefore: Curve[],
  cutAfter: Curve[],
  expectedSaMm: number
): boolean {
  if (seam.length < 3 || cutBefore.length < 3 || cutAfter.length < 3) return false
  const before = seamToCutMidEdgeDistances(seam, cutBefore)
  const after = seamToCutMidEdgeDistances(seam, cutAfter)
  if (before.length === 0 || after.length !== before.length) return true

  const floor = Math.max(1, expectedSaMm * 0.75)
  for (let i = 0; i < after.length; i++) {
    const edge = seam[i]
    const isBezier = edge?.type === 'bezier'
    if (isBezier) {
      // Auf Wölbung kann NZ > SA sein; nur totaler Kollaps zählt
      if (after[i] < Math.max(1, expectedSaMm * 0.35)) return true
      if (before[i] > 2 && after[i] < before[i] * 0.65) return true
      continue
    }
    if (before[i] >= floor && after[i] < floor) return true
    if (before[i] > 1 && after[i] < before[i] * 0.85) return true
  }
  return false
}

/** Geometrie der Kaschierung aus der Mutter (ohne Transform/Id/Nummer). */
export function buildFacingGeometryFromParent(parent: PatternPiece): {
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
  fillInterior: false
  material: string
  description: string
  bomQuantity: number
  layer: string
  kind: 'facing'
} {
  const seamLine = cloneCurves(parent.seamLine)
  const parentCut = cloneCurves(parent.cutLine)
  // Nach Flip/Edit kann die Mutter-cutLine topologisch unzuverlässig sein.
  // Kaschierung immer aus der Naht (+ NZ) neu ableiten, dann erst chamfern.
  let cutForChamfer = parentCut
  const sa = parent.seamAllowanceMm
  if (sa != null && sa > 0 && seamLine.length >= 3) {
    const derived = deriveCutLineForPiece(
      {
        ...parent,
        cutLine: parentCut,
        seamLine,
        cutLineDeviatesFromSeamAllowanceOffset: false,
      },
      seamLine,
      sa
    )
    if (derived.ok) cutForChamfer = derived.cutLine
  }

  const draft: PatternPiece = {
    ...parent,
    cutLine: cutForChamfer,
    seamLine,
    notches: cloneNotches(parent.notches),
    drills: cloneDrills(parent.drills),
    grainLine: cloneGrain(parent.grainLine),
    internalLines: cloneCurves(parent.internalLines),
    internalCircles: cloneCircles(parent.internalCircles),
    // Cut neu abgeleitet → Mutter-softVertices (Cut-Indizes) ungültig.
    // softVerticesMaster steuert nur, welche Naht-Ecken keine Fase bekommen.
    softVertices: [],
    softVerticesMaster: [...(parent.softVerticesMaster ?? [])],
    roundedCorners: parent.roundedCorners ? parent.roundedCorners.map((r) => ({ ...r })) : undefined,
    edgeSeamAllowances: parent.edgeSeamAllowances
      ? parent.edgeSeamAllowances.map((e) => ({ ...e }))
      : undefined,
  }

  let cutLine = chamferCutLineCornersInSeamAllowance(draft)
  if (
    sa != null &&
    sa > 0 &&
    seamLine.length >= 3 &&
    chamferCollapsesSeamAllowance(seamLine, cutForChamfer, cutLine, sa)
  ) {
    cutLine = cutForChamfer
  }
  const notches = resyncNotchesAfterCutLineRebuilt(draft.notches, parentCut, cutLine)

  return {
    cutLine,
    seamLine,
    seamAllowanceMm: parent.seamAllowanceMm ?? null,
    edgeSeamAllowances: draft.edgeSeamAllowances,
    cutLineDeviatesFromSeamAllowanceOffset: true,
    notches,
    drills: draft.drills,
    grainLine: draft.grainLine,
    internalLines: draft.internalLines,
    internalLineSoftJunctions: parent.internalLineSoftJunctions
      ? [...parent.internalLineSoftJunctions]
      : undefined,
    internalCircles: draft.internalCircles,
    softVertices: [],
    softVerticesMaster: [...(parent.softVerticesMaster ?? [])],
    roundedCorners: draft.roundedCorners,
    fillInterior: false,
    material: parent.material ?? '',
    description: parent.description ?? '',
    bomQuantity: parent.bomQuantity ?? 1,
    layer: parent.layer,
    kind: 'facing',
  }
}

/** Abstand neben die Mutter (mm), basierend auf Bounding-Box-Breite. */
export function facingOffsetBesideParent(parent: PatternPiece): Point {
  const bounds = curvesBounds(parent.cutLine.length >= 3 ? parent.cutLine : parent.seamLine)
  const width = bounds ? bounds.maxX - bounds.minX : 80
  return { x: width + 30, y: 0 }
}

/**
 * Synchronisiert alle Kaschierungen in der Piece-Liste aus ihren Mutterteilen.
 * Behält Transform, id, number, name, material, grainLine und facingParentId der Kinder.
 */
export function syncFacingPiecesFromParents(pieces: PatternPiece[]): PatternPiece[] {
  const byId = new Map(pieces.map((p) => [p.id, p]))
  let changed = false
  const next = pieces.map((p) => {
    const parentId = p.facingParentId
    if (!parentId) return p
    const parent = byId.get(parentId)
    if (!parent || parent.facingParentId) return p
    const geom = buildFacingGeometryFromParent(parent)
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
      facingParentId: parentId,
      kind: 'facing',
      fillInterior: false,
      symmetryConstraint: undefined,
    }
    if (
      p.cutLine === synced.cutLine &&
      p.seamLine === synced.seamLine &&
      p.notches === synced.notches
    ) {
      return p
    }
    // Always replace geometry objects (geom is always new clones)
    changed = true
    return synced
  })
  return changed ? next : pieces
}

/** IDs der Kaschierungen, die an dieser Mutter hängen. */
export function facingChildIds(pieces: PatternPiece[], parentId: string): string[] {
  return pieces.filter((p) => p.facingParentId === parentId).map((p) => p.id)
}

/** Abgeleitete Kaschierung (Geometrie nur über Sync von der Mutter). */
export function isFacingDerivedPiece(piece: PatternPiece | null | undefined): boolean {
  return !!piece && (piece.kind === 'facing' || !!piece.facingParentId)
}

/**
 * Zeichen-/Hit-Reihenfolge: Kaschierungen zuerst (unten), normale Teile danach (oben).
 * Relative Reihenfolge innerhalb jeder Gruppe bleibt erhalten.
 */
export function sortPiecesFacingBehind(pieces: PatternPiece[]): PatternPiece[] {
  const behind: PatternPiece[] = []
  const front: PatternPiece[] = []
  for (const p of pieces) {
    if (isFacingDerivedPiece(p)) behind.push(p)
    else front.push(p)
  }
  if (behind.length === 0) return pieces
  return behind.length + front.length === pieces.length ? [...behind, ...front] : pieces
}
