import type { Curve, PatternPiece, Point } from '../types/model'
import { bezierAt, signedAreaCurves } from './curveToPath'
import { interiorAngleAtVertexDegrees } from './softVertexPromotion'

const MIN_CHAMFER_MM = 0.5
/**
 * Nur echte Knicke chamfern. Tessellationspunkte entlang einer Kurve (Clipper-Offset)
 * sind nahezu kollinear (~180°) und würden sonst die gesamte Nahtzugabe „auffressen“.
 */
const MAX_INTERIOR_DEG_FOR_CHAMFER = 165
/**
 * Max. Anteil der Cut-Kante pro Ecke. Hoch halten, damit die Fase möglichst
 * durch die Naht-Ecke geht (Winkel folgen), nicht als kurze Stub-Kante endet.
 */
const MAX_EDGE_TRIM_FRAC = 0.49
/** Kleines paralleles Mittelstück behalten (NZ sichtbar); Rest darf Fase sein. */
const MIN_EDGE_FLAT_FRAC = 0.08
const MIN_EDGE_FLAT_MM = 2

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

function vertexAt(curves: Curve[], vi: number): Point {
  const n = curves.length
  const i = ((vi % n) + n) % n
  return { ...curves[i].start }
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y
}

function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y }
}

function scale(a: Point, s: number): Point {
  return { x: a.x * s, y: a.y * s }
}

function adjacentEdgeLensAt(curves: Curve[], vi: number): { prev: number; next: number; min: number } {
  const n = curves.length
  const prev = curves[(vi - 1 + n) % n]
  const curr = curves[vi]
  const prevLen = dist(prev.start, prev.end)
  const nextLen = dist(curr.start, curr.end)
  return { prev: prevLen, next: nextLen, min: Math.min(prevLen, nextLen) }
}

/**
 * Erwarteter Abstand Naht-Ecke → scharfe Cut-Ecke (Miter) aus Innenwinkel an der Naht.
 * Bei 90°: SA·√2, nicht SA — sonst gewinnen Tessellations-Knicke näher an S.
 */
function expectedCutCornerDistFromSeam(seam: Curve[], seamIndex: number, saMm: number): number {
  const interiorDeg = interiorAngleAtVertexDegrees(seam, seamIndex)
  if (interiorDeg == null || interiorDeg >= MAX_INTERIOR_DEG_FOR_CHAMFER) return saMm
  const halfRad = ((180 - interiorDeg) / 2) * (Math.PI / 180)
  const sinHalf = Math.sin(halfRad)
  if (sinHalf < 0.12) return saMm * 2.5
  return saMm / sinHalf
}

/**
 * Zur Naht-Ecke S die passende **scharfe** Cut-Ecke (Miter-Spitze).
 * Bei Clipper-Offset auf Kurven liegen Tessellations-Knicke oft näher an S als die echte
 * Miter-Ecke — deshalb Abstand ≈ expectedDist (aus Naht-Innenwinkel) und stabile Kantenlänge.
 */
