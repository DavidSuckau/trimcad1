import type { BezierCurve, Curve, LineSegment, Point, RoundedCorner } from '../types/model'

/** Mindest-Radius (mm). */
export const ROUND_CORNER_MIN_RADIUS_MM = 0.5
/** Maximaler Radius (mm) – Sicherheitsobergrenze. */
export const ROUND_CORNER_MAX_RADIUS_MM = 10000
/** Minimaler Innenwinkel der Ecke, ab dem überhaupt gerundet wird (≈ 2°). */
const MIN_PHI_RAD = (2 * Math.PI) / 180
/** Maximaler Innenwinkel (≈ 178°) – darüber hinaus ist die Ecke „gerade", Rundung sinnlos. */
const MAX_PHI_RAD = (178 * Math.PI) / 180
/** Tangentenlänge darf maximal 49% der kürzeren Nachbarkante betragen, damit andere Eckpunkte nicht überschrieben werden. */
const MAX_TLEN_RATIO = 0.49

export type ValidateCornerRoundError =
  | 'INVALID_VERTEX'
  | 'NON_LINE_NEIGHBOR'
  | 'PHI_OUT_OF_RANGE'
  | 'RADIUS_TOO_SMALL'
  | 'RADIUS_TOO_LARGE'
  | 'DEGENERATE_EDGE'

export type ValidateCornerRoundResult =
  | { ok: true }
  | { ok: false; reason: ValidateCornerRoundError; maxRadiusMm?: number }

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

function len(a: Point): number {
  return Math.hypot(a.x, a.y)
}

function unit(a: Point): Point | null {
  const L = len(a)
  if (L < 1e-12) return null
  return { x: a.x / L, y: a.y / L }
}

function lineLen(seg: LineSegment): number {
  return Math.hypot(seg.end.x - seg.start.x, seg.end.y - seg.start.y)
}

function cloneCurve(c: Curve): Curve {
  if (c.type === 'line') {
    return { type: 'line', start: { ...c.start }, end: { ...c.end } }
  }
  return {
    type: 'bezier',
    start: { ...c.start },
    end: { ...c.end },
    cp1: { ...c.cp1 },
    cp2: { ...c.cp2 },
  }
}

/** Vertex-Position auf der geschlossenen Kontur. */
export function vertexPositionOnClosedMaster(curves: Curve[], vertexIndex: number): Point | null {
  const N = curves.length
  if (N === 0) return null
  const vi = ((vertexIndex % N) + N) % N
  return vi === 0 ? { ...curves[0].start } : { ...curves[vi - 1].end }
}

/**
 * Validiert, ob an `vertexIndex` der Master-Kontur ein Fillet mit Radius `radiusMm` möglich ist.
 * Erlaubt nur Linien-Linien-Ecken (Bezier-Nachbarn werden in v1 abgelehnt).
 */
export function validateCornerRound(
  master: Curve[],
  vertexIndex: number,
  radiusMm: number
): ValidateCornerRoundResult {
  const N = master.length
  if (N < 3) return { ok: false, reason: 'INVALID_VERTEX' }
  if (!Number.isFinite(vertexIndex) || vertexIndex < 0 || vertexIndex >= N) {
    return { ok: false, reason: 'INVALID_VERTEX' }
  }
  if (!Number.isFinite(radiusMm) || radiusMm < ROUND_CORNER_MIN_RADIUS_MM) {
    return { ok: false, reason: 'RADIUS_TOO_SMALL' }
  }
  const prevIdx = (vertexIndex + N - 1) % N
  const nextIdx = vertexIndex % N
  const prevCurve = master[prevIdx]
  const nextCurve = master[nextIdx]
  if (prevCurve.type !== 'line' || nextCurve.type !== 'line') {
    return { ok: false, reason: 'NON_LINE_NEIGHBOR' }
  }
  const A = prevCurve.start
  const V = prevCurve.end
  const B = nextCurve.end
  const inbound = unit(sub(V, A))
  const outbound = unit(sub(B, V))
  if (!inbound || !outbound) return { ok: false, reason: 'DEGENERATE_EDGE' }
  const cosPhi = dot(scale(inbound, -1), outbound)
  const phi = Math.acos(Math.max(-1, Math.min(1, cosPhi)))
  if (phi < MIN_PHI_RAD || phi > MAX_PHI_RAD) {
    return { ok: false, reason: 'PHI_OUT_OF_RANGE' }
  }
  const halfTan = Math.tan(phi / 2)
  if (halfTan < 1e-9) return { ok: false, reason: 'PHI_OUT_OF_RANGE' }
  const tLen = radiusMm / halfTan
  const prevLen = lineLen(prevCurve)
  const nextLen = lineLen(nextCurve)
  const maxTLen = MAX_TLEN_RATIO * Math.min(prevLen, nextLen)
  if (tLen > maxTLen) {
    const maxRadiusMm = maxTLen * halfTan
    return { ok: false, reason: 'RADIUS_TOO_LARGE', maxRadiusMm }
  }
  return { ok: true }
}

