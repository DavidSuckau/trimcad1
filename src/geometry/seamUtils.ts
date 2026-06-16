import type { PatternPiece, Point, Curve } from '../types/model'
import { curveSegmentArcLength, bezierAt, pointAtPathLength, pathLengthAt, totalPathLength } from './curveToPath'
import { nearestCurveIndexAndPoint } from './nearestOnCurve'
import { getNotchCurveIndexAndT, getNotchPositionAndAngle, extractCurvePortion } from './notchOnCurve'
import { offsetSegmentPoints } from './offset'
import { useSeamLineForVertexEditing } from './vertexMaster'
import { vertexPosition as vertexPositionOnClosedCurves } from './geometryConstants'
import {
  deriveProfileBoundaryRangeAtArcLength,
  deriveProfileBoundaryRangeOnPath,
  isProfileBoundaryNotchRole,
  pieceNotchRoleById,
} from './profileBoundaryRange'

/**
 * Kontur für Nahtzuordnung und dieselbe **Master-/Editing-Kontur** wie UI/Vertex-Logik.
 * Implementierung entspricht `useSeamLineForVertexEditing` (eine Quelle der Wahrheit).
 *
 * Nach applyOffset ist seamLine eine Kopie der bisherigen Innenkontur (gleiche Segmentzahl/Indices);
 * cutLine ist der äußere Offset. curveIndices in SeamAssignment sind immer diese Master-Indizes.
 */
export function getCurvesForSeamEdge(piece: PatternPiece): Curve[] {
  return useSeamLineForVertexEditing(piece) ? piece.seamLine : piece.cutLine
}

/** Alias: dieselbe Kurve wie {@link getCurvesForSeamEdge} (Editing-/Master-Kontur). */
export const getEditingContour = getCurvesForSeamEdge

/** Toleranz Cut→Master: gleiche „logische Ecke“ trotz Offset (mm). */
const MAP_CUT_TO_MASTER_EPS_MM = 8

/**
 * Master-Vertex (Naht) → nächstliegender Eckpunkt auf der cutLine (für softVertices, die immer cut-indiziert sind).
 * Mit Distanzschwelle: verhindert, dass ein Master-Vertex auf einen weit entfernten Cut-Vertex
 * gemappt wird (z. B. wenn Clipper die Topologie ändert und keine logische Entsprechung existiert).
 */
export function mapMasterVertexIndexToCutVertexIndex(piece: PatternPiece, masterVi: number): number | null {
  const master = getCurvesForSeamEdge(piece)
  const cut = piece.cutLine
  if (masterVi < 0 || masterVi >= master.length) return null
  if (master === cut) return masterVi < cut.length ? masterVi : null
  const masterPt = vertexPositionOnClosedCurves(master, masterVi)
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < cut.length; i++) {
    const p = vertexPositionOnClosedCurves(cut, i)
    const d = Math.hypot(p.x - masterPt.x, p.y - masterPt.y)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  const maxDist = Math.max((piece.seamAllowanceMm ?? 0) * 2, MAP_CUT_TO_MASTER_EPS_MM)
  return best >= 0 && bestD <= maxDist ? best : null
}

/**
 * Cut→Master mit Distanzdeckel (z. B. Kerben/Notches): nur wenn nahe genug, sonst keine Zuordnung.
 * Öffentlich für UI (z. B. verankerte Kerbe → gleichen Master-Eckpunkt wie Nahtlinie ziehen).
 */
export function mapCutVertexIndexToMasterVertexIndex(piece: PatternPiece, cutVi: number): number | null {
  const master = getCurvesForSeamEdge(piece)
  const cut = piece.cutLine
  if (cutVi < 0 || cutVi >= cut.length) return null
  if (master === cut) {
    return cutVi < master.length ? cutVi : null
  }
  const cutPt = vertexPositionOnClosedCurves(cut, cutVi)
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < master.length; i++) {
    const p = vertexPositionOnClosedCurves(master, i)
    const d = Math.hypot(p.x - cutPt.x, p.y - cutPt.y)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best >= 0 && bestD <= MAP_CUT_TO_MASTER_EPS_MM ? best : null
}

/**
 * Cut-Eck → Naht-Eck für **Vertex-Ziehen** (z. B. verankerte Kerbe): dieselbe logische Ecke muss trotz
 * Nahtzugabe (großer Abstand zwischen Innen- und Außenkontur) zuordenbar sein.
 * Bei gleicher Segmentzahl (typisch nach Offset) 1:1 per Index; sonst nächstgelegener Master-Eckpunkt.
 */
