import type { Curve, Drill, InternalCircle, Notch, PatternPiece, Point, RoundedCorner } from '../types/model'
import { splitBezierAt, bezierAt } from './curveToPath'
import { nearestCurveIndexAndPoint } from './nearestOnCurve'
import { curvesToPolygon, isPointInClosedCurves, isPointInPolygon } from './pointInPolygon'
import { deriveCutLineForPiece } from './deriveCutLineForPiece'
import { getSharpMasterCurves, useSeamLineForVertexEditing } from './vertexMaster'
import { materializeNotchAnchorsOnCutLine } from './notchOnCurve'
import { isNotchOnInternalLine, materializeNotchAnchorsOnInternalLine } from './notchOnInternalLine'
import { withDefaultGrainLine } from './grainArrowLayout'

/** Klick auf die Master-Kontur: Kurvenindex, Parameter, Punkt. */
export type FaechernHit = {
  curveIndex: number
  t: number
  point: Point
}

/** Werkzeugzustand: zuerst Drehpunkt, dann die liegende Öffnung, dann die Seite die zudreht. */
export type FaechernState = {
  pieceId: string
  pivot: FaechernHit | null
  openingA: FaechernHit | null
}

const END_T = 1e-3
const MIN_SEPARATION_MM = 1.5
const MIN_ANGLE_RAD = (0.4 * Math.PI) / 180
const JOIN_MM = 0.2

export function faechernHitFromLocal(curves: Curve[], local: Point, maxDistMm: number): FaechernHit | null {
  const hit = nearestCurveIndexAndPoint(local, curves)
  if (!hit || hit.distance > maxDistMm) return null
  const t = hit.t ?? 0
  return { curveIndex: hit.curveIndex, t, point: { ...hit.point } }
}

function cloneCurve(c: Curve): Curve {
  if (c.type === 'line') return { type: 'line', start: { ...c.start }, end: { ...c.end } }
  return {
    type: 'bezier',
    start: { ...c.start },
    end: { ...c.end },
    cp1: { ...c.cp1 },
    cp2: { ...c.cp2 },
  }
}

function reverseCurve(c: Curve): Curve {
  if (c.type === 'line') return { type: 'line', start: { ...c.end }, end: { ...c.start } }
  return { type: 'bezier', start: { ...c.end }, end: { ...c.start }, cp1: { ...c.cp2 }, cp2: { ...c.cp1 } }
}

function reverseClosed(curves: Curve[]): Curve[] {
  return curves.map(reverseCurve).reverse()
}