/** Maximaler zulässiger Radius für die Ecke (oder null, wenn nicht rundbar). */
export function maxFeasibleRadiusForCorner(master: Curve[], vertexIndex: number): number | null {
  const N = master.length
  if (N < 3) return null
  if (!Number.isFinite(vertexIndex) || vertexIndex < 0 || vertexIndex >= N) return null
  const prevIdx = (vertexIndex + N - 1) % N
  const nextIdx = vertexIndex % N
  const prevCurve = master[prevIdx]
  const nextCurve = master[nextIdx]
  if (prevCurve.type !== 'line' || nextCurve.type !== 'line') return null
  const A = prevCurve.start
  const V = prevCurve.end
  const B = nextCurve.end
  const inbound = unit(sub(V, A))
  const outbound = unit(sub(B, V))
  if (!inbound || !outbound) return null
  const cosPhi = dot(scale(inbound, -1), outbound)
  const phi = Math.acos(Math.max(-1, Math.min(1, cosPhi)))
  if (phi < MIN_PHI_RAD || phi > MAX_PHI_RAD) return null
  const halfTan = Math.tan(phi / 2)
  if (halfTan < 1e-9) return null
  const minEdge = Math.min(lineLen(prevCurve), lineLen(nextCurve))
  return MAX_TLEN_RATIO * minEdge * halfTan
}

/**
 * Approximiert den Kreisbogen vom Winkel `a1` zum Winkel `a2` (um Mittelpunkt O, Radius R) als
 * 1..n kubische Beziers, jeder ≤ 90°. Standard-Approximation: alpha = (4/3)·tan(dt/4)·R.
 */
function arcToBezierSegments(O: Point, R: number, a1: number, a2: number): BezierCurve[] {
  const sweep = a2 - a1
  if (Math.abs(sweep) < 1e-9) return []
  const QUARTER = Math.PI / 2 - 1e-6
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / QUARTER))
  const dt = sweep / n
  const alpha = (4 / 3) * Math.tan(dt / 4) * R
  const segments: BezierCurve[] = []
  for (let i = 0; i < n; i++) {
    const ang0 = a1 + i * dt
    const ang1 = a1 + (i + 1) * dt
    const c0 = Math.cos(ang0)
    const s0 = Math.sin(ang0)
    const c1 = Math.cos(ang1)
    const s1 = Math.sin(ang1)
    const p0: Point = { x: O.x + R * c0, y: O.y + R * s0 }
    const p1: Point = { x: O.x + R * c1, y: O.y + R * s1 }
    // Tangentenrichtung an p0 (CCW) = (-sin a, cos a). alpha trägt das Vorzeichen von dt mit.
    const cp1: Point = { x: p0.x - alpha * s0, y: p0.y + alpha * c0 }
    const cp2: Point = { x: p1.x + alpha * s1, y: p1.y - alpha * c1 }
    segments.push({ type: 'bezier', start: p0, end: p1, cp1, cp2 })
  }
  return segments
}