export function mapCutVertexIndexToMasterVertexIndexForVertexDrag(
  piece: PatternPiece,
  cutVi: number
): number | null {
  const master = getCurvesForSeamEdge(piece)
  const cut = piece.cutLine
  if (cutVi < 0 || cutVi >= cut.length) return null
  if (master === cut) return cutVi < master.length ? cutVi : null
  if (master.length === cut.length) {
    return cutVi < master.length ? cutVi : null
  }
  const cutPt = vertexPositionOnClosedCurves(cut, cutVi)
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < master.length; i++) {
    const p = vertexPositionOnClosedCurves(master, i)
    const d = Math.hypot(p.x - cutPt.x, p.y - cutPt.y)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  const maxDist = Math.max((piece.seamAllowanceMm ?? 0) * 2, MAP_CUT_TO_MASTER_EPS_MM)
  return best >= 0 && bestD <= maxDist ? best : null
}

/** Alle weichen Eckpunkte auf der Schnittkontur (Cut-Indizes): eingefügte Punkte + per Master gemappte weiche Naht-Ecken. */
export function getEffectiveSoftVerticesCut(piece: PatternPiece): number[] {
  const set = new Set(piece.softVertices ?? [])
  if (useSeamLineForVertexEditing(piece)) {
    const master = getCurvesForSeamEdge(piece)
    const n = master.length
    for (const mvi of piece.softVerticesMaster ?? []) {
      if (mvi < 0 || mvi >= n) continue
      const c = mapMasterVertexIndexToCutVertexIndex(piece, mvi)
      if (c != null) set.add(c)
    }
  }
  return [...set].sort((a, b) => a - b)
}

/**
 * Cut-Soft-Liste (z. B. nach Remap) wieder in `softVertices` / `softVerticesMaster` aufteilen.
 *
 * `softVerticesMaster` ist die primäre Quelle der Wahrheit für seam-as-master Teile.
 * Sie wird nur per Range-Check gefiltert (Index innerhalb der Master-Kontur), NICHT
 * nach Cut-Mapping. Grund: Clipper kann kollineare Vertices auf der cutLine entfernen,
 * sodass kein korrespondierender Cut-Vertex existiert. Dann würde ein Filter per
 * `mapMasterVertexIndexToCutVertexIndex` den Master-Soft-Eintrag fälschlich löschen.
 */
export function syncSoftAfterSharpCornerPromotion(piece: PatternPiece, filteredCutSoft: number[]): PatternPiece {
  const valid = new Set(filteredCutSoft)
  if (useSeamLineForVertexEditing(piece)) {
    const masterImpliedCut = new Set(
      (piece.softVerticesMaster ?? [])
        .map((m) => mapMasterVertexIndexToCutVertexIndex(piece, m))
        .filter((x): x is number => x != null)
    )
    const softVertices = [...valid]
      .filter((c) => {
        if (!masterImpliedCut.has(c)) return true
        return (piece.softVertices ?? []).includes(c)
      })
      .sort((a, b) => a - b)
    const masterN = piece.seamLine.length
    const softVerticesMaster = (piece.softVerticesMaster ?? [])
      .filter((m) => m >= 0 && m < masterN)
      .sort((a, b) => a - b)
    return {
      ...piece,
      softVertices,
      softVerticesMaster,
    }
  }
  return { ...piece, softVertices: [...filteredCutSoft].sort((a, b) => a - b) }
}

/**
 * Weiche Punkte auf der **Master-Kontur** (Naht bzw. Schnitt ohne Zugabe).
 *
 * Bei seam-as-master (Nahtzugabe): ausschließlich `softVerticesMaster`.
 * Kein Rück-Mapping von `softVertices` (Cut-Indizes) → Master, weil
 * Clipper die Cut-Topologie ändert und verwaiste Cut-Indizes sonst
 * fälschlich auf harte Master-Vertices projiziert werden (Bug: rot→blau).
 *
 * Ohne Nahtzugabe (master === cutLine): `softVertices` direkt.
 */
export function masterSoftVertexIndexSet(piece: PatternPiece): Set<number> {
  const master = getCurvesForSeamEdge(piece)
  const n = master.length
  const out = new Set<number>()
  if (master === piece.cutLine) {
    for (const vi of piece.softVertices ?? []) {
      if (vi >= 0 && vi < n) out.add(vi)
    }
    return out
  }
  for (const vi of piece.softVerticesMaster ?? []) {
    if (vi >= 0 && vi < n) out.add(vi)
  }
  return out
}

