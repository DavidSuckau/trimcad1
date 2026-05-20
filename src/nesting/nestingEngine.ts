import type {
  NestingJobRequest,
  NestingJobResponse,
  NestingPartGeometry,
  NestingPlacement,
  NestingPlan,
  NestingProgressCallback,
  NestingProgressPhase,
  NestingRotationDeg,
} from './nestingTypes'
import { polygonBounds, translatePolygon, type NestPoint } from './nestingGeometry'
// @ts-expect-error clipper-lib has no types
import ClipperLib from 'clipper-lib'

const CLIPPER_SCALE = 1000

function toClipperPath(pts: NestPoint[]): ClipperLib.IntPoint[] {
  return pts.map((p) => new ClipperLib.IntPoint(Math.round(p.x * CLIPPER_SCALE), Math.round(p.y * CLIPPER_SCALE)))
}

function polygonsOverlap(a: NestPoint[], b: NestPoint[]): boolean {
  if (a.length < 3 || b.length < 3) return false
  try {
    const c = new ClipperLib.Clipper()
    c.AddPath(toClipperPath(a), ClipperLib.PolyType.ptSubject, true)
    c.AddPath(toClipperPath(b), ClipperLib.PolyType.ptClip, true)
    const solution: ClipperLib.Paths = []
    c.Execute(ClipperLib.ClipType.ctIntersection, solution)
    return solution.length > 0 && solution[0].length >= 3
  } catch {
    const ba = polygonBounds(a)
    const bb = polygonBounds(b)
    return !(ba.maxX <= bb.minX || bb.maxX <= ba.minX || ba.maxY <= bb.minY || bb.maxY <= ba.minY)
  }
}

function polygonFitsInBin(pts: NestPoint[], binWidth: number, maxLength: number | null): boolean {
  const b = polygonBounds(pts)
  if (b.minX < -0.01 || b.maxX > binWidth + 0.01) return false
  if (b.minY < -0.01) return false
  if (maxLength != null && b.maxY > maxLength + 0.01) return false
  return true
}

type Placed = {
  pts: NestPoint[]
  placement: NestingPlacement
}

function getVariantPoly(geom: NestingPartGeometry, rot: NestingRotationDeg): NestPoint[] {
  return rot === 180 && geom.polygon180 ? geom.polygon180 : geom.polygon0
}