export type RoundCornerResult = {
  /** Neue Master-Kurven mit dem Eckpunkt durch trim+arc+trim ersetzt. */
  curves: Curve[]
  /** Curve-Indices der eingefügten Bogen-Segmente in `curves`. */
  arcCurveIndices: number[]
  /** Vertex-Index von T1 (Bogenanfang, an der Vorgänger-Kante) in `curves`. */
  t1VertexIndex: number
  /** Vertex-Index von T2 (Bogenende, an der Nachfolger-Kante) in `curves`. */
  t2VertexIndex: number
  /** Tatsächlich verwendeter Radius (mm). */
  radiusMm: number
  /** Anzahl der hinzugefügten Kurven (= arcCurveIndices.length). */
  addedCurves: number
  /**
   * Ursprung jedes Output-Curves im Eingangs-Master (Curve-Index), oder null für eingefügte Bögen.
   * Index-parallel zu `curves`.
   */
  originCurveIndices: (number | null)[]
  /** prevCurveIndex der Eingangs-Master (für Origin-Lookup im Caller). */
  prevCurveIndex: number
  /** nextCurveIndex der Eingangs-Master. */
  nextCurveIndex: number
}

/**
 * Rundet die rote Ecke an `vertexIndex` mit Radius `radiusMm`. Beide Nachbarsegmente müssen
 * Linien sein. Liefert null, wenn die Validierung fehlschlägt.
 */
export function roundCornerOnMaster(
  master: Curve[],
  vertexIndex: number,
  radiusMm: number
): RoundCornerResult | null {
  const validation = validateCornerRound(master, vertexIndex, radiusMm)
  if (!validation.ok) return null

  const N = master.length
  const prevIdx = (vertexIndex + N - 1) % N
  const nextIdx = vertexIndex % N
  const prevCurve = master[prevIdx] as LineSegment
  const nextCurve = master[nextIdx] as LineSegment
  const A = prevCurve.start
  const V = prevCurve.end
  const B = nextCurve.end
  const inbound = unit(sub(V, A))!
  const outbound = unit(sub(B, V))!
  const cosPhi = Math.max(-1, Math.min(1, dot(scale(inbound, -1), outbound)))
  const phi = Math.acos(cosPhi)
  const halfTan = Math.tan(phi / 2)
  const tLen = radiusMm / halfTan
  const T1: Point = sub(V, scale(inbound, tLen))
  const T2: Point = add(V, scale(outbound, tLen))

  // Mittelpunkt O des Bogens auf der Winkelhalbierenden im Inneren der Ecke.
  // Halbierende von (-inbound, outbound) – beide einheitliche Richtungen, die von V wegzeigen.
  const bisectorRaw = sub(outbound, inbound) // = (-inbound) + outbound
  const bisector = unit(bisectorRaw)
  if (!bisector) return null
  const distVO = radiusMm / Math.sin(phi / 2)
  const O: Point = add(V, scale(bisector, distVO))

  // Sweep-Winkel: |a2-a1| sollte ≈ pi - phi sein. Wir wählen die richtige Richtung über den erwarteten Sweep.
  const a1 = Math.atan2(T1.y - O.y, T1.x - O.x)
  const a2 = Math.atan2(T2.y - O.y, T2.x - O.x)
  let sweep = a2 - a1
  while (sweep <= -Math.PI) sweep += 2 * Math.PI
  while (sweep > Math.PI) sweep -= 2 * Math.PI
  const expectedSweep = Math.PI - phi
  if (Math.abs(Math.abs(sweep) - expectedSweep) > 0.05) {
    sweep = sweep > 0 ? sweep - 2 * Math.PI : sweep + 2 * Math.PI
  }

  const arcs = arcToBezierSegments(O, radiusMm, a1, a1 + sweep)
  if (arcs.length === 0) return null
  // Endpunkte exakt auf T1/T2 setzen (Float-Stabilität).
  arcs[0].start = { ...T1 }
  arcs[arcs.length - 1].end = { ...T2 }

  // Trimmed Nachbarn.
  const trimmedPrev: LineSegment = { type: 'line', start: { ...prevCurve.start }, end: { ...T1 } }
  const trimmedNext: LineSegment = { type: 'line', start: { ...T2 }, end: { ...nextCurve.end } }

  const newCurves: Curve[] = []
  const origin: (number | null)[] = []
  let arcStartIndex: number
  let t1VertexIndex: number
  let t2VertexIndex: number

  if (vertexIndex === 0) {
    // Layout: [trimmedNext, master[1..N-2], trimmedPrev, ...arcs]
    newCurves.push(trimmedNext)
    origin.push(nextIdx)
    for (let i = 1; i <= N - 2; i++) {
      newCurves.push(cloneCurve(master[i]))
      origin.push(i)
    }
    newCurves.push(trimmedPrev)
    origin.push(prevIdx)
    arcStartIndex = newCurves.length
    for (const a of arcs) {
      newCurves.push(a)
      origin.push(null)
    }
    t1VertexIndex = arcStartIndex // start of arcs[0]
    t2VertexIndex = 0 // start of trimmedNext
  } else {
    // Layout: [master[0..v-2], trimmedPrev, ...arcs, trimmedNext, master[v+1..N-1]]
    for (let i = 0; i <= vertexIndex - 2; i++) {
      newCurves.push(cloneCurve(master[i]))
      origin.push(i)
    }
    newCurves.push(trimmedPrev)
    origin.push(prevIdx)
    arcStartIndex = newCurves.length
    for (const a of arcs) {
      newCurves.push(a)
      origin.push(null)
    }
    t1VertexIndex = arcStartIndex
    newCurves.push(trimmedNext)
    origin.push(nextIdx)
    t2VertexIndex = newCurves.length - 1
    for (let i = vertexIndex + 1; i <= N - 1; i++) {
      newCurves.push(cloneCurve(master[i]))
      origin.push(i)
    }
  }

  const arcCurveIndices: number[] = []
  for (let k = 0; k < arcs.length; k++) arcCurveIndices.push(arcStartIndex + k)

  return {
    curves: newCurves,
    arcCurveIndices,
    t1VertexIndex,
    t2VertexIndex,
    radiusMm,
    addedCurves: arcs.length,
    originCurveIndices: origin,
    prevCurveIndex: prevIdx,
    nextCurveIndex: nextIdx,
  }
}