/** @deprecated Notches sind nicht mehr an Vertices verankert; liefert immer ein leeres Set. */
export function masterNotchVertexIndexSet(_piece: PatternPiece): Set<number> {
  return new Set<number>()
}

/**
 * Stellt die vollständige Segmentkette von Eckpunkt→Eckpunkt wieder her (Master-Kontur).
 * Verhindert „Lücken“ in gespeicherten curveIndices nach Teil-Updates; Eckpunkte bleiben die gleichen.
 */
export function expandSeamEdgeCurveIndices(piece: PatternPiece, storedCurveIndices: number[]): number[] {
  const curves = getCurvesForSeamEdge(piece)
  const n = curves.length
  if (storedCurveIndices.length === 0 || n === 0) return storedCurveIndices
  for (const ci of storedCurveIndices) {
    if (ci < 0 || ci >= n) return storedCurveIndices
  }
  const first = storedCurveIndices[0]
  const last = storedCurveIndices[storedCurveIndices.length - 1]
  const endVi = (last + 1) % n
  const fresh: number[] = []
  let vi = first
  let guard = 0
  while (vi !== endVi && guard < n + 2) {
    fresh.push(vi)
    vi = (vi + 1) % n
    guard++
  }
  return fresh.length > 0 ? fresh : storedCurveIndices
}

/** Für SeamAssignment: aufgelöste Master-Segmentindizes Eck→Eck. */
export function resolvedSeamAssignmentCurveIndices(
  piece: PatternPiece,
  storedCurveIndices: number[]
): number[] {
  return expandSeamEdgeCurveIndices(piece, storedCurveIndices)
}

/**
 * Erweitert einen einzelnen curveIndex zur Eckpunkt→Eckpunkt-Range.
 * Eckpunkt = Vertex der weder softVertex noch Notch-Vertex ist.
 * Nutzt die Master-Kontur (seamLine bei Nahtzugabe, sonst cutLine) – wichtig für konsistente
 * Nahtzuordnung nach applyOffset, da cutLine dann eine andere Struktur hat.
 */
export function getCornerRange(piece: PatternPiece, curveIndex: number): number[] {
  const curves = getCurvesForSeamEdge(piece)
  const n = curves.length
  if (n === 0) return []
  const softSet = masterSoftVertexIndexSet(piece)
  const notchVIs = masterNotchVertexIndexSet(piece)
  const isCorner = (vi: number) => !softSet.has(vi) && !notchVIs.has(vi)

  let startVi = curveIndex
  for (let steps = 0; steps < n; steps++) {
    if (isCorner(startVi)) break
    startVi = (startVi - 1 + n) % n
  }

  let endVi = (curveIndex + 1) % n
  for (let steps = 0; steps < n; steps++) {
    if (isCorner(endVi)) break
    endVi = (endVi + 1) % n
  }

  const result: number[] = []
  let vi = startVi
  while (vi !== endVi) {
    result.push(vi)
    vi = (vi + 1) % n
  }
  return result.length > 0 ? result : [curveIndex]
}

/**
 * Löst die Notch-Position auf den Master-Kurven korrekt auf.
 * Wenn master = cutLine → direkt resolven.
 * Wenn master = seamLine (Nahtzugabe) → erst auf cutLine resolven, dann per
 * Euclidean-Nearest auf seamLine projizieren (konsistent mit contourMeasurements).
 * Vermeidet den Fehler, sNormalized (cutLine-relativ) auf seamLine zu interpretieren.
 */
function resolveNotchOnMasterCurves(
  notch: PatternPiece['notches'][number],
  piece: PatternPiece,
  masterCurves: Curve[]
): { curveIndex: number; t: number } | null {
  if (masterCurves === piece.cutLine || piece.seamLine.length === 0) {
    return getNotchCurveIndexAndT(notch, masterCurves)
  }
  const { position } = getNotchPositionAndAngle(notch, piece.cutLine)
  const nearest = nearestCurveIndexAndPoint(position, masterCurves)
  return nearest ? { curveIndex: nearest.curveIndex, t: nearest.t ?? 0 } : null
}

