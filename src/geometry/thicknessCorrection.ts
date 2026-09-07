import type {
  Curve,
  Drill,
  Notch,
  PatternPiece,
  Point,
  ThicknessCorrectionMode,
  ThicknessCorrectionParams,
  ThicknessCorrectionStats,
} from '../types/model'
import { bezierAt, curvesBounds, totalPathLength } from './curveToPath'
import { deriveCutLineForPiece } from './deriveCutLineForPiece'
import { rematerializeNotchesAfterGeometricMirror } from './notchResyncCutLine'
import { offsetCurvesInwardForSeam } from './offset'
import { facingOffsetBesideParent } from './facingPiece'
import { useSeamLineForVertexEditing } from './vertexMaster'

/** Default-Radius (mm), wenn keine 3D-Krümmung vorliegt — flache bis moderate Sitze. */
export const DEFAULT_THICKNESS_MEAN_RADIUS_MM = 120

export function clampNeutralFactor(k: number): number {
  if (!Number.isFinite(k)) return 0.5
  return Math.min(1, Math.max(0, k))
}

export function resolveNeutralFactor(
  mode: ThicknessCorrectionMode,
  neutralFactor?: number,
): number {
  if (mode === 'outer') return 0
  if (mode === 'inner') return 1
  if (mode === 'mid') return 0.5
  return clampNeutralFactor(neutralFactor ?? 0.5)
}

/** λ = 1 − κ·k·t  (κ = 1/R), abgeschnitten auf [0,05 … 3]. */
export function lengthScaleFromThickness(args: {
  thicknessMm: number
  meanRadiusMm: number
  neutralFactor: number
}): number {
  const t = Math.max(0, args.thicknessMm)
  const R = Math.max(1e-6, args.meanRadiusMm)
  const k = clampNeutralFactor(args.neutralFactor)
  const raw = 1 - (k * t) / R
  return Math.min(3, Math.max(0.05, raw))
}

function clonePoint(p: Point): Point {
  return { x: p.x, y: p.y }
}

function cloneCurve(c: Curve): Curve {
  if (c.type === 'line') {
    return { type: 'line', start: clonePoint(c.start), end: clonePoint(c.end) }
  }
  return {
    type: 'bezier',
    start: clonePoint(c.start),
    end: clonePoint(c.end),
    cp1: clonePoint(c.cp1),
    cp2: clonePoint(c.cp2),
  }
}

function centroidOfCurves(curves: Curve[]): Point {
  const b = curvesBounds(curves)
  if (b) return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
  return { x: 0, y: 0 }
}

/**
 * Homothetie um den Schwerpunkt: jedes Segment bleibt erhalten (gleiche Anzahl/Typen).
 * λ = 1 → Identität. Topologie für Nahtzuordnungen und Kerben-Resync bleibt gültig.
 */
export function scaleCurvesAboutCentroid(curves: Curve[], scale: number, centroid?: Point): Curve[] {
  if (curves.length === 0) return []
  const c = centroid ?? centroidOfCurves(curves)
  const mapPt = (p: Point): Point => ({
    x: c.x + (p.x - c.x) * scale,
    y: c.y + (p.y - c.y) * scale,
  })
  return curves.map((seg) => {
    if (seg.type === 'line') {
      return { type: 'line' as const, start: mapPt(seg.start), end: mapPt(seg.end) }
    }
    return {
      type: 'bezier' as const,
      start: mapPt(seg.start),
      end: mapPt(seg.end),
      cp1: mapPt(seg.cp1),
      cp2: mapPt(seg.cp2),
    }
  })
}

function mapPointAbout(p: Point, centroid: Point, scale: number): Point {
  return {
    x: centroid.x + (p.x - centroid.x) * scale,
    y: centroid.y + (p.y - centroid.y) * scale,
  }
}