function bestSharpCutCornerForSeamVertex(
  cut: Curve[],
  S: Point,
  seam: Curve[],
  seamIndex: number,
  maxPairDist: number,
  expectedSaMm: number,
): { index: number; dist: number; C: Point } | null {
  if (cut.length < 3) return null
  const expectedDist = expectedCutCornerDistFromSeam(seam, seamIndex, expectedSaMm)
  const minDist = Math.max(MIN_CHAMFER_MM, expectedDist * 0.48)
  const maxDist = Math.min(maxPairDist, expectedDist * 1.55)
  const minEdgeAtCorner = MIN_CHAMFER_MM
  let best: { index: number; dist: number; C: Point; saErr: number; angle: number; minEdge: number } | null =
    null
  for (let i = 0; i < cut.length; i++) {
    // Kein softCut-Skip: Fehlmapping Mutter-Soft → Cut-Ecke würde sonst Miter-Ecken
    // überspringen. Tessellationspunkte scheitern am Innenwinkel-Filter (~180°).
    const C = vertexAt(cut, i)
    const d = Math.hypot(C.x - S.x, C.y - S.y)
    if (d < minDist || d > maxDist) continue
    const interiorDeg = interiorAngleAtVertexDegrees(cut, i)
    if (interiorDeg == null || interiorDeg > MAX_INTERIOR_DEG_FOR_CHAMFER) continue
    const { min: minEdge } = adjacentEdgeLensAt(cut, i)
    if (minEdge < minEdgeAtCorner) continue
    const saErr = Math.abs(d - expectedDist)
    // Bei gleichem Abstand: schärfere / weiter außen liegende Ecke (echte Miter-Spitze)
    // vor kurzen Tessellations-Knicken bevorzugen.
    if (
      !best ||
      saErr < best.saErr - 0.4 ||
      (Math.abs(saErr - best.saErr) <= 0.4 && d > best.dist + 0.15) ||
      (Math.abs(saErr - best.saErr) <= 0.4 &&
        Math.abs(d - best.dist) <= 0.15 &&
        minEdge > best.minEdge + 0.01) ||
      (Math.abs(saErr - best.saErr) <= 0.4 &&
        Math.abs(d - best.dist) <= 0.15 &&
        Math.abs(minEdge - best.minEdge) <= 0.01 &&
        interiorDeg < best.angle)
    ) {
      best = { index: i, dist: d, C, saErr, angle: interiorDeg, minEdge }
    }
  }
  return best ? { index: best.index, dist: best.dist, C: best.C } : null
}

function seamAllowanceAtVertex(piece: PatternPiece, seamIndex: number, seamLen: number): number {
  const base = piece.seamAllowanceMm ?? 0
  const edges = piece.edgeSeamAllowances
  if (!edges?.length || seamLen < 1) return base
  const prevEdge = (seamIndex - 1 + seamLen) % seamLen
  let max = base
  for (const ei of [prevEdge, seamIndex]) {
    const e = edges.find((x) => x.edgeIndex === ei)
    if (e && Number.isFinite(e.allowanceMm)) max = Math.max(max, e.allowanceMm)
  }
  return max
}

function maxSeamAllowanceMm(piece: PatternPiece): number {
  let max = piece.seamAllowanceMm ?? 0
  for (const e of piece.edgeSeamAllowances ?? []) {
    if (typeof e.allowanceMm === 'number' && Number.isFinite(e.allowanceMm)) {
      max = Math.max(max, e.allowanceMm)
    }
  }
  return max
}

/** Geschlossene Kontur → Punktring (Start jedes Segments). Bézier werden grob abgetastet. */
function curvesToRing(curves: Curve[]): Point[] {
  const ring: Point[] = []
  for (const c of curves) {
    if (c.type === 'line') {
      ring.push({ ...c.start })
    } else {
      const steps = 12
      for (let i = 0; i < steps; i++) {
        const t = i / steps
        ring.push(bezierAt(c, t))
      }
    }
  }
  return ring
}

function ringToLineCurves(ring: Point[]): Curve[] {
  if (ring.length < 3) return []
  const out: Curve[] = []
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-9) continue
    out.push({ type: 'line', start: { ...a }, end: { ...b } })
  }
  return out.length >= 3 ? out : []
}

/** Schnitt Gerade (P−S)·n = 0 mit Segment a→b; t in [0,1] oder null. */
function hitPlaneOnSegment(a: Point, b: Point, S: Point, nVec: Point): { point: Point; t: number } | null {
  const ab = sub(b, a)
  const denom = dot(ab, nVec)
  if (Math.abs(denom) < 1e-12) return null
  const t = dot(sub(S, a), nVec) / denom
  if (t < -1e-6 || t > 1 + 1e-6) return null
  const tc = Math.max(0, Math.min(1, t))
  return { point: add(a, scale(ab, tc)), t: tc }
}