/** Zählt Notches die auf einer Eckpunkt→Eckpunkt-Kante liegen (nicht an den Eck-Eckpunkten selbst). */
export function countNotchesOnEdge(piece: PatternPiece, curveIndices: number[], curves?: Curve[]): number {
  if (curveIndices.length === 0) return 0
  const curvs = curves ?? getCurvesForSeamEdge(piece)
  const ciSet = new Set(curveIndices)
  let count = 0
  for (const n of piece.notches) {
    const ct = resolveNotchOnMasterCurves(n, piece, curvs)
    if (ct && ciSet.has(ct.curveIndex)) count++
  }
  return count
}

export type SubSegInfo = { length: number; midpoint: Point }

/**
 * Wählt die bessere Paarung der Subsegmente zwischen zwei Nahtkanten (gleiche vs. gegenläufige
 * Laufrichtung entlang der jeweiligen Kontur). Ohne feste Annahme „immer B umkehren“: nach Spiegeln
 * oder je nach gewählter Kante kann die bessere Übereinstimmung die gleiche Index-Reihenfolge sein.
 */
export type SeamSubSegmentPairing = {
  /** true: subsA[i] ↔ subsB[n−1−i] (gegenläufig); false: subsA[i] ↔ subsB[i] */
  reverseB: boolean
  /** Summe |ΔL| über alle Subsegmente bei dieser Paarung (mm) */
  totalMismatchMm: number
  /** Größte einzelne Abweichung eines Subsegments (mm) */
  maxSegmentMismatchMm: number
}

export function bestSeamSubSegmentPairing(
  subsA: SubSegInfo[],
  subsB: SubSegInfo[]
): SeamSubSegmentPairing | null {
  if (subsA.length === 0 || subsA.length !== subsB.length) return null
  const n = subsA.length
  let errRev = 0
  let maxRev = 0
  for (let i = 0; i < n; i++) {
    const d = Math.abs(subsA[i].length - subsB[n - 1 - i].length)
    errRev += d
    maxRev = Math.max(maxRev, d)
  }
  let errFwd = 0
  let maxFwd = 0
  for (let i = 0; i < n; i++) {
    const d = Math.abs(subsA[i].length - subsB[i].length)
    errFwd += d
    maxFwd = Math.max(maxFwd, d)
  }
  const reverseB = errRev <= errFwd
  return {
    reverseB,
    totalMismatchMm: reverseB ? errRev : errFwd,
    maxSegmentMismatchMm: reverseB ? maxRev : maxFwd,
  }
}

/**
 * Teilt eine Eckpunkt→Eckpunkt-Kante an den Notch-Positionen in Teilstrecken auf.
 * Rückgabe: je Teilstrecke die Länge (mm) und den Mittelpunkt (piece-local).
 */
export function getSubSegments(
  piece: PatternPiece,
  curveIndices: number[],
  curves?: Curve[],
  range?: NotchRoleRange | null
): SubSegInfo[] {
  if (curveIndices.length === 0) return []

  const curvs = curves ?? getCurvesForSeamEdge(piece)
  const segLengths: number[] = []
  const cumLengths: number[] = [0]
  for (const ci of curveIndices) {
    const seg = curvs[ci]
    if (!seg) { segLengths.push(0); continue }
    const l = curveSegmentArcLength(seg, 0, 1)
    segLengths.push(l)
    cumLengths.push(cumLengths[cumLengths.length - 1] + l)
  }
  const totalLen = cumLengths[cumLengths.length - 1]
  if (totalLen <= 0) return [{ length: 0, midpoint: { x: 0, y: 0 } }]

  const ciToIdx = new Map<number, number>()
  for (let i = 0; i < curveIndices.length; i++) ciToIdx.set(curveIndices[i], i)

  const notchesOnEdge = getNotchesOnEdge(piece, curveIndices, curvs)
  const startArc = range ? notchesOnEdge.find((n) => n.notchId === range.startNotchId)?.arcLength : undefined
  const endArc = range ? notchesOnEdge.find((n) => n.notchId === range.endNotchId)?.arcLength : undefined
  const notchPositions = notchesOnEdge
    .map((n) => n.arcLength)
    .filter((L) => {
      if (startArc == null || endArc == null || endArc <= startArc) return true
      return L > startArc && L < endArc
    })

  notchPositions.sort((a, b) => a - b)
  const positions = [0, ...notchPositions, totalLen]

  const pointAtArcLen = (L: number): Point => {
    let acc = 0
    for (let i = 0; i < curveIndices.length; i++) {
      const sl = segLengths[i]
      if (acc + sl >= L - 1e-9) {
        const local = Math.max(0, L - acc)
        const c = curvs[curveIndices[i]]
        if (!c) return { x: 0, y: 0 }
        if (c.type === 'line') {
          const t = sl > 0 ? local / sl : 0
          return { x: c.start.x + t * (c.end.x - c.start.x), y: c.start.y + t * (c.end.y - c.start.y) }
        }
        let lo = 0, hi = 1
        for (let step = 0; step < 16; step++) {
          const mid = (lo + hi) / 2
          if (curveSegmentArcLength(c, 0, mid) < local) lo = mid; else hi = mid
        }
        return bezierAt(c, (lo + hi) / 2)
      }
      acc += sl
    }
    const last = curvs[curveIndices[curveIndices.length - 1]]
    return last ? last.end : { x: 0, y: 0 }
  }

  const result: SubSegInfo[] = []
  for (let i = 0; i < positions.length - 1; i++) {
    const length = positions[i + 1] - positions[i]
    const midpoint = pointAtArcLen((positions[i] + positions[i + 1]) / 2)
    result.push({ length, midpoint })
  }
  return result
}

