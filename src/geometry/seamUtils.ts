import type { PatternPiece, Point } from '../types/model'
import { curveSegmentArcLength, bezierAt, pointAtPathLength } from './curveToPath'
import { nearestCurveIndexAndPoint } from './nearestOnCurve'
import { getNotchCurveIndexAndT } from './notchOnCurve'

/**
 * Erweitert einen einzelnen curveIndex zur Eckpunkt→Eckpunkt-Range.
 * Eckpunkt = Vertex der weder softVertex noch Notch-Vertex ist.
 */
export function getCornerRange(piece: PatternPiece, curveIndex: number): number[] {
  const n = piece.cutLine.length
  if (n === 0) return []
  const softSet = new Set(piece.softVertices ?? [])
  const notchVIs = new Set(
    piece.notches.map((nn) => nn.vertexIndex).filter((vi): vi is number => vi != null)
  )
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

/** Zählt Notches die auf einer Eckpunkt→Eckpunkt-Kante liegen (nicht an den Eck-Eckpunkten selbst). */
export function countNotchesOnEdge(piece: PatternPiece, curveIndices: number[]): number {
  if (curveIndices.length === 0) return 0
  const ciSet = new Set(curveIndices)
  const interiorVertices = new Set(curveIndices.slice(1))
  let count = 0
  for (const n of piece.notches) {
    if (n.vertexIndex != null) {
      if (interiorVertices.has(n.vertexIndex)) count++
    } else {
      const nr = nearestCurveIndexAndPoint(n.position, piece.cutLine)
      if (nr && ciSet.has(nr.curveIndex)) count++
    }
  }
  return count
}

export type SubSegInfo = { length: number; midpoint: Point }

/**
 * Teilt eine Eckpunkt→Eckpunkt-Kante an den Notch-Positionen in Teilstrecken auf.
 * Rückgabe: je Teilstrecke die Länge (mm) und den Mittelpunkt (piece-local).
 */
export function getSubSegments(piece: PatternPiece, curveIndices: number[]): SubSegInfo[] {
  if (curveIndices.length === 0) return []

  const segLengths: number[] = []
  const cumLengths: number[] = [0]
  for (const ci of curveIndices) {
    const seg = piece.cutLine[ci]
    if (!seg) { segLengths.push(0); continue }
    const l = curveSegmentArcLength(seg, 0, 1)
    segLengths.push(l)
    cumLengths.push(cumLengths[cumLengths.length - 1] + l)
  }
  const totalLen = cumLengths[cumLengths.length - 1]
  if (totalLen <= 0) return [{ length: 0, midpoint: { x: 0, y: 0 } }]

  const ciToIdx = new Map<number, number>()
  for (let i = 0; i < curveIndices.length; i++) ciToIdx.set(curveIndices[i], i)

  const ciSet = new Set(curveIndices)
  const interiorVertices = new Set(curveIndices.slice(1))
  const notchPositions: number[] = []

  for (const n of piece.notches) {
    if (n.vertexIndex != null) {
      if (interiorVertices.has(n.vertexIndex)) {
        const idx = ciToIdx.get(n.vertexIndex)
        if (idx != null) notchPositions.push(cumLengths[idx])
      }
    } else {
      const ct = getNotchCurveIndexAndT(n, piece.cutLine)
      if (ct && ciSet.has(ct.curveIndex)) {
        const idx = ciToIdx.get(ct.curveIndex)
        if (idx != null) {
          notchPositions.push(cumLengths[idx] + curveSegmentArcLength(piece.cutLine[ct.curveIndex], 0, ct.t))
        }
      }
    }
  }

  notchPositions.sort((a, b) => a - b)
  const positions = [0, ...notchPositions, totalLen]

  const pointAtArcLen = (L: number): Point => {
    let acc = 0
    for (let i = 0; i < curveIndices.length; i++) {
      const sl = segLengths[i]
      if (acc + sl >= L - 1e-9) {
        const local = Math.max(0, L - acc)
        const c = piece.cutLine[curveIndices[i]]
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
    const last = piece.cutLine[curveIndices[curveIndices.length - 1]]
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
export function getNotchesOnEdge(piece: PatternPiece, curveIndices: number[]): { notchId: string; arcLength: number }[] {
  if (curveIndices.length === 0) return []

  const cumLengths: number[] = [0]
  for (const ci of curveIndices) {
    const seg = piece.cutLine[ci]
    if (!seg) continue
    cumLengths.push(cumLengths[cumLengths.length - 1] + curveSegmentArcLength(seg, 0, 1))
  }

  const ciToIdx = new Map<number, number>()
  for (let i = 0; i < curveIndices.length; i++) ciToIdx.set(curveIndices[i], i)

  const ciSet = new Set(curveIndices)
  const interiorVertices = new Set(curveIndices.slice(1))
  const result: { notchId: string; arcLength: number }[] = []

  for (const n of piece.notches) {
    if (n.vertexIndex != null) {
      if (interiorVertices.has(n.vertexIndex)) {
        const idx = ciToIdx.get(n.vertexIndex)
        if (idx != null) result.push({ notchId: n.id, arcLength: cumLengths[idx] })
      }
    } else {
      const ct = getNotchCurveIndexAndT(n, piece.cutLine)
      if (ct && ciSet.has(ct.curveIndex)) {
        const idx = ciToIdx.get(ct.curveIndex)
        if (idx != null) {
          result.push({ notchId: n.id, arcLength: cumLengths[idx] + curveSegmentArcLength(piece.cutLine[ct.curveIndex], 0, ct.t) })
        }
      }
    }
  }

  result.sort((a, b) => a.arcLength - b.arcLength)
  return result
}

/** Gesamtbogenlänge einer Kante (curveIndices) in mm. */
export function edgeTotalLength(piece: PatternPiece, curveIndices: number[]): number {
  let total = 0
  for (const ci of curveIndices) {
    const seg = piece.cutLine[ci]
    if (seg) total += curveSegmentArcLength(seg, 0, 1)
  }
  return total
}

/**
 * Ermittelt die exakte Vertex-Position, sodass die Kantenlänge targetLength mm ergibt.
 * vertexIndex muss Start oder Ende der Kante sein (curveIndices[0] oder curveIndices[last]+1).
 * Liefert null wenn der Vertex nicht zur Kante gehört oder die Berechnung fehlschlägt.
 */
export function snapVertexToEdgeLength(
  piece: PatternPiece,
  curveIndices: number[],
  vertexIndex: number,
  targetLength: number
): Point | null {
  const n = piece.cutLine.length
  if (curveIndices.length === 0 || n === 0) return null
  const firstCi = curveIndices[0]
  const lastCi = curveIndices[curveIndices.length - 1]
  const startVi = firstCi
  const endVi = (lastCi + 1) % n

  const segs = curveIndices.map((ci) => piece.cutLine[ci]).filter(Boolean)
  if (segs.length === 0) return null

  if (vertexIndex === startVi) {
    let fixed = 0
    for (let i = 1; i < segs.length; i++) {
      fixed += curveSegmentArcLength(segs[i], 0, 1)
    }
    const needFromEnd = Math.max(0, targetLength - fixed)
    const seg0Len = curveSegmentArcLength(segs[0], 0, 1)
    const distFromStart = Math.max(0, seg0Len - needFromEnd)
    const r = pointAtPathLength(segs.slice(0, 1), distFromStart)
    return r?.point ?? null
  }
  if (vertexIndex === endVi) {
    let fixed = 0
    for (let i = 0; i < segs.length - 1; i++) {
      fixed += curveSegmentArcLength(segs[i], 0, 1)
    }
    const needLast = Math.max(0, targetLength - fixed)
    const r = pointAtPathLength(segs.slice(-1), needLast)
    return r?.point ?? null
  }
  return null
}