export type AppliedRounding = {
  /** Master-Vertex-Index der gerundeten Ecke (in der **scharfen** Eingangs-Master). */
  masterVertexIndex: number
  radiusMm: number
  /** Curve-Indices in der gerundeten Ausgangskontur, die zum Bogen gehören. */
  arcCurveIndices: number[]
  /** Vertex-Indices von T1 / T2 in der gerundeten Ausgangskontur. */
  t1VertexIndex: number
  t2VertexIndex: number
  /** Sharp prev curve index – zur Allowance-Lookup für die Bogen-Segmente. */
  sharpPrevCurveIndex: number
  /** Sharp next curve index. */
  sharpNextCurveIndex: number
}

export type ApplyRoundingsSkipped = {
  masterVertexIndex: number
  radiusMm: number
  reason: ValidateCornerRoundError
}

export type ApplyRoundingsResult = {
  /** Gerundete Master-Kontur (unverändert wenn `rounded` leer). */
  curves: Curve[]
  /** Erfolgreich angewendete Rundungen (nach allen Index-Verschiebungen finalisiert). */
  applied: AppliedRounding[]
  /** Übersprungene Rundungen mit Grund. */
  skipped: ApplyRoundingsSkipped[]
  /**
   * Origin im **scharfen** Eingangs-Master pro Output-Curve. null = eingefügtes Bogen-Segment.
   * Index-parallel zu `curves`. Bei mehreren Rundungen wird durch alle Schritte komponiert.
   */
  originCurveIndices: (number | null)[]
}

/**
 * Wendet alle persistierten Rundungen auf die Master-Kontur an. Reihenfolge: absteigend
 * nach `masterVertexIndex`, sodass Index-Verschiebungen nicht in Konflikt geraten.
 * Bereits angewandte Einträge werden nach jedem Schritt um `K` (= eingefügte Kurven) verschoben.
 */