/**
 * Liefert die Notch-IDs die auf einer Kante (curveIndices) liegen,
 * in der Reihenfolge ihrer Bogenlängen-Position vom Kantenstart.
 */
export function getNotchesOnEdge(piece: PatternPiece, curveIndices: number[], curves?: Curve[]): { notchId: string; arcLength: number }[] {
  if (curveIndices.length === 0) return []

  const curvs = curves ?? getCurvesForSeamEdge(piece)
  const cumLengths: number[] = [0]
  for (const ci of curveIndices) {
    const seg = curvs[ci]
    if (!seg) continue
    cumLengths.push(cumLengths[cumLengths.length - 1] + curveSegmentArcLength(seg, 0, 1))
  }

  const ciToIdx = new Map<number, number>()
  for (let i = 0; i < curveIndices.length; i++) ciToIdx.set(curveIndices[i], i)

  const ciSet = new Set(curveIndices)
  const result: { notchId: string; arcLength: number }[] = []

  for (const n of piece.notches) {
    const ct = resolveNotchOnMasterCurves(n, piece, curvs)
    if (ct && ciSet.has(ct.curveIndex)) {
      const idx = ciToIdx.get(ct.curveIndex)
      if (idx != null) {
        result.push({ notchId: n.id, arcLength: cumLengths[idx] + curveSegmentArcLength(curvs[ct.curveIndex], 0, ct.t) })
      }
    }
  }

  result.sort((a, b) => a.arcLength - b.arcLength)
  return result
}

export type NotchRoleRange = { startNotchId: string; endNotchId: string }
export type NotchBoundaryRange = { startNotchId?: string; endNotchId?: string }

/**
 * Leitet auf einer Kante ein eindeutiges Segment aus Rollen-Notches ab.
 * `beides` zählt als Start und Ende.
 */
export function deriveNotchRoleRangeOnEdge(
  piece: PatternPiece,
  curveIndices: number[],
  curves?: Curve[]
): NotchRoleRange | null {
  if (curveIndices.length === 0) return null
  const notches = getNotchesOnEdge(piece, curveIndices, curves)
  if (notches.length < 2) return null
  const roleById = new Map(piece.notches.map((n) => [n.id, n.role]))
  const starts = notches.filter((n) => {
    const r = roleById.get(n.notchId)
    return r === 'nahtanfang' || r === 'beides'
  })
  const ends = notches.filter((n) => {
    const r = roleById.get(n.notchId)
    return r === 'nahtende' || r === 'beides'
  })
  if (starts.length !== 1 || ends.length !== 1) return null
  if (starts[0].notchId === ends[0].notchId) return null
  return { startNotchId: starts[0].notchId, endNotchId: ends[0].notchId }
}

/**
 * Bestimmt das Rollen-Intervall (Start/Ende) relativ zu einer Klickposition auf der Kante.
 * Nimmt den letzten Start-Notch (nahtanfang|beides) vor dem Klick und den ersten End-Notch
 * (nahtende|beides) nach dem Klick.
 */