/**
 * Kantenlänge ab Ecke — kurze Tessellations-Stücke an der Miter-Spitze mitzählen,
 * bis genug Länge für eine sinnvolle Fase da ist (nicht nach 1 mm abbrechen).
 */
function edgeLenFromCorner(ring: Point[], cornerIdx: number, direction: -1 | 1): number {
  const n = ring.length
  let total = 0
  let i = cornerIdx
  for (let step = 0; step < 64; step++) {
    const nextI = (i + direction + n) % n
    if (nextI === cornerIdx && step > 0) break
    total += dist(ring[i]!, ring[nextI]!)
    i = nextI
    // Genug für typische NZ-Fasen; darüber wäre es schon die Nachbarkante.
    if (total >= 100) break
  }
  return total
}

function maxTrimForEdge(edgeLen: number): number {
  if (edgeLen < MIN_CHAMFER_MM * 2) return 0
  const minFlat = Math.min(Math.max(MIN_EDGE_FLAT_MM, edgeLen * MIN_EDGE_FLAT_FRAC), edgeLen * 0.5)
  const byFlat = Math.max(0, (edgeLen - minFlat) / 2)
  return Math.min(edgeLen * MAX_EDGE_TRIM_FRAC, byFlat)
}

/**
 * Von der Cut-Ecke entlang des Rings wandern: Trim-Maß bis Ebene durch Naht-Ecke S
 * (über mehrere Tessellations-Segmente), begrenzt auf maxTrimMm.
 */
function planeTrimMmWalking(
  ring: Point[],
  cornerIdx: number,
  direction: -1 | 1,
  S: Point,
  nVec: Point,
  maxTrimMm: number,
): number | null {
  const n = ring.length
  if (maxTrimMm < MIN_CHAMFER_MM) return null
  let walked = 0
  let i = cornerIdx
  for (let step = 0; step < n - 1; step++) {
    const nextI = (i + direction + n) % n
    const a = ring[i]!
    const b = ring[nextI]!
    const segLen = dist(a, b)
    if (segLen < 1e-12) {
      i = nextI
      continue
    }
    const hit = hitPlaneOnSegment(a, b, S, nVec)
    if (hit) {
      const trim = walked + dist(a, hit.point)
      if (trim < MIN_CHAMFER_MM * 0.5) {
        // Zu nah an C — weiterlaufen (Ebene nochmal auf nächstem Segment)
        walked += segLen
        i = nextI
        if (walked >= maxTrimMm) return maxTrimMm
        continue
      }
      return Math.min(Math.max(trim, MIN_CHAMFER_MM), maxTrimMm)
    }
    walked += segLen
    if (walked >= maxTrimMm) return maxTrimMm
    i = nextI
  }
  return walked >= MIN_CHAMFER_MM ? Math.min(walked, maxTrimMm) : null
}

/** Punkt auf dem Ring in Bogenlänge `trimMm` von cornerIdx in direction. */
function pointAtTrimFromCorner(
  ring: Point[],
  cornerIdx: number,
  direction: -1 | 1,
  trimMm: number,
): Point | null {
  const n = ring.length
  let walked = 0
  let i = cornerIdx
  for (let step = 0; step < n - 1; step++) {
    const nextI = (i + direction + n) % n
    const a = ring[i]!
    const b = ring[nextI]!
    const segLen = dist(a, b)
    if (segLen < 1e-12) {
      i = nextI
      continue
    }
    if (walked + segLen >= trimMm - 1e-12) {
      const t = (trimMm - walked) / segLen
      return add(a, scale(sub(b, a), Math.max(0, Math.min(1, t))))
    }
    walked += segLen
    i = nextI
  }
  return null
}

