import type { Point } from '../../types/model'

export type BoxPanelKind = 'front' | 'back' | 'left' | 'right' | 'bottom'
type EdgeName = 'top' | 'right' | 'bottom' | 'left'

export type LaserBoxPanelInput = {
  panel: BoxPanelKind
  widthMm: number
  heightMm: number
  materialThicknessMm: number
  fingerCount: number
  kerfMm: number
  fitToleranceMm: number
  openTop: boolean
  openBottom: boolean
}

const EPS = 1e-6

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function ensureOddAtLeastThree(n: number): number {
  const i = Math.max(3, Math.round(n))
  return i % 2 === 0 ? i + 1 : i
}

export function normalizeFingerCount(requested: number, edgeLengthMm: number, materialThicknessMm: number): number {
  const minFingerWidth = Math.max(2.5, materialThicknessMm * 1.2)
  const maxCountByWidth = Math.max(3, Math.floor(edgeLengthMm / minFingerWidth))
  const wantedOdd = ensureOddAtLeastThree(requested)
  const capped = Math.min(wantedOdd, maxCountByWidth)
  return capped % 2 === 0 ? Math.max(3, capped - 1) : capped
}

function edgeSignMap(panel: BoxPanelKind): Record<EdgeName, number> {
  switch (panel) {
    case 'front':
      return { top: 1, right: -1, bottom: -1, left: 1 }
    case 'back':
      return { top: -1, right: 1, bottom: 1, left: -1 }
    case 'left':
      return { top: -1, right: -1, bottom: 1, left: 1 }
    case 'right':
      return { top: 1, right: 1, bottom: -1, left: -1 }
    case 'bottom':
      return { top: 1, right: -1, bottom: 1, left: -1 }
  }
}

function pushIfChanged(points: Point[], next: Point): void {
  const last = points[points.length - 1]
  if (!last || Math.abs(last.x - next.x) > EPS || Math.abs(last.y - next.y) > EPS) points.push(next)
}

function pushFingerEdge(
  points: Point[],
  start: Point,
  end: Point,
  edgeName: EdgeName,
  fingerCount: number,
  fingerDepth: number,
  baseSign: number,
): void {
  const isHorizontal = Math.abs(start.y - end.y) < EPS
  const isVertical = Math.abs(start.x - end.x) < EPS
  if (!isHorizontal && !isVertical) {
    pushIfChanged(points, end)
    return
  }

  const count = Math.max(3, fingerCount)
  const dx = end.x - start.x
  const dy = end.y - start.y
  const len = Math.hypot(dx, dy)
  if (len < EPS) return
  const step = len / count
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux

  const orientedSign = edgeName === 'top' || edgeName === 'right' ? -1 : 1
  for (let i = 0; i < count; i++) {
    const segStart = {
      x: start.x + ux * (step * i),
      y: start.y + uy * (step * i),
    }
    const xB = start.x + ux * (step * (i + 1))
    const yB = start.y + uy * (step * (i + 1))
    const toothSign = i % 2 === 0 ? 1 : -1
    const offset = baseSign * toothSign * orientedSign * fingerDepth
    const segStartOffset = { x: segStart.x + nx * offset, y: segStart.y + ny * offset }
    const segEndOffset = { x: xB + nx * offset, y: yB + ny * offset }
    pushIfChanged(points, segStartOffset)
    pushIfChanged(points, segEndOffset)
    pushIfChanged(points, { x: xB, y: yB })
  }
}

export function generateFingerJointPanelPolyline(input: LaserBoxPanelInput): Point[] {
  const widthMm = Math.max(1, input.widthMm)
  const heightMm = Math.max(1, input.heightMm)
  const thickness = clamp(input.materialThicknessMm, 0.5, 50)
  // Anforderung: Finger-Tiefe entspricht immer exakt der Materialstärke.
  const depth = thickness
  const normalizedCount = normalizeFingerCount(input.fingerCount, Math.min(widthMm, heightMm), thickness)
  const signs = edgeSignMap(input.panel)
  const topSign = input.openTop ? 0 : signs.top
  const bottomSign = input.openBottom ? 0 : signs.bottom

  const a = { x: 0, y: 0 }
  const b = { x: widthMm, y: 0 }
  const c = { x: widthMm, y: heightMm }
  const d = { x: 0, y: heightMm }

  const points: Point[] = [{ ...a }]
  pushFingerEdge(points, a, b, 'top', normalizedCount, depth, topSign)
  pushFingerEdge(points, b, c, 'right', normalizedCount, depth, signs.right)
  pushFingerEdge(points, c, d, 'bottom', normalizedCount, depth, bottomSign)
  pushFingerEdge(points, d, a, 'left', normalizedCount, depth, signs.left)
  pushIfChanged(points, a)
  return points
}