export function deriveNotchRoleRangeAtArcLength(
  piece: PatternPiece,
  curveIndices: number[],
  arcLengthOnEdge: number,
  curves?: Curve[]
): NotchBoundaryRange | null {
  const notches = getNotchesOnEdge(piece, curveIndices, curves)
  if (notches.length === 0) return null
  const roleById = new Map(piece.notches.map((n) => [n.id, n.role]))
  const starts = notches.filter((n) => {
    const r = roleById.get(n.notchId)
    return (r === 'nahtanfang' || r === 'beides') && n.arcLength <= arcLengthOnEdge
  })
  const ends = notches.filter((n) => {
    const r = roleById.get(n.notchId)
    return (r === 'nahtende' || r === 'beides') && n.arcLength >= arcLengthOnEdge
  })
  if (starts.length === 0 && ends.length === 0) return null
  if (starts.length === 0) return { endNotchId: ends[0].notchId }
  if (ends.length === 0) return { startNotchId: starts[starts.length - 1].notchId }
  const start = starts[starts.length - 1]
  const end = ends[0]
  if (start.notchId === end.notchId || start.arcLength >= end.arcLength) {
    return null
  }
  return { startNotchId: start.notchId, endNotchId: end.notchId }
}

/** Profil-Grenzen auf Kontur-Kante (Rollen-Typ egal; auch Kerbe ↔ Eckpunkt). */
export function deriveContourProfileBoundaryRangeAtArcLength(
  piece: PatternPiece,
  curveIndices: number[],
  arcLengthOnEdge: number,
  curves?: Curve[]
): NotchBoundaryRange | null {
  const notches = getNotchesOnEdge(piece, curveIndices, curves)
  return deriveProfileBoundaryRangeAtArcLength(notches, arcLengthOnEdge, pieceNotchRoleById(piece))
}

export function deriveContourProfileBoundaryRangeOnEdge(
  piece: PatternPiece,
  curveIndices: number[],
  curves?: Curve[]
): NotchBoundaryRange | null {
  const notches = getNotchesOnEdge(piece, curveIndices, curves)
  return deriveProfileBoundaryRangeOnPath(notches, pieceNotchRoleById(piece))
}

export function edgeHasProfileBoundaryNotches(
  piece: PatternPiece,
  curveIndices: number[],
  curves?: Curve[]
): boolean {
  const notches = getNotchesOnEdge(piece, curveIndices, curves)
  const roleById = pieceNotchRoleById(piece)
  return notches.some((n) => isProfileBoundaryNotchRole(roleById.get(n.notchId)))
}

export function getNotchesOnEdgeInRange(
  piece: PatternPiece,
  curveIndices: number[],
  range?: NotchRoleRange | null,
  curves?: Curve[]
): { notchId: string; arcLength: number }[] {
  const all = getNotchesOnEdge(piece, curveIndices, curves)
  if (!range) return all
  const iStart = all.findIndex((n) => n.notchId === range.startNotchId)
  const iEnd = all.findIndex((n) => n.notchId === range.endNotchId)
  if (iStart < 0 || iEnd < 0 || iStart >= iEnd) return all
  return all.filter((_, i) => i > iStart && i < iEnd)
}

/** Länge eines Teilsegments zwischen zwei Notches auf derselben Kante (Master-Kontur). */
export function edgeLengthInNotchRange(
  piece: PatternPiece,
  curveIndices: number[],
  range?: NotchBoundaryRange | null,
  curves?: Curve[]
): number {
  const total = edgeTotalLength(piece, curveIndices, curves)
  if (!range || total <= 0) return total
  const all = getNotchesOnEdge(piece, curveIndices, curves)
  const start = range.startNotchId ? all.find((n) => n.notchId === range.startNotchId) : null
  const end = range.endNotchId ? all.find((n) => n.notchId === range.endNotchId) : null
  if (start && end && end.arcLength > start.arcLength) return end.arcLength - start.arcLength
  if (start && !end) return Math.max(0, total - start.arcLength)
  if (!start && end) return Math.max(0, end.arcLength)
  if (start && end && end.arcLength <= start.arcLength) return total
  return total
}

/**
 * Liefert den geometrischen Teil einer Kante zwischen zwei Rollen-Notches.
 * Ohne/ungültige Range: gesamte Kante.
 */
export type GetNotchesOnEdgeFn = (
  piece: PatternPiece,
  curveIndices: number[],
  curves?: Curve[]
) => { notchId: string; arcLength: number }[]

