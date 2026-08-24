import type { Curve, Drill, Notch, PatternPiece, Point } from '../types/model'
import { curvesBounds } from './curveToPath'
import { chamferCutLineCornersInSeamAllowance } from './facingChamfer'
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
  fillInterior: true
  material: string
  description: string
  bomQuantity: number
  layer: string
  kind: 'facing'
} {
  const seamLine = cloneCurves(parent.seamLine)
  const cutBefore = cloneCurves(parent.cutLine)
  const draft: PatternPiece = {
    ...parent,
    cutLine: cutBefore,
    seamLine,
    notches: cloneNotches(parent.notches),
    drills: cloneDrills(parent.drills),
    grainLine: cloneGrain(parent.grainLine),
    internalLines: cloneCurves(parent.internalLines),
    internalCircles: cloneCircles(parent.internalCircles),
    softVertices: [...(parent.softVertices ?? [])],
    softVerticesMaster: [...(parent.softVerticesMaster ?? [])],
    roundedCorners: parent.roundedCorners ? parent.roundedCorners.map((r) => ({ ...r })) : undefined,
    edgeSeamAllowances: parent.edgeSeamAllowances
      ? parent.edgeSeamAllowances.map((e) => ({ ...e }))
      : undefined,
  }

  const cutLine = chamferCutLineCornersInSeamAllowance(draft)
  const notches = resyncNotchesAfterCutLineRebuilt(draft.notches, cutBefore, cutLine)

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
    fillInterior: true,
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
 * Behält Transform, id, number, name, material und facingParentId der Kinder.
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
      transform: { ...p.transform },
      facingParentId: parentId,
      kind: 'facing',
      fillInterior: true,
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