function sampleRadialDeltasMm(oldCurves: Curve[], newCurves: Curve[], centroid: Point): number[] {
  const out: number[] = []
  const n = Math.min(oldCurves.length, newCurves.length)
  for (let i = 0; i < n; i++) {
    const a = oldCurves[i]!
    const b = newCurves[i]!
    const samples: Point[] =
      a.type === 'line'
        ? [
            a.start,
            { x: (a.start.x + a.end.x) / 2, y: (a.start.y + a.end.y) / 2 },
            a.end,
          ]
        : [0, 0.5, 1].map((t) => bezierAt(a, t))
    const samplesNew: Point[] =
      b.type === 'line'
        ? [
            b.start,
            { x: (b.start.x + b.end.x) / 2, y: (b.start.y + b.end.y) / 2 },
            b.end,
          ]
        : [0, 0.5, 1].map((t) => bezierAt(b, t))
    for (let s = 0; s < samples.length; s++) {
      const ro = Math.hypot(samples[s]!.x - centroid.x, samples[s]!.y - centroid.y)
      const rn = Math.hypot(samplesNew[s]!.x - centroid.x, samplesNew[s]!.y - centroid.y)
      out.push(rn - ro)
    }
  }
  return out
}

export type BuildThicknessGeometryResult = {
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
  kind: 'thickness'
  thicknessCorrection: ThicknessCorrectionParams
}

/**
 * Geometrie einer Dickenkorrektur aus der Mutter.
 * Segmentzahl/-typen bleiben erhalten; Kerben werden topologie-kompatibel rematerialisiert.
 */
export function buildThicknessGeometryFromParent(
  parent: PatternPiece,
  params: {
    thicknessMm: number
    mode: ThicknessCorrectionMode
    neutralFactor?: number
    meanRadiusMm?: number
  },
): BuildThicknessGeometryResult {
  const thicknessMm = Math.max(0, params.thicknessMm)
  const mode = params.mode
  const neutralFactor = resolveNeutralFactor(mode, params.neutralFactor)
  const meanRadiusMm =
    params.meanRadiusMm != null && Number.isFinite(params.meanRadiusMm) && params.meanRadiusMm > 0
      ? params.meanRadiusMm
      : DEFAULT_THICKNESS_MEAN_RADIUS_MM
  const scale = lengthScaleFromThickness({ thicknessMm, meanRadiusMm, neutralFactor })

  const useSeam = useSeamLineForVertexEditing(parent)
  const masterSrc = useSeam ? parent.seamLine : parent.cutLine
  const centroid = centroidOfCurves(masterSrc.length >= 3 ? masterSrc : parent.cutLine)
  const oldCutLine = parent.cutLine.map(cloneCurve)
  const oldInternal = parent.internalLines.map(cloneCurve)

  let seamLine: Curve[]
  let cutLine: Curve[]
  if (useSeam) {
    seamLine = scaleCurvesAboutCentroid(parent.seamLine, scale, centroid)
    if (parent.cutLineDeviatesFromSeamAllowanceOffset === true) {
      cutLine = scaleCurvesAboutCentroid(parent.cutLine, scale, centroid)
    } else if (parent.seamAllowanceMm != null && parent.seamAllowanceMm > 0 && seamLine.length >= 3) {
      const derived = deriveCutLineForPiece(
        {
          ...parent,
          seamLine,
          cutLineDeviatesFromSeamAllowanceOffset: false,
        },
        seamLine,
        parent.seamAllowanceMm,
      )
      cutLine = derived.ok ? derived.cutLine : scaleCurvesAboutCentroid(parent.cutLine, scale, centroid)
    } else {
      cutLine = scaleCurvesAboutCentroid(parent.cutLine, scale, centroid)
    }
  } else {
    cutLine = scaleCurvesAboutCentroid(parent.cutLine, scale, centroid)
    seamLine =
      parent.seamAllowanceMm != null && cutLine.length >= 3
        ? offsetCurvesInwardForSeam(cutLine, parent.seamAllowanceMm)
        : []
  }

  const internalLines = scaleCurvesAboutCentroid(parent.internalLines, scale, centroid)
  const mapPt = (p: Point) => mapPointAbout(p, centroid, scale)
  const notches = rematerializeNotchesAfterGeometricMirror({
    notches: parent.notches,
    oldCutLine,
    mirroredCutLine: scaleCurvesAboutCentroid(oldCutLine, scale, centroid),
    finalCutLine: cutLine,
    oldInternalLines: oldInternal,
    mirroredInternalLines: internalLines,
    mapPoint: mapPt,
  })
  const drills = parent.drills.map((d) => ({ ...d, center: mapPt(d.center) }))
  const internalCircles = parent.internalCircles.map((ic) => ({
    ...ic,
    center: mapPt(ic.center),
    radius: Math.max(0.1, ic.radius * Math.abs(scale)),
  }))
  const grainLine = parent.grainLine
    ? { start: mapPt(parent.grainLine.start), end: mapPt(parent.grainLine.end) }
    : null

  const oldLen = totalPathLength(masterSrc)
  const newMaster = useSeam && seamLine.length >= 3 ? seamLine : cutLine
  const newLen = totalPathLength(newMaster)
  const deltas = sampleRadialDeltasMm(
    masterSrc.length >= 3 ? masterSrc : oldCutLine,
    newMaster.length >= 3 ? newMaster : cutLine,
    centroid,
  )
  const stats: ThicknessCorrectionStats = {
    meanScalePercent: oldLen > 1e-9 ? ((newLen / oldLen) - 1) * 100 : (scale - 1) * 100,
    maxDeltaMm: deltas.length ? Math.max(...deltas) : 0,
    minDeltaMm: deltas.length ? Math.min(...deltas) : 0,
    appliedScale: scale,
    meanRadiusMm,
  }

  const thicknessCorrection: ThicknessCorrectionParams = {
    thicknessMm,
    mode,
    neutralFactor,
    meanRadiusMm,
    linked: true,
    stats,
  }

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
    softVertices: [...(parent.softVertices ?? [])],
    softVerticesMaster: [...(parent.softVerticesMaster ?? [])],
    roundedCorners: parent.roundedCorners ? parent.roundedCorners.map((r) => ({ ...r })) : undefined,
    fillInterior: parent.fillInterior,
    material: parent.material ?? '',
    description: parent.description ?? '',
    bomQuantity: parent.bomQuantity ?? 1,
    layer: parent.layer,
    kind: 'thickness',
    thicknessCorrection,
  }
}