function splitCurveAt(c: Curve, t: number): [Curve, Curve] {
  const tt = Math.min(1 - 1e-6, Math.max(1e-6, t))
  if (c.type === 'line') {
    const p = {
      x: c.start.x + (c.end.x - c.start.x) * tt,
      y: c.start.y + (c.end.y - c.start.y) * tt,
    }
    return [
      { type: 'line', start: { ...c.start }, end: p },
      { type: 'line', start: { ...p }, end: { ...c.end } },
    ]
  }
  return splitBezierAt(c, tt)
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function rotatePoint(p: Point, pivot: Point, ang: number): Point {
  const dx = p.x - pivot.x
  const dy = p.y - pivot.y
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  return { x: pivot.x + dx * c - dy * s, y: pivot.y + dx * s + dy * c }
}

function rotateCurve(c: Curve, pivot: Point, ang: number): Curve {
  const r = (p: Point) => rotatePoint(p, pivot, ang)
  if (c.type === 'line') return { type: 'line', start: r(c.start), end: r(c.end) }
  return { type: 'bezier', start: r(c.start), end: r(c.end), cp1: r(c.cp1), cp2: r(c.cp2) }
}

function pointAt(c: Curve, t: number): Point {
  if (c.type === 'line') return lerp(c.start, c.end, t)
  return bezierAt(c, t)
}

function signedArea(pts: Point[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

function polygonAreaAbs(pts: Point[]): number {
  return Math.abs(signedArea(pts))
}

/** Positive Drehung in derselben Richtung wie atan2 (y nach unten = Bildschirm). */
function sweepContaining(from: number, to: number, via: number): number {
  const tau = Math.PI * 2
  const norm = (d: number) => {
    let x = d % tau
    if (x < 0) x += tau
    return x
  }
  const dPos = norm(to - from)
  const viaPos = norm(via - from)
  if (viaPos <= dPos + 1e-6) return dPos
  return dPos - tau
}

type SplitHit = FaechernHit & { id: number }

function splitContourAtHits(
  curves: Curve[],
  hits: SplitHit[],
): { curves: Curve[]; vertexOf: number[] } | null {
  const n = curves.length
  if (n < 3) return null
  const byCurve = new Map<number, SplitHit[]>()
  for (const h of hits) {
    if (h.curveIndex < 0 || h.curveIndex >= n) return null
    const list = byCurve.get(h.curveIndex) ?? []
    list.push(h)
    byCurve.set(h.curveIndex, list)
  }
  const out: Curve[] = []
  const originStart: number[] = []
  const vertexOf = hits.map(() => -1)
  const pendingEnd: { id: number; next: number }[] = []

  for (let i = 0; i < n; i++) {
    originStart[i] = out.length
    const list = (byCurve.get(i) ?? []).slice().sort((a, b) => a.t - b.t)
    let seg: Curve = cloneCurve(curves[i])
    let t0 = 0
    for (const h of list) {
      if (h.t <= END_T) {
        vertexOf[h.id] = originStart[i]
        continue
      }
      if (h.t >= 1 - END_T) {
        pendingEnd.push({ id: h.id, next: (i + 1) % n })
        continue
      }
      const localT = (h.t - t0) / (1 - t0)
      if (!(localT > 1e-4 && localT < 1 - 1e-4)) {
        if (localT <= 1e-4) vertexOf[h.id] = out.length
        else pendingEnd.push({ id: h.id, next: (i + 1) % n })
        continue
      }
      const [left, right] = splitCurveAt(seg, localT)
      out.push(left)
      vertexOf[h.id] = out.length
      seg = right
      t0 = h.t
    }
    out.push(seg)
  }
  for (const p of pendingEnd) vertexOf[p.id] = originStart[p.next] ?? 0
  if (vertexOf.some((v) => v < 0)) return null
  return { curves: out, vertexOf }
}

function forwardVertices(from: number, to: number, n: number): number[] {
  const path = [from]
  let i = from
  for (let guard = 0; guard < n + 1; guard++) {
    if (i === to) return path
    i = (i + 1) % n
    path.push(i)
  }
  return path
}

function curvesAlong(path: number[], curves: Curve[]): Curve[] | null {
  const n = curves.length
  const out: Curve[] = []
  for (let j = 0; j < path.length - 1; j++) {
    const a = path[j]
    const b = path[j + 1]
    if ((a + 1) % n === b) out.push(cloneCurve(curves[a]))
    else if ((b + 1) % n === a) out.push(reverseCurve(curves[b]))
    else return null
  }
  return out
}

function sampleCurve(c: Curve, steps: number): Point[] {
  const pts: Point[] = []
  const n = c.type === 'line' ? 1 : steps
  for (let i = 0; i <= n; i++) pts.push(pointAt(c, i / n))
  return pts
}

function samplesOf(curves: Curve[]): Point[] {
  const pts: Point[] = []
  for (const c of curves) {
    const s = sampleCurve(c, 6)
    if (pts.length > 0) s.shift()
    pts.push(...s)
  }
  return pts
}

function chainMidpoint(curves: Curve[]): Point {
  if (curves.length === 0) return { x: 0, y: 0 }
  const mid = curves[Math.floor((curves.length - 1) / 2)]
  return pointAt(mid, 0.5)
}

export type FaechernPlan = {
  pivot: Point
  openingA: Point
  openingB: Point
  wedge: Point[]
  angleRad: number
  fixedCurves: Curve[]
  movingCurves: Curve[]
  movingPolygon: Point[]
}

export function planFaechern(
  curves: Curve[],
  pivotHit: FaechernHit,
  openingAHit: FaechernHit,
  openingBHit: FaechernHit,
): { ok: true; plan: FaechernPlan } | { ok: false; message: string } {
  if (curves.length < 3) return { ok: false, message: 'Die Kontur ist zu kurz.' }
  const hits: SplitHit[] = [
    { ...pivotHit, id: 0 },
    { ...openingAHit, id: 1 },
    { ...openingBHit, id: 2 },
  ]
  const split = splitContourAtHits(curves, hits)
  if (!split) return { ok: false, message: 'Die Punkte liegen nicht auf der Kontur.' }
  const [iP, iA, iB] = split.vertexOf
  if (iP === iA || iP === iB || iA === iB) {
    return { ok: false, message: 'Drehpunkt und die beiden Öffnungen müssen drei verschiedene Punkte sein.' }
  }
  const sp = split.curves
  const n = sp.length
  const pPt = { ...sp[iP].start }
  const aPt = { ...sp[iA].start }
  const bPt = { ...sp[iB].start }
  if (dist(pPt, aPt) < MIN_SEPARATION_MM || dist(pPt, bPt) < MIN_SEPARATION_MM || dist(aPt, bPt) < MIN_SEPARATION_MM) {
    return { ok: false, message: 'Die Punkte liegen zu nah beieinander.' }
  }

  const aToB = forwardVertices(iA, iB, n)
  const body = aToB.includes(iP) ? aToB : forwardVertices(iB, iA, n).reverse()
  const pAt = body.indexOf(iP)
  if (pAt <= 0 || pAt >= body.length - 1) {
    return { ok: false, message: 'Der Drehpunkt muss zwischen den beiden Öffnungen auf der Kontur liegen.' }
  }
  const mouthPath = aToB.includes(iP) ? forwardVertices(iB, iA, n).reverse() : aToB
  const fixedPath = body.slice(0, pAt + 1)
  const movingPath = body.slice(pAt)
  const fixedCurves = curvesAlong(fixedPath, sp)
  const movingCurves = curvesAlong(movingPath, sp)
  const mouthCurves = curvesAlong(mouthPath, sp)
  if (!fixedCurves || !movingCurves || !mouthCurves || fixedCurves.length === 0 || movingCurves.length === 0) {
    return { ok: false, message: 'Die Linien teilen die Kontur nicht.' }
  }

  const mouthMid = chainMidpoint(mouthCurves)
  const aAng = Math.atan2(aPt.y - pPt.y, aPt.x - pPt.x)
  const bAng = Math.atan2(bPt.y - pPt.y, bPt.x - pPt.x)
  const mAng = Math.atan2(mouthMid.y - pPt.y, mouthMid.x - pPt.x)
  const angleRad = sweepContaining(bAng, aAng, mAng)
  if (!Number.isFinite(angleRad) || Math.abs(angleRad) < MIN_ANGLE_RAD) {
    return { ok: false, message: 'Die beiden Linien liegen schon übereinander.' }
  }
  if (Math.abs(angleRad) > Math.PI * 0.97) {
    return { ok: false, message: 'Der Bereich zwischen den Linien ist zu weit. Die Öffnung enger setzen.' }
  }

  const mouthSamples = samplesOf(mouthCurves)
  const wedge = [pPt, ...mouthSamples]
  const pieceArea = polygonAreaAbs(curvesToPolygon(curves))
  const wedgeArea = polygonAreaAbs(wedge)
  if (!(wedgeArea > 0.5)) return { ok: false, message: 'Zwischen den Linien liegt kein Bereich.' }
  if (pieceArea > 1 && wedgeArea > pieceArea * 0.45) {
    return {
      ok: false,
      message:
        'Der markierte Bereich ist zu groß. Der Drehpunkt ist der Punkt, an dem die Linien zusammenlaufen.',
    }
  }
  const probe = lerp(pPt, mouthMid, 0.4)
  const probeChord = lerp(pPt, lerp(aPt, bPt, 0.5), 0.4)
  if (!isPointInClosedCurves(probe, curves) && !isPointInClosedCurves(probeChord, curves)) {
    return { ok: false, message: 'Die Linien schließen keinen Bereich im Teil ein.' }
  }

  const movingSamples = samplesOf(movingCurves)
  return {
    ok: true,
    plan: {
      pivot: pPt,
      openingA: aPt,
      openingB: bPt,
      wedge,
      angleRad,
      fixedCurves,
      movingCurves,
      movingPolygon: movingSamples,
    },
  }
}

function distToSegments(p: Point, pts: Point[]): number {
  let best = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const abx = b.x - a.x
    const aby = b.y - a.y
    const lenSq = abx * abx + aby * aby
    let t = 0
    if (lenSq > 1e-12) t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq))
    const qx = a.x + abx * t
    const qy = a.y + aby * t
    best = Math.min(best, Math.hypot(p.x - qx, p.y - qy))
  }
  return best
}