/** Ring-Indizes zwischen Ecke und Trim-Punkt (exkl. Ecke, exkl. Segment-Ende hinter dem Hit). */
function intermediateIndicesAlongTrim(
  ring: Point[],
  cornerIdx: number,
  direction: -1 | 1,
  trimMm: number,
): number[] {
  const n = ring.length
  const out: number[] = []
  let walked = 0
  let i = cornerIdx
  for (let step = 0; step < n - 2; step++) {
    const nextI = (i + direction + n) % n
    const segLen = dist(ring[i]!, ring[nextI]!)
    if (walked + segLen >= trimMm - 1e-9) break
    walked += segLen
    out.push(nextI)
    i = nextI
  }
  return out
}

/**
 * Lokale Fase an Ring-Ecke `cornerIdx`: Spitze bis zur Ebene durch Naht-Ecke S absägen.
 * Läuft über Tessellations-Segmente — sonst bleibt die Miter-Spitze stehen.
 */
function localChamferRingCorner(ring: Point[], cornerIdx: number, S: Point): Point[] | null {
  const n = ring.length
  if (n < 3 || cornerIdx < 0 || cornerIdx >= n) return null
  const C = ring[cornerIdx]!
  const nVec = sub(C, S)
  if (Math.hypot(nVec.x, nVec.y) < MIN_CHAMFER_MM) return null

  const maxPrev = maxTrimForEdge(edgeLenFromCorner(ring, cornerIdx, -1))
  const maxNext = maxTrimForEdge(edgeLenFromCorner(ring, cornerIdx, 1))
  if (maxPrev < MIN_CHAMFER_MM || maxNext < MIN_CHAMFER_MM) return null

  let trimPrev = planeTrimMmWalking(ring, cornerIdx, -1, S, nVec, maxPrev)
  let trimNext = planeTrimMmWalking(ring, cornerIdx, 1, S, nVec, maxNext)
  if (trimPrev == null || trimNext == null) return null

  // Winkel halten: wenn eine Seite stärker geklemmt wurde, die andere proportional.
  const rawPrev = planeTrimMmWalking(ring, cornerIdx, -1, S, nVec, 1e9) ?? trimPrev
  const rawNext = planeTrimMmWalking(ring, cornerIdx, 1, S, nVec, 1e9) ?? trimNext
  if (rawPrev > 1e-9 && rawNext > 1e-9) {
    const sPrev = trimPrev / rawPrev
    const sNext = trimNext / rawNext
    const s = Math.min(sPrev, sNext, 1)
    trimPrev = Math.max(MIN_CHAMFER_MM, Math.min(maxPrev, rawPrev * s))
    trimNext = Math.max(MIN_CHAMFER_MM, Math.min(maxNext, rawNext * s))
  }

  const tPrev = pointAtTrimFromCorner(ring, cornerIdx, -1, trimPrev)
  const tNext = pointAtTrimFromCorner(ring, cornerIdx, 1, trimNext)
  if (!tPrev || !tNext) return null
  if (dist(tPrev, tNext) < MIN_CHAMFER_MM) return null

  const remove = new Set<number>([
    cornerIdx,
    ...intermediateIndicesAlongTrim(ring, cornerIdx, -1, trimPrev),
    ...intermediateIndicesAlongTrim(ring, cornerIdx, 1, trimNext),
  ])

  // Fase einfügen, wenn der Remove-Block beginnt (Prev-Seite kann vor der Ecke liegen).
  const out: Point[] = []
  let inserted = false
  for (let i = 0; i < n; i++) {
    if (remove.has(i)) {
      if (!inserted) {
        out.push({ ...tPrev }, { ...tNext })
        inserted = true
      }
      continue
    }
    out.push({ ...ring[i]! })
  }
  if (!inserted || out.length < 3) return null
  return out
}

/**
 * Schneidet scharfe Ecken der **Schnittkontur** in der Nahtzugabe ab (lokale Fase).
 * Treiber: Naht-Ecken → passende scharfe Cut-Ecke. Kantenmitte behält parallele NZ.
 */
