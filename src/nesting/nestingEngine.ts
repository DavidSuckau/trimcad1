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
/** Grober Schritt für leichte Lückenfüllung (wenige Iterationen, geringer Overhead). */
const COMPACT_STEP_MM = 2
const COMPACT_FINE_MM = 0.5
const COMPACT_FINE_MAX_STEPS = 8
/** Wenige Skyline-Stützpunkte (deutlich leichter als 48 Samples). */
const SKYLINE_SAMPLES = 12
const VERTEX_CANDIDATES_PER_PIECE = 6
const REFINE_MAX_SWAPS = 4

function toClipperPath(pts: NestPoint[]): ClipperLib.IntPoint[] {
  return pts.map((p) => new ClipperLib.IntPoint(Math.round(p.x * CLIPPER_SCALE), Math.round(p.y * CLIPPER_SCALE)))
}

function boundsOverlap(a: NestPoint[], b: NestPoint[]): boolean {
  const ba = polygonBounds(a)
  const bb = polygonBounds(b)
  return !(ba.maxX <= bb.minX || bb.maxX <= ba.minX || ba.maxY <= bb.minY || bb.maxY <= ba.minY)
}

function polygonsOverlap(a: NestPoint[], b: NestPoint[]): boolean {
  if (a.length < 3 || b.length < 3) return false
  if (!boundsOverlap(a, b)) return false
  try {
    const c = new ClipperLib.Clipper()
    c.AddPath(toClipperPath(a), ClipperLib.PolyType.ptSubject, true)
    c.AddPath(toClipperPath(b), ClipperLib.PolyType.ptClip, true)
    const solution: ClipperLib.Paths = []
    c.Execute(ClipperLib.ClipType.ctIntersection, solution)
    return solution.length > 0 && solution[0].length >= 3
  } catch {
    return boundsOverlap(a, b)
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
  /** Polygon bei (0,0), für leichte Nach-Verdichtung. */
  base: NestPoint[]
}

function isValidPlacement(
  pts: NestPoint[],
  others: NestPoint[][],
  binWidth: number,
  maxLength: number | null,
): boolean {
  if (!polygonFitsInBin(pts, binWidth, maxLength)) return false
  for (const o of others) {
    if (polygonsOverlap(pts, o)) return false
  }
  return true
}

/** Gewählte Position etwas nach links/unten schieben (ein Durchlauf, grober Schritt). */
function compactPlacement(
  base: NestPoint[],
  start: NestPoint,
  others: NestPoint[][],
  binWidth: number,
  maxLength: number | null,
): NestPoint {
  let x = start.x
  let y = start.y
  let moved = true
  while (moved) {
    moved = false
    if (x > 0) {
      const next = translatePolygon(base, x - COMPACT_STEP_MM, y)
      if (isValidPlacement(next, others, binWidth, maxLength)) {
        x -= COMPACT_STEP_MM
        moved = true
      }
    }
    if (y > 0) {
      const next = translatePolygon(base, x, y - COMPACT_STEP_MM)
      if (isValidPlacement(next, others, binWidth, maxLength)) {
        y -= COMPACT_STEP_MM
        moved = true
      }
    }
  }
  let fineLeft = COMPACT_FINE_MAX_STEPS
  while (fineLeft-- > 0) {
    let moved = false
    if (x > 0) {
      const next = translatePolygon(base, x - COMPACT_FINE_MM, y)
      if (isValidPlacement(next, others, binWidth, maxLength)) {
        x -= COMPACT_FINE_MM
        moved = true
      }
    }
    if (y > 0) {
      const next = translatePolygon(base, x, y - COMPACT_FINE_MM)
      if (isValidPlacement(next, others, binWidth, maxLength)) {
        y -= COMPACT_FINE_MM
        moved = true
      }
    }
    if (!moved) break
  }
  return { x, y }
}

function getVariantPoly(geom: NestingPartGeometry, rot: NestingRotationDeg): NestPoint[] {
  return rot === 180 && geom.polygon180 ? geom.polygon180 : geom.polygon0
}

function addCandidate(candidates: NestPoint[], seen: Set<string>, c: NestPoint) {
  const key = `${Math.round(c.x * 10)}:${Math.round(c.y * 10)}`
  if (seen.has(key)) return
  seen.add(key)
  candidates.push({ x: Math.max(0, c.x), y: Math.max(0, c.y) })
}

/** Skyline: Y an Kontaktstellen entlang der Rollenbreite. */
function skylineCandidates(placed: Placed[], variantW: number, binWidth: number, gap: number): NestPoint[] {
  if (placed.length === 0 || variantW >= binWidth - 0.01) return []
  const out: NestPoint[] = []
  const stepX = Math.max(8, (binWidth - variantW) / Math.max(1, SKYLINE_SAMPLES - 1))
  for (let xi = 0; xi <= binWidth - variantW + 0.01; xi += stepX) {
    const x = Math.min(xi, Math.max(0, binWidth - variantW))
    let h = 0
    for (const p of placed) {
      const b = polygonBounds(p.pts)
      if (x + variantW < b.minX - 0.01 || x > b.maxX + 0.01) continue
      h = Math.max(h, b.maxY)
      for (const pt of p.pts) {
        if (pt.x >= x - 0.01 && pt.x <= x + variantW + 0.01) h = Math.max(h, pt.y)
      }
    }
    out.push({ x, y: h + gap })
  }
  return out
}

/** Eckpunkte bereits platzierter Teile (begrenzt, für konkave Lücken). */
function vertexCandidates(placed: Placed[], gap: number): NestPoint[] {
  const out: NestPoint[] = []
  for (const p of placed) {
    const pts = p.pts
    if (pts.length < 3) continue
    const step = pts.length <= VERTEX_CANDIDATES_PER_PIECE ? 1 : Math.ceil(pts.length / VERTEX_CANDIDATES_PER_PIECE)
    let added = 0
    for (let i = 0; i < pts.length && added < VERTEX_CANDIDATES_PER_PIECE; i += step) {
      const v = pts[i]
      out.push({ x: v.x + gap, y: v.y })
      out.push({ x: v.x, y: v.y + gap })
      out.push({ x: v.x + gap, y: v.y + gap })
      added++
    }
  }
  return out
}

function candidatePositions(
  placed: Placed[],
  variantBounds: { width: number; height: number },
  binWidth: number,
  spacingMm: number,
): NestPoint[] {
  const gap = Math.max(0, spacingMm)
  const seen = new Set<string>()
  const candidates: NestPoint[] = []
  addCandidate(candidates, seen, { x: 0, y: 0 })
  for (const p of placed) {
    const b = polygonBounds(p.pts)
    addCandidate(candidates, seen, { x: b.minX, y: b.maxY + gap })
    addCandidate(candidates, seen, { x: b.maxX + gap, y: b.minY })
    addCandidate(candidates, seen, { x: 0, y: b.maxY + gap })
    addCandidate(candidates, seen, { x: b.minX, y: b.minY })
    if (b.maxX + gap + variantBounds.width <= binWidth + 0.01) {
      addCandidate(candidates, seen, { x: b.maxX + gap, y: b.minY })
      addCandidate(candidates, seen, { x: b.maxX + gap, y: b.maxY + gap })
    }
    if (b.minX + variantBounds.width <= binWidth + 0.01) {
      addCandidate(candidates, seen, { x: b.minX, y: b.maxY + gap })
    }
    const rightX = binWidth - variantBounds.width
    if (rightX >= 0 && rightX + variantBounds.width <= binWidth + 0.01) {
      addCandidate(candidates, seen, { x: rightX, y: b.maxY + gap })
      addCandidate(candidates, seen, { x: rightX, y: b.minY })
    }
    if (b.maxX + gap + variantBounds.width <= binWidth + 0.01) {
      addCandidate(candidates, seen, { x: b.maxX + gap, y: 0 })
    }
  }
  for (const c of skylineCandidates(placed, variantBounds.width, binWidth, gap)) {
    addCandidate(candidates, seen, c)
  }
  for (const c of vertexCandidates(placed, gap)) {
    addCandidate(candidates, seen, c)
  }
  candidates.sort((a, b) => a.y - b.y || a.x - b.x)
  return candidates
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

function orderByArea(instances: Instance[]): Instance[] {
  return [...instances].sort((a, b) => b.geom.areaMm2 - a.geom.areaMm2)
}

function instanceDim(geom: NestingPartGeometry, axis: 'x' | 'y'): number {
  const b = polygonBounds(geom.polygon0)
  return axis === 'x' ? b.maxX - b.minX : b.maxY - b.minY
}

function orderByHeight(instances: Instance[]): Instance[] {
  return [...instances].sort((a, b) => instanceDim(b.geom, 'y') - instanceDim(a.geom, 'y'))
}

function orderByWidth(instances: Instance[]): Instance[] {
  return [...instances].sort((a, b) => instanceDim(b.geom, 'x') - instanceDim(a.geom, 'x'))
}

function orderByMaxSide(instances: Instance[]): Instance[] {
  return [...instances].sort((a, b) => {
    const ma = Math.max(instanceDim(a.geom, 'x'), instanceDim(a.geom, 'y'))
    const mb = Math.max(instanceDim(b.geom, 'x'), instanceDim(b.geom, 'y'))
    return mb - ma
  })
}

function rotationsByCompactness(
  geom: NestingPartGeometry,
  allow180: boolean,
): NestingRotationDeg[] {
  if (!allow180 || !geom.polygon180) return [0]
  const h0 = polygonBounds(geom.polygon0).maxY - polygonBounds(geom.polygon0).minY
  const h180 = polygonBounds(geom.polygon180).maxY - polygonBounds(geom.polygon180).minY
  return h180 < h0 - 0.01 ? [180, 0] : [0, 180]
}

function placementScore(pts: NestPoint[], binWidth: number): number {
  const b = polygonBounds(pts)
  const pieceArea = Math.abs(polygonSignedAreaLocal(pts))
  const usedStrip = (b.maxY + 1) * binWidth
  const waste = usedStrip - pieceArea
  return b.maxY * 1_000_000 + waste * 50 + b.maxX * 100 + b.minX
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
  const rotations = rotationsByCompactness(inst.geom, allow180)

  const others = placed.map((p) => p.pts)
  let best: { pts: NestPoint[]; placement: NestingPlacement; base: NestPoint[]; score: number } | null = null

  for (const rot of rotations) {
    const base = getVariantPoly(inst.geom, rot)
    const bb = polygonBounds(base)
    const variantW = bb.maxX - bb.minX
    const variantH = bb.maxY - bb.minY
    if (variantW > binWidth + 0.01) continue

    const positions = candidatePositions(placed, { width: variantW, height: variantH }, binWidth, gap)
    for (const pos of positions) {
      const pts = translatePolygon(base, pos.x, pos.y)
      if (!isValidPlacement(pts, others, binWidth, maxLength)) continue
      const score = placementScore(pts, binWidth)
      if (!best || score < best.score) {
        best = {
          pts,
          base,
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
  if (!best) return null
  const compacted = compactPlacement(best.base, { x: best.placement.x, y: best.placement.y }, others, binWidth, maxLength)
  const pts = translatePolygon(best.base, compacted.x, compacted.y)
  return {
    pts,
    base: best.base,
    placement: { ...best.placement, x: compacted.x, y: compacted.y },
  }
}

/** Mehrere Reihenfolgen testen (Bottom-Left-Heuristik, inspiriert von SVGNest/Deepnest). */
const ORDER_SHUFFLES = 8

function runSingleOrder(
  instances: Instance[],
  req: NestingJobRequest,
  onPieceStep?: () => void,
): { placements: NestingPlacement[]; placed: Placed[]; unplaced: number } {
  const placed: Placed[] = []
  let unplaced = 0

  for (const inst of instances) {
    const allow180 = inst.geom.polygon180 != null
    const result = tryPlaceInstance(inst, placed, req.rollWidthMm, req.maxRollLengthMm, req.spacingMm, allow180)
    if (!result) {
      unplaced++
    } else {
      placed.push(result)
    }
    onPieceStep?.()
  }

  const compactPass = () => {
    for (let i = 0; i < placed.length; i++) {
      const cur = placed[i]
      const others = placed.filter((_, j) => j !== i).map((p) => p.pts)
      const compacted = compactPlacement(
        cur.base,
        { x: cur.placement.x, y: cur.placement.y },
        others,
        req.rollWidthMm,
        req.maxRollLengthMm,
      )
      const pts = translatePolygon(cur.base, compacted.x, compacted.y)
      if (isValidPlacement(pts, others, req.rollWidthMm, req.maxRollLengthMm)) {
        placed[i] = {
          ...cur,
          pts,
          placement: { ...cur.placement, x: compacted.x, y: compacted.y },
        }
      }
    }
  }
  compactPass()
  if (placed.length > 1) compactPass()
  if (placed.length > 2 && placed.length <= 24) compactPass()
  const finalPlacements = placed.map((p) => p.placement)
  return { placements: finalPlacements, placed, unplaced }
}

function isBetterAttempt(
  attempt: { unplaced: number; placed: Placed[] },
  best: { unplaced: number; placed: Placed[] },
  rollWidthMm: number,
  bestUsedY: number,
  bestEfficiency: number,
): { better: boolean; usedY: number; efficiency: number } {
  const usedY = measureUsedLength(attempt.placed)
  const efficiency = measureEfficiency(attempt.placed, rollWidthMm)
  const better =
    attempt.unplaced < best.unplaced ||
    (attempt.unplaced === best.unplaced &&
      (efficiency > bestEfficiency + 0.35 ||
        (Math.abs(efficiency - bestEfficiency) <= 0.35 && usedY < bestUsedY - 0.5)))
  return { better, usedY, efficiency }
}

/** Benachbarte große Teile tauschen (nur wenn noch Zeitbudget). */
function refineOrders(base: Instance[], maxSwaps: number): Instance[][] {
  const out: Instance[][] = []
  for (let i = 0; i < Math.min(maxSwaps, base.length - 1); i++) {
    const swapped = [...base]
    ;[swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]]
    out.push(swapped)
  }
  return out
}

function measureUsedLength(placed: Placed[]): number {
  let used = 0
  for (const p of placed) {
    used = Math.max(used, polygonBounds(p.pts).maxY)
  }
  return used
}

function measureEfficiency(placed: Placed[], rollWidthMm: number): number {
  let usedLengthMm = measureUsedLength(placed)
  let totalPieceAreaMm2 = 0
  for (const p of placed) {
    totalPieceAreaMm2 += Math.abs(polygonSignedAreaLocal(p.pts))
  }
  const binArea = rollWidthMm * Math.max(usedLengthMm, 1)
  return binArea > 0 ? Math.min(100, (totalPieceAreaMm2 / binArea) * 100) : 0
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

  const byArea = orderByArea(instances)
  const orders: Instance[][] = [
    byArea,
    orderByHeight(instances),
    orderByWidth(instances),
    orderByMaxSide(instances),
  ]
  for (let s = 0; s < ORDER_SHUFFLES - 4; s++) {
    orders.push(shuffleOrder(byArea, s + 42))
  }

  let bestOrderIdx = 0
  let bestResult = runSingleOrder(orders[0], req, () => pieceStep('placing'))
  let bestUsedY = measureUsedLength(bestResult.placed)
  let bestEfficiency = measureEfficiency(bestResult.placed, req.rollWidthMm)

  for (let o = 1; o < orders.length; o++) {
    if (Date.now() - started > req.timeLimitMs) break
    const attempt = runSingleOrder(orders[o], req, () => pieceStep('optimizing'))
    const cmp = isBetterAttempt(attempt, bestResult, req.rollWidthMm, bestUsedY, bestEfficiency)
    if (cmp.better) {
      bestResult = attempt
      bestUsedY = cmp.usedY
      bestEfficiency = cmp.efficiency
      bestOrderIdx = o
    }
  }

  const timeLeft = req.timeLimitMs - (Date.now() - started)
  if (
    timeLeft > req.timeLimitMs * 0.25 &&
    instances.length <= 28 &&
    bestResult.unplaced === 0
  ) {
    for (const refined of refineOrders(orders[bestOrderIdx], REFINE_MAX_SWAPS)) {
      if (Date.now() - started > req.timeLimitMs) break
      const attempt = runSingleOrder(refined, req, () => pieceStep('optimizing'))
      const cmp = isBetterAttempt(attempt, bestResult, req.rollWidthMm, bestUsedY, bestEfficiency)
      if (cmp.better) {
        bestResult = attempt
        bestUsedY = cmp.usedY
        bestEfficiency = cmp.efficiency
      }
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