function candidatePositions(
  placed: Placed[],
  variantBounds: { width: number; height: number },
  binWidth: number,
  spacingMm: number,
): NestPoint[] {
  const gap = Math.max(0, spacingMm)
  const candidates: NestPoint[] = [{ x: 0, y: 0 }]
  for (const p of placed) {
    const b = polygonBounds(p.pts)
    candidates.push({ x: b.minX, y: b.maxY + gap })
    candidates.push({ x: b.maxX + gap, y: b.minY })
    candidates.push({ x: 0, y: b.maxY + gap })
    candidates.push({ x: b.minX, y: b.minY })
    if (b.maxX + gap + variantBounds.width <= binWidth + 0.01) {
      candidates.push({ x: b.maxX + gap, y: b.minY })
      candidates.push({ x: b.maxX + gap, y: b.maxY + gap })
    }
    if (b.minX + variantBounds.width <= binWidth + 0.01) {
      candidates.push({ x: b.minX, y: b.maxY + gap })
    }
  }
  const seen = new Set<string>()
  const unique: NestPoint[] = []
  for (const c of candidates) {
    const key = `${Math.round(c.x * 10)}:${Math.round(c.y * 10)}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push({ x: Math.max(0, c.x), y: Math.max(0, c.y) })
  }
  return unique
}

type Instance = {
  pieceId: string
  instanceIndex: number
  geom: NestingPartGeometry
}

function buildInstances(req: NestingJobRequest): Instance[] {
  const out: Instance[] = []
  for (const part of req.parts) {
    const q = Math.max(0, Math.floor(part.quantity))
    for (let i = 0; i < q; i++) {
      out.push({ pieceId: part.pieceId, instanceIndex: i, geom: part.geometry })
    }
  }
  return out
}

function orderInstances(instances: Instance[]): Instance[] {
  return [...instances].sort((a, b) => b.geom.areaMm2 - a.geom.areaMm2)
}

function tryPlaceInstance(
  inst: Instance,
  placed: Placed[],
  binWidth: number,
  maxLength: number | null,
  spacingMm: number,
  allow180: boolean,
): Placed | null {
  const gap = Math.max(0, spacingMm)
  const rotations: NestingRotationDeg[] = allow180 && inst.geom.polygon180 ? [0, 180] : [0]

  let best: { pts: NestPoint[]; placement: NestingPlacement; score: number } | null = null

  for (const rot of rotations) {
    const base = getVariantPoly(inst.geom, rot)
    const bb = polygonBounds(base)
    const variantW = bb.maxX - bb.minX
    const variantH = bb.maxY - bb.minY
    if (variantW > binWidth + 0.01) continue

    const positions = candidatePositions(placed, { width: variantW, height: variantH }, binWidth, gap)
    for (const pos of positions) {
      const pts = translatePolygon(base, pos.x, pos.y)
      if (!polygonFitsInBin(pts, binWidth, maxLength)) continue
      let clash = false
      for (const p of placed) {
        if (polygonsOverlap(pts, p.pts)) {
          clash = true
          break
        }
      }
      if (clash) continue
      const b = polygonBounds(pts)
      const score = b.maxY * 1_000_000 + b.minX
      if (!best || score < best.score) {
        best = {
          pts,
          score,
          placement: {
            pieceId: inst.pieceId,
            instanceIndex: inst.instanceIndex,
            x: pos.x,
            y: pos.y,
            rotationDeg: rot,
            mirrored: false,
          },
        }
      }
    }
  }
  return best ? { pts: best.pts, placement: best.placement } : null
}

/** Mehrere Reihenfolgen testen (Bottom-Left-Heuristik, inspiriert von SVGNest/Deepnest). */
const ORDER_SHUFFLES = 8

function runSingleOrder(
  instances: Instance[],
  req: NestingJobRequest,
  onPieceStep?: () => void,
): { placements: NestingPlacement[]; placed: Placed[]; unplaced: number } {
  const placed: Placed[] = []
  const placements: NestingPlacement[] = []
  let unplaced = 0

  for (const inst of instances) {
    const allow180 = inst.geom.polygon180 != null
    const result = tryPlaceInstance(inst, placed, req.rollWidthMm, req.maxRollLengthMm, req.spacingMm, allow180)
    if (!result) {
      unplaced++
    } else {
      placed.push(result)
      placements.push(result.placement)
    }
    onPieceStep?.()
  }
  return { placements, placed, unplaced }
}

function shuffleOrder<T>(arr: T[], seed: number): T[] {
  const a = [...arr]
  let s = seed
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const j = s % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function runNesting(req: NestingJobRequest, onProgress?: NestingProgressCallback): NestingJobResponse {
  const started = Date.now()
  const instances = buildInstances(req)
  if (instances.length === 0) {
    return { ok: false, error: 'Keine Teile mit Stückzahl > 0.' }
  }

  const pieceCount = instances.length
  const totalSteps = pieceCount * ORDER_SHUFFLES
  let completedSteps = 0
  const report = (phase: NestingProgressPhase) => {
    if (!onProgress || totalSteps <= 0) return
    const pct = Math.min(99, Math.round((completedSteps / totalSteps) * 100))
    onProgress(pct, phase)
  }
  const pieceStep = (phase: NestingProgressPhase) => {
    completedSteps++
    report(phase)
  }

  onProgress?.(0, 'placing')

  const sorted = orderInstances(instances)
  let bestResult = runSingleOrder(sorted, req, () => pieceStep('placing'))
  let bestUsedY = 0
  for (const p of bestResult.placed) {
    bestUsedY = Math.max(bestUsedY, polygonBounds(p.pts).maxY)
  }

  for (let s = 1; s < ORDER_SHUFFLES; s++) {
    if (Date.now() - started > req.timeLimitMs) break
    const shuffled = shuffleOrder(sorted, s + 42)
    const attempt = runSingleOrder(shuffled, req, () => pieceStep('optimizing'))
    let usedY = 0
    for (const p of attempt.placed) {
      usedY = Math.max(usedY, polygonBounds(p.pts).maxY)
    }
    const better =
      attempt.unplaced < bestResult.unplaced ||
      (attempt.unplaced === bestResult.unplaced && usedY < bestUsedY - 0.5)
    if (better) {
      bestResult = attempt
      bestUsedY = usedY
    }
  }

  onProgress?.(100, 'optimizing')

  if (bestResult.unplaced > 0 && bestResult.placements.length === 0) {
    return {
      ok: false,
      error: `${bestResult.unplaced} Teil(e) passen nicht in die Rollenbreite ${req.rollWidthMm} mm.`,
    }
  }

  let usedLengthMm = 0
  let totalPieceAreaMm2 = 0
  for (const p of bestResult.placed) {
    const b = polygonBounds(p.pts)
    usedLengthMm = Math.max(usedLengthMm, b.maxY)
    totalPieceAreaMm2 += Math.abs(polygonSignedAreaLocal(p.pts))
  }

  const binArea = req.rollWidthMm * Math.max(usedLengthMm, 1)
  const efficiencyPct = binArea > 0 ? Math.min(100, (totalPieceAreaMm2 / binArea) * 100) : 0

  const warnings: string[] = []
  if (bestResult.unplaced > 0) {
    warnings.push(`${bestResult.unplaced} Teil(e) konnten nicht platziert werden.`)
  }

  const plan: NestingPlan = {
    materialKey: req.materialKey,
    rollWidthMm: req.rollWidthMm,
    spacingMm: req.spacingMm,
    placements: bestResult.placements,
    usedLengthMm,
    efficiencyPct,
    totalPieceAreaMm2,
    warnings,
  }

  return { ok: true, plan }
}

function polygonSignedAreaLocal(pts: NestPoint[]): number {
  if (pts.length < 3) return 0
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return a / 2
}