export function getEdgeCurvesInNotchRange(
  piece: PatternPiece,
  curveIndices: number[],
  range?: NotchBoundaryRange | null,
  curves?: Curve[],
  getNotchesOnEdgeFn: GetNotchesOnEdgeFn = getNotchesOnEdge
): Curve[] {
  if (curveIndices.length === 0) return []
  const curvs = curves ?? getCurvesForSeamEdge(piece)
  if (!range) return curveIndices.map((ci) => curvs[ci]).filter(Boolean)

  const all = getNotchesOnEdgeFn(piece, curveIndices, curvs)
  const totalLen = edgeTotalLength(piece, curveIndices, curvs)
  const start = range.startNotchId ? all.find((n) => n.notchId === range.startNotchId) : null
  const end = range.endNotchId ? all.find((n) => n.notchId === range.endNotchId) : null
  const startArc = start ? start.arcLength : 0
  const endArc = end ? end.arcLength : totalLen
  if (endArc <= startArc) {
    return curveIndices.map((ci) => curvs[ci]).filter(Boolean)
  }

  const cumulative: number[] = [0]
  for (const ci of curveIndices) {
    const seg = curvs[ci]
    cumulative.push(cumulative[cumulative.length - 1] + (seg ? curveSegmentArcLength(seg, 0, 1) : 0))
  }

  const locate = (arc: number): { ci: number; t: number } | null => {
    for (let i = 0; i < curveIndices.length; i++) {
      const segStart = cumulative[i]
      const segEnd = cumulative[i + 1]
      if (arc <= segEnd + 1e-9) {
        const ci = curveIndices[i]
        const segLen = Math.max(1e-9, segEnd - segStart)
        const t = Math.max(0, Math.min(1, (arc - segStart) / segLen))
        return { ci, t }
      }
    }
    const ci = curveIndices[curveIndices.length - 1]
    return ci != null ? { ci, t: 1 } : null
  }

  const from = locate(startArc)
  const to = locate(endArc)
  if (!from || !to) return curveIndices.map((ci) => curvs[ci]).filter(Boolean)
  return extractCurvePortion(curvs, from.ci, from.t, to.ci, to.t)
}

/**
 * Liefert die Seam-Linien-Kurven für eine Eckpunkt→Eckpunkt-Kante (nur auf der Nahtlinie, nicht darüber hinaus).
 * Nutzt die echte piece.seamLine und schneidet exakt von Eckpunkt zu Eckpunkt.
 * curveIndices beziehen sich auf die Master-Kontur (seamLine bei Nahtzugabe) – hier ist das seamLine direkt.
 *
 * Beispiel:
 * - Master = seamLine, curveIndices = [3, 0] (wrap-around)
 * - Ergebnis: Ende von Segment 3 plus Anfang von Segment 0, lückenlos auf seamLine.
 *
 * Fallback-Pfad (master !== seamLine) bleibt aus Legacy-/Importgründen erhalten:
 * cutLine-Edge wird auf seamLine projiziert und die plausiblere Laufrichtung über Längenvergleich gewählt.
 */