export function applyCornerRoundings(
  master: Curve[],
  rounded: readonly RoundedCorner[]
): ApplyRoundingsResult {
  if (master.length === 0) {
    return { curves: [], applied: [], skipped: [], originCurveIndices: [] }
  }
  if (rounded.length === 0) {
    const curves = master.map(cloneCurve)
    return {
      curves,
      applied: [],
      skipped: [],
      originCurveIndices: curves.map((_, i) => i),
    }
  }
  // Dedupliziere auf masterVertexIndex (höchste Priorität: zuerst gefundener Eintrag).
  const seen = new Set<number>()
  const filtered: RoundedCorner[] = []
  for (const rc of rounded) {
    if (seen.has(rc.masterVertexIndex)) continue
    seen.add(rc.masterVertexIndex)
    filtered.push(rc)
  }
  // Absteigend nach masterVertexIndex sortieren.
  const sorted = [...filtered].sort((a, b) => b.masterVertexIndex - a.masterVertexIndex)

  let curves: Curve[] = master.map(cloneCurve)
  // Origin-Mapping: jedes curves[i] zeigt auf einen Curve-Index im **scharfen** Eingangs-Master (oder null für Bogen).
  let origin: (number | null)[] = curves.map((_, i) => i)
  const applied: AppliedRounding[] = []
  const skipped: ApplyRoundingsSkipped[] = []

  for (const rc of sorted) {
    const v = rc.masterVertexIndex
    const r = rc.radiusMm
    const validation = validateCornerRound(curves, v, r)
    if (!validation.ok) {
      skipped.push({ masterVertexIndex: v, radiusMm: r, reason: validation.reason })
      continue
    }
    const result = roundCornerOnMaster(curves, v, r)
    if (!result) {
      skipped.push({ masterVertexIndex: v, radiusMm: r, reason: 'INVALID_VERTEX' })
      continue
    }
    const K = result.addedCurves
    // Sharp prev/next sind die Origins der trimmedPrev/trimmedNext im scharfen Eingangs-Master.
    // result.prevCurveIndex/nextCurveIndex referenzieren Indizes im **aktuellen** Array (nach vorherigen Schritten).
    // Wir lookuppen das vorherige `origin`-Mapping.
    const sharpPrev = origin[result.prevCurveIndex] ?? null
    const sharpNext = origin[result.nextCurveIndex] ?? null

    // Origin-Mapping für das neue Array zusammenstellen: result.originCurveIndices liefert Indices ins ALTE Array.
    // Wir komponieren mit dem bisherigen origin-Mapping.
    const newOrigin: (number | null)[] = result.originCurveIndices.map((oldIdx) =>
      oldIdx == null ? null : origin[oldIdx] ?? null
    )

    // Index-Verschiebung der bereits angewandten Einträge.
    if (v !== 0) {
      for (const a of applied) {
        if (a.t1VertexIndex > v) a.t1VertexIndex += K
        if (a.t2VertexIndex > v) a.t2VertexIndex += K
        a.arcCurveIndices = a.arcCurveIndices.map((i) => (i >= v ? i + K : i))
      }
    }
    // Bei v === 0 verschieben sich keine bereits-vorhandenen Einträge (sie liegen alle bei Indizes >= 1
    // bzw. arcs der vorherigen Schritte mit höheren Vertex-Indizes wurden in den ersten N Positionen
    // des aktuellen Arrays eingefügt; durch das v=0-Layout bleiben Indizes ≤ N-1 stabil und neue Arcs
    // hängen am Ende an).
    curves = result.curves
    origin = newOrigin
    applied.push({
      masterVertexIndex: v,
      radiusMm: r,
      arcCurveIndices: result.arcCurveIndices,
      t1VertexIndex: result.t1VertexIndex,
      t2VertexIndex: result.t2VertexIndex,
      sharpPrevCurveIndex: sharpPrev ?? -1,
      sharpNextCurveIndex: sharpNext ?? -1,
    })
  }

  return { curves, applied, skipped, originCurveIndices: origin }
}

/**
 * Findet zu einem Curve-Index in der gerundeten Master-Kontur den zugehörigen
 * `RoundedCorner.masterVertexIndex`, falls der Curve ein Bogen-Segment ist.
 */
export function findRoundedCornerForArcCurveIndex(
  applied: readonly AppliedRounding[],
  curveIndex: number
): AppliedRounding | null {
  for (const a of applied) {
    if (a.arcCurveIndices.includes(curveIndex)) return a
  }
  return null
}