export function chamferCutLineCornersInSeamAllowance(piece: PatternPiece): Curve[] {
  const cut = piece.cutLine
  if (cut.length < 3) return cloneCurves(cut)

  const softMaster = new Set(piece.softVerticesMaster ?? [])
  const saDefault = piece.seamAllowanceMm ?? 0
  const maxSa = maxSeamAllowanceMm(piece)
  if (saDefault <= 0 && maxSa <= 0) {
    return cloneCurves(cut)
  }

  const seam = piece.seamLine.length >= 3 ? piece.seamLine : null
  if (!seam) return cloneCurves(cut)

  const maxPairDist = Math.max(maxSa, saDefault, 1) * 2.5 + 1

  type Corner = { C: Point; S: Point }
  const corners: Corner[] = []

  // Ring 1:1 zu Line-Cut-Vertices (Clipper); Bézier-Cuts werden abgetastet — Index-Match nur bei Lines.
  const ring0 = curvesToRing(cut)
  const useVertexIndexAsRing = cut.every((c) => c.type === 'line') && ring0.length === cut.length

  for (let si = 0; si < seam.length; si++) {
    // Nur explizit weiche Naht-Ecken überspringen (nicht Cut-Soft-Mapping)
    if (softMaster.has(si)) {
      const deg = interiorAngleAtVertexDegrees(seam, si)
      // Weicher Punkt auf gerader Kante (~180°) ohnehin kein Chamfer-Kandidat
      if (deg == null || deg > MAX_INTERIOR_DEG_FOR_CHAMFER) continue
      // Weiche scharfe Ecke: bewusst keine Fase
      continue
    }
    const interiorDeg = interiorAngleAtVertexDegrees(seam, si)
    if (interiorDeg == null || interiorDeg > MAX_INTERIOR_DEG_FOR_CHAMFER) continue

    const S = vertexAt(seam, si)
    const saAtCorner = seamAllowanceAtVertex(piece, si, seam.length)
    const corner = bestSharpCutCornerForSeamVertex(cut, S, seam, si, maxPairDist, saAtCorner)
    if (!corner) continue

    if (!useVertexIndexAsRing) {
      let bestD = Infinity
      for (let i = 0; i < ring0.length; i++) {
        const d = dist(ring0[i]!, corner.C)
        if (d < bestD) bestD = d
      }
      if (bestD > maxPairDist) continue
    }

    if (corners.some((c) => dist(c.C, corner.C) < 0.25)) continue
    corners.push({ C: { ...corner.C }, S: { ...S } })
  }

  if (corners.length === 0) return cloneCurves(cut)

  let ring = ring0.map((p) => ({ ...p }))
  let applied = 0
  // Hohe Distanz zu S zuerst (äußere Spitzen); nach jeder Fase C im Ring neu suchen.
  corners.sort((a, b) => dist(b.C, b.S) - dist(a.C, a.S))
  for (const c of corners) {
    let ringIndex = -1
    let bestD = Infinity
    for (let i = 0; i < ring.length; i++) {
      const d = dist(ring[i]!, c.C)
      if (d < bestD) {
        bestD = d
        ringIndex = i
      }
    }
    if (ringIndex < 0 || bestD > 1.5) continue

    const nextRing = localChamferRingCorner(ring, ringIndex, c.S)
    if (!nextRing) continue
    ring = nextRing
    applied++
  }

  if (applied === 0) return cloneCurves(cut)

  const cleaned: Point[] = []
  for (const p of ring) {
    const prev = cleaned[cleaned.length - 1]
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) >= 1e-4) cleaned.push(p)
  }
  if (
    cleaned.length >= 2 &&
    Math.hypot(cleaned[0].x - cleaned[cleaned.length - 1].x, cleaned[0].y - cleaned[cleaned.length - 1].y) <
      1e-4
  ) {
    cleaned.pop()
  }

  const out = ringToLineCurves(cleaned)
  if (out.length < 3) return cloneCurves(cut)

  const seamArea = Math.abs(signedAreaCurves(seam))
  const outArea = Math.abs(signedAreaCurves(out))
  if (seamArea >= 1 && outArea < seamArea * 1.02) {
    return cloneCurves(cut)
  }

  return out
}