export function thicknessOffsetBesideParent(parent: PatternPiece): Point {
  return facingOffsetBesideParent(parent)
}

export function thicknessChildIds(pieces: PatternPiece[], parentId: string): string[] {
  return pieces.filter((p) => p.thicknessParentId === parentId).map((p) => p.id)
}

export function isThicknessDerivedPiece(piece: PatternPiece | null | undefined): boolean {
  return !!piece && (piece.kind === 'thickness' || !!piece.thicknessParentId)
}

export function suggestedThicknessPieceName(parent: PatternPiece, thicknessMm: number): string {
  const base = parent.name?.trim() || `Teil ${parent.number}`
  const label = Number.isInteger(thicknessMm) ? String(thicknessMm) : thicknessMm.toFixed(1).replace('.', ',')
  return `${base}_${label}mm`
}

/**
 * Synchronisiert verknüpfte Dickenkorrekturen aus der Mutter.
 * Gelöste Kinder (`linked: false`) bleiben unverändert.
 */
export function syncThicknessPiecesFromParents(pieces: PatternPiece[]): PatternPiece[] {
  const byId = new Map(pieces.map((p) => [p.id, p]))
  let changed = false
  const next = pieces.map((p) => {
    const parentId = p.thicknessParentId
    if (!parentId) return p
    if (p.thicknessCorrection?.linked === false) return p
    const parent = byId.get(parentId)
    if (!parent || isThicknessDerivedPiece(parent) || parent.facingParentId || parent.kind === 'facing') {
      return p
    }
    const tc = p.thicknessCorrection
    if (!tc || !(tc.thicknessMm > 0)) return p
    const geom = buildThicknessGeometryFromParent(parent, {
      thicknessMm: tc.thicknessMm,
      mode: tc.mode,
      neutralFactor: tc.neutralFactor,
      meanRadiusMm: tc.meanRadiusMm,
    })
    changed = true
    return {
      ...p,
      ...geom,
      id: p.id,
      number: p.number,
      name: p.name,
      material: parent.material ?? '',
      grainLine: p.grainLine
        ? { start: { ...p.grainLine.start }, end: { ...p.grainLine.end } }
        : geom.grainLine,
      transform: { ...p.transform },
      thicknessParentId: parentId,
      kind: 'thickness' as const,
      thicknessCorrection: {
        ...geom.thicknessCorrection,
        linked: true,
      },
      facingParentId: undefined,
      mirrorParentId: undefined,
      symmetryConstraint: undefined,
    }
  })
  return changed ? next : pieces
}