export function getSeamEdgeCurves(piece: PatternPiece, curveIndices: number[]): Curve[] {
  if (curveIndices.length === 0 || piece.seamLine.length < 3 || piece.seamAllowanceMm == null) return []
  const seamLine = piece.seamLine
  const master = getCurvesForSeamEdge(piece)
  // curveIndices referenzieren die Master-Kontur = seamLine bei Nahtzugabe
  if (master === seamLine) {
    // Direkt aus seamLine extrahieren (curveIndices sind schon seamLine-Indices)
    const firstCi = curveIndices[0]
    const lastCi = curveIndices[curveIndices.length - 1]
    const n = seamLine.length
    if (firstCi <= lastCi) {
      return extractCurvePortion(seamLine, firstCi, 0, lastCi, 1)
    }
    const part1 = extractCurvePortion(seamLine, firstCi, 0, n - 1, 1)
    const part2 = extractCurvePortion(seamLine, 0, 0, lastCi, 1)
    return [...part1, ...part2]
  }
  const cutLine = piece.cutLine
  const seamMm = piece.seamAllowanceMm
  const firstCi = curveIndices[0]
  const lastCi = curveIndices[curveIndices.length - 1]
  const ptsStart = offsetSegmentPoints(cutLine, firstCi, -seamMm)
  const ptsEnd = offsetSegmentPoints(cutLine, lastCi, -seamMm)
  if (!ptsStart || !ptsEnd) return []

  const nr1 = nearestCurveIndexAndPoint(ptsStart.start, seamLine)
  const nr2 = nearestCurveIndexAndPoint(ptsEnd.end, seamLine)
  if (!nr1 || !nr2) return []

  const L1 = pathLengthAt(seamLine, nr1.curveIndex, nr1.t ?? 0)
  const L2 = pathLengthAt(seamLine, nr2.curveIndex, nr2.t ?? 1)
  const total = totalPathLength(seamLine)
  const cutLen = edgeTotalLength(piece, curveIndices)

  const dForward = L2 >= L1 ? L2 - L1 : total - L1 + L2
  const dBack = total - dForward
  const useForward = dForward <= dBack && Math.abs(dForward - cutLen) <= Math.abs(dBack - cutLen)

  const n = seamLine.length
  let fromCI: number
  let fromT: number
  let toCI: number
  let toT: number
  if (useForward) {
    fromCI = nr1.curveIndex
    fromT = nr1.t ?? 0
    toCI = nr2.curveIndex
    toT = nr2.t ?? 1
  } else {
    fromCI = nr2.curveIndex
    fromT = nr2.t ?? 1
    toCI = nr1.curveIndex
    toT = nr1.t ?? 0
  }

  if (fromCI <= toCI) {
    return extractCurvePortion(seamLine, fromCI, fromT, toCI, toT)
  }
  const part1 = extractCurvePortion(seamLine, fromCI, fromT, n - 1, 1)
  const part2 = extractCurvePortion(seamLine, 0, 0, toCI, toT)
  return [...part1, ...part2]
}

/** Gesamtbogenlänge einer Kante (curveIndices) in mm. */
export function edgeTotalLength(piece: PatternPiece, curveIndices: number[], curves?: Curve[]): number {
  const curvs = curves ?? getCurvesForSeamEdge(piece)
  let total = 0
  for (const ci of curveIndices) {
    const seg = curvs[ci]
    if (seg) total += curveSegmentArcLength(seg, 0, 1)
  }
  return total
}

/** Wenn |Länge A − Länge B| unter diesem Wert (mm) liegt, kann snapSeamEdgeToMatch per Alt/⌘/Strg auf exakt 0 springen. */
export const SEAM_EDGE_LENGTH_SNAP_TOLERANCE_MM = 5

/**
 * Ermittelt die exakte Vertex-Position, sodass die Kantenlänge targetLength mm ergibt.
 * vertexIndex muss Start oder Ende der Kante sein (curveIndices[0] oder curveIndices[last]+1).
 * Liefert null wenn der Vertex nicht zur Kante gehört oder die Berechnung fehlschlägt.
 */
export function snapVertexToEdgeLength(
  piece: PatternPiece,
  curveIndices: number[],
  vertexIndex: number,
  targetLength: number,
  curves?: Curve[]
): Point | null {
  const curvs = curves ?? getCurvesForSeamEdge(piece)
  const n = curvs.length
  if (curveIndices.length === 0 || n === 0) return null
  const firstCi = curveIndices[0]
  const lastCi = curveIndices[curveIndices.length - 1]
  const startVi = firstCi
  const endVi = (lastCi + 1) % n

  const segs = curveIndices.map((ci) => curvs[ci]).filter(Boolean)
  if (segs.length === 0) return null

  if (vertexIndex === startVi) {
    const seg0 = segs[0]
    if (seg0.type === 'bezier') return null
    let fixed = 0
    for (let i = 1; i < segs.length; i++) {
      fixed += curveSegmentArcLength(segs[i], 0, 1)
    }
    const needFromEnd = Math.max(0, targetLength - fixed)
    const seg0Len = curveSegmentArcLength(seg0, 0, 1)
    const distFromStart = Math.max(0, Math.min(seg0Len, seg0Len - needFromEnd))
    const r = pointAtPathLength(segs.slice(0, 1), distFromStart)
    return r?.point ?? null
  }
  if (vertexIndex === endVi) {
    const segLast = segs[segs.length - 1]
    if (segLast.type === 'bezier') return null
    let fixed = 0
    for (let i = 0; i < segs.length - 1; i++) {
      fixed += curveSegmentArcLength(segs[i], 0, 1)
    }
    const needLast = Math.max(0, Math.min(targetLength - fixed, curveSegmentArcLength(segLast, 0, 1)))
    const r = pointAtPathLength(segs.slice(-1), needLast)
    return r?.point ?? null
  }
  return null
}