type Region = 'keep' | 'move' | 'drop'

function classifyPoint(p: Point, plan: FaechernPlan, nearMm: number): Region {
  if (dist(p, plan.pivot) <= nearMm) return 'keep'
  const rayA = [plan.pivot, plan.openingA]
  const rayB = [plan.pivot, plan.openingB]
  const dA = distToSegments(p, rayA)
  const dB = distToSegments(p, rayB)
  if (dA <= nearMm && dA <= dB) return 'keep'
  if (dB <= nearMm) return 'move'
  if (isPointInPolygon(p, plan.wedge) || distToSegments(p, plan.wedge) <= nearMm) return 'drop'
  if (isPointInPolygon(p, plan.movingPolygon) || distToSegments(p, plan.movingPolygon) <= nearMm) return 'move'
  return 'keep'
}

function mapPoint(p: Point, plan: FaechernPlan, nearMm: number): Point | null {
  const region = classifyPoint(p, plan, nearMm)
  if (region === 'drop') return null
  if (region === 'move') return rotatePoint(p, plan.pivot, plan.angleRad)
  return { ...p }
}

function closeContour(fixed: Curve[], moving: Curve[], a: Point): Curve[] {
  const curves = [...fixed.map(cloneCurve), ...moving.map(cloneCurve)]
  const end = curves[curves.length - 1].end
  if (dist(end, a) <= JOIN_MM) {
    const last = curves[curves.length - 1]
    if (last.type === 'line') last.end = { ...a }
    else last.end = { ...a }
    return curves
  }
  curves.push({ type: 'line', start: { ...end }, end: { ...a } })
  return curves
}

function segmentsProperlyIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const o1 = o(a, b, c)
  const o2 = o(a, b, d)
  const o3 = o(c, d, a)
  const o4 = o(c, d, b)
  const eps = 1e-6
  if (Math.abs(o1) < eps || Math.abs(o2) < eps || Math.abs(o3) < eps || Math.abs(o4) < eps) return false
  return o1 > 0 !== o2 > 0 && o3 > 0 !== o4 > 0
}

function contourCrossesItself(curves: Curve[]): boolean {
  const pts = samplesOf(curves)
  if (pts.length > 1 && dist(pts[0], pts[pts.length - 1]) < 0.05) pts.pop()
  const n = pts.length
  if (n < 4) return false
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue
      if (Math.abs(i - j) <= 1) continue
      const c = pts[j]
      const d = pts[(j + 1) % n]
      if (segmentsProperlyIntersect(a, b, c, d)) return true
    }
  }
  return false
}

function matchVertex(curves: Curve[], p: Point, maxMm: number): number | null {
  let best = -1
  let bestD = maxMm
  for (let i = 0; i < curves.length; i++) {
    const d = dist(curves[i].start, p)
    if (d <= bestD) {
      bestD = d
      best = i
    }
  }
  return best >= 0 ? best : null
}

function remapIndices(
  oldCurves: Curve[],
  indices: number[] | undefined,
  newCurves: Curve[],
  plan: FaechernPlan,
  nearMm: number,
): number[] {
  const out: number[] = []
  for (const vi of indices ?? []) {
    if (vi < 0 || vi >= oldCurves.length) continue
    const mapped = mapPoint(oldCurves[vi].start, plan, nearMm)
    if (!mapped) continue
    const ni = matchVertex(newCurves, mapped, 0.8)
    if (ni != null) out.push(ni)
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

function remapRounded(
  oldCurves: Curve[],
  corners: RoundedCorner[] | undefined,
  newCurves: Curve[],
  plan: FaechernPlan,
  nearMm: number,
): RoundedCorner[] | undefined {
  if (!corners || corners.length === 0) return undefined
  const out: RoundedCorner[] = []
  for (const c of corners) {
    if (c.masterVertexIndex < 0 || c.masterVertexIndex >= oldCurves.length) continue
    const mapped = mapPoint(oldCurves[c.masterVertexIndex].start, plan, nearMm)
    if (!mapped) continue
    const ni = matchVertex(newCurves, mapped, 0.8)
    if (ni == null) continue
    out.push({ ...c, masterVertexIndex: ni })
  }
  return out.length > 0 ? out : undefined
}

/**
 * Entfernt den Bereich zwischen Drehpunkt und zwei Öffnungspunkten
 * und dreht die zweite Öffnung auf die erste, sodass die Kontur wieder geschlossen ist.
 * Die zuerst gewählte Öffnung bleibt liegen.
 */
export function applyFaechernToPiece(
  piece: PatternPiece,
  pivotHit: FaechernHit,
  openingAHit: FaechernHit,
  openingBHit: FaechernHit,
): { ok: true; piece: PatternPiece } | { ok: false; message: string } {
  const master = getSharpMasterCurves(piece)
  const planned = planFaechern(master, pivotHit, openingAHit, openingBHit)
  if (!planned.ok) return planned
  const plan = planned.plan
  const seamMaster = useSeamLineForVertexEditing(piece)
  const nearMm = Math.max(1.2, (piece.seamAllowanceMm ?? 0) * 0.35)

  const rotatedMoving = plan.movingCurves.map((c) => rotateCurve(c, plan.pivot, plan.angleRad))
  let nextMaster = closeContour(plan.fixedCurves, rotatedMoving, plan.openingA)
  const oldSign = Math.sign(signedArea(curvesToPolygon(master)))
  const newSign = Math.sign(signedArea(curvesToPolygon(nextMaster)))
  if (oldSign !== 0 && newSign !== 0 && oldSign !== newSign) nextMaster = reverseClosed(nextMaster)
  if (nextMaster.length < 3) return { ok: false, message: 'Die neue Kontur ist zu kurz.' }
  if (contourCrossesItself(nextMaster)) {
    return { ok: false, message: 'Die Öffnung lässt sich so nicht schließen, ohne dass sich die Kontur überschneidet.' }
  }

  const rounded = remapRounded(master, piece.roundedCorners, nextMaster, plan, nearMm)
  const draft: PatternPiece = {
    ...piece,
    edgeSeamAllowances: undefined,
    roundedCorners: rounded,
    symmetryConstraint: undefined,
    internalLineSoftJunctions: undefined,
    cutLineDeviatesFromSeamAllowanceOffset: false,
  }

  let cutLine: Curve[]
  let seamLine: Curve[]
  if (seamMaster) {
    const derived = deriveCutLineForPiece({ ...draft, seamLine: nextMaster }, nextMaster, piece.seamAllowanceMm!)
    if (!derived.ok) return { ok: false, message: derived.message }
    seamLine = nextMaster
    cutLine = derived.cutLine
  } else {
    cutLine = nextMaster
    seamLine = piece.seamLine.length >= 3 ? [] : piece.seamLine
  }

  const snapLimit = Math.max(8, (piece.seamAllowanceMm ?? 0) + 4)
  const notches: Notch[] = []
  for (const n of piece.notches) {
    if (isNotchOnInternalLine(n)) continue
    const mapped = mapPoint(n.position, plan, nearMm)
    if (!mapped) continue
    const near = nearestCurveIndexAndPoint(mapped, cutLine)
    if (!near || near.distance > snapLimit) continue
    const mat = materializeNotchAnchorsOnCutLine({ ...n, position: mapped, vertexIndex: undefined }, cutLine)
    if (mat) notches.push(mat)
  }

  const internalKept: { curve: Curve; oldIndex: number }[] = []
  piece.internalLines.forEach((c, oldIndex) => {
    const mid = pointAt(c, 0.5)
    const region = classifyPoint(mid, plan, nearMm)
    if (region === 'drop') return
    internalKept.push({
      curve: region === 'move' ? rotateCurve(c, plan.pivot, plan.angleRad) : cloneCurve(c),
      oldIndex,
    })
  })
  const internalLines = internalKept.map((k) => k.curve)
  const internalIndex = new Map(internalKept.map((k, i) => [k.oldIndex, i]))

  for (const n of piece.notches) {
    if (!isNotchOnInternalLine(n)) continue
    const oldIdx = n.internalLineIndex
    if (oldIdx == null || !internalIndex.has(oldIdx)) continue
    const mapped = mapPoint(n.position, plan, nearMm)
    if (!mapped) continue
    const newIdx = internalIndex.get(oldIdx)!
    const mat = materializeNotchAnchorsOnInternalLine(
      {
        ...n,
        position: mapped,
        internalLineIndex: newIdx,
        internalSNormalized: undefined,
        internalArcLengthMm: undefined,
      },
      internalLines,
    )
    if (mat) notches.push(mat)
  }

  const mapCircle = (c: InternalCircle): InternalCircle | null => {
    const center = mapPoint(c.center, plan, nearMm)
    if (!center) return null
    return { ...c, center }
  }
  const mapDrill = (d: Drill): Drill | null => {
    const center = mapPoint(d.center, plan, nearMm)
    if (!center) return null
    return { ...d, center }
  }

  let grainLine = piece.grainLine
  if (grainLine) {
    const mid = lerp(grainLine.start, grainLine.end, 0.5)
    const region = classifyPoint(mid, plan, nearMm)
    if (region === 'drop') grainLine = null
    else if (region === 'move') {
      grainLine = {
        start: rotatePoint(grainLine.start, plan.pivot, plan.angleRad),
        end: rotatePoint(grainLine.end, plan.pivot, plan.angleRad),
      }
    }
  }

  const softSource = seamMaster ? piece.softVerticesMaster : piece.softVertices
  const remappedSoft = remapIndices(master, softSource, nextMaster, plan, nearMm)

  const next: PatternPiece = {
    ...draft,
    seamLine,
    cutLine,
    notches,
    internalLines,
    internalCircles: piece.internalCircles.map(mapCircle).filter((c): c is InternalCircle => c != null),
    drills: piece.drills.map(mapDrill).filter((d): d is Drill => d != null),
    grainLine,
    softVertices: seamMaster ? [] : remappedSoft,
    softVerticesMaster: seamMaster ? remappedSoft : [],
  }
  return { ok: true, piece: withDefaultGrainLine(next) }
}
