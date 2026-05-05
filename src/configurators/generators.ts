import type { Curve } from '../types/model'
import type { ConfiguratorKindId, ConfiguratorPartId, ConfiguratorPartParams, GeneratedPartGeometry } from './types'
import { generateFingerJointPanelPolyline, type BoxPanelKind } from '../geometry/laserBox/fingerJoints'

function generateRectCutLine(widthMm: number, heightMm: number): Curve[] {
  const w = Math.max(0.1, widthMm)
  const h = Math.max(0.1, heightMm)
  // Rechteck liegt in lokalen Koordinaten um (0..w, 0..h).
  return [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: w, y: 0 } },
    { type: 'line', start: { x: w, y: 0 }, end: { x: w, y: h } },
    { type: 'line', start: { x: w, y: h }, end: { x: 0, y: h } },
    { type: 'line', start: { x: 0, y: h }, end: { x: 0, y: 0 } },
  ]
}

function generateRockCutLine(params: ConfiguratorPartParams): Curve[] {
  const waistWidthMm = Math.max(1, params.widthMm)
  const rockHeightMm = Math.max(1, params.heightMm)

  const waistToHipMm = Math.max(1, params.waistToHipMm ?? 180)
  const hipWidthMm = Math.max(1, params.hipWidthMm ?? waistWidthMm)
  const hemWidthMm = Math.max(1, params.hemWidthMm ?? hipWidthMm)

  const yWaist = 0
  const yHip = clamp01(waistToHipMm / rockHeightMm) * rockHeightMm
  const yHem = rockHeightMm

  const xWaistL = -waistWidthMm / 2
  const xWaistR = waistWidthMm / 2
  const xHipL = -hipWidthMm / 2
  const xHipR = hipWidthMm / 2
  const xHemL = -hemWidthMm / 2
  const xHemR = hemWidthMm / 2

  // Rounded Grundschnitt: Taillen-/Hüftbereich als geglättete Bezier-Übergänge.
  const curvatureTop = 0.33
  const curvatureMid = 0.26

  const waistBulge = rockHeightMm * 0.02

  const bez = (start: { x: number; y: number }, end: { x: number; y: number }, k: number): Curve => {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const cp1 = { x: start.x + dx * k, y: start.y + dy * k }
    const cp2 = { x: end.x - dx * k, y: end.y - dy * k }
    return { type: 'bezier', start, end, cp1, cp2 }
  }

  return [
    // xWaistL,yWaist -> xHipL,yHip
    bez({ x: xWaistL, y: yWaist }, { x: xHipL, y: yHip }, curvatureTop),
    // xHipL,yHip -> xHemL,yHem
    bez({ x: xHipL, y: yHip }, { x: xHemL, y: yHem }, curvatureMid),
    // unten
    { type: 'line', start: { x: xHemL, y: yHem }, end: { x: xHemR, y: yHem } },
    // xHemR,yHem -> xHipR,yHip
    bez({ x: xHemR, y: yHem }, { x: xHipR, y: yHip }, curvatureMid),
    // xHipR,yHip -> xWaistR,yWaist
    bez({ x: xHipR, y: yHip }, { x: xWaistR, y: yWaist }, curvatureTop),
    // top edge: leicht gekrümmt
    (() => {
      const start = { x: xWaistR, y: yWaist }
      const end = { x: xWaistL, y: yWaist }
      const cp1 = { x: start.x + (end.x - start.x) * 0.33, y: yWaist + waistBulge }
      const cp2 = { x: start.x + (end.x - start.x) * 0.66, y: yWaist + waistBulge }
      return { type: 'bezier', start, end, cp1, cp2 } as Curve
    })(),
  ]
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

function generateRockInternalLines(params: ConfiguratorPartParams): Curve[] {
  const waistWidthMm = Math.max(1, params.widthMm)
  const rockHeightMm = Math.max(1, params.heightMm)
  const waistToHipMm = Math.max(1, params.waistToHipMm ?? 180)

  const yHip = clamp01(waistToHipMm / rockHeightMm) * rockHeightMm
  const yWaist = 0

  const defaultDartLength = yHip * 0.78
  const dartLengthMm = Math.max(1, Math.min(rockHeightMm, params.dartLengthMm ?? defaultDartLength))
  const yTip = yWaist + dartLengthMm

  // Abnäher als interne Linien (AAMA/ASTM Layer INTERNAL).
  // Typisch: 2 Abnäher pro Teil (links/rechts), je Abnäher 2 Kantenlinien (Wedge).
  const leftRatio = clamp01(params.dartPosLeftRatio ?? 0.28)
  const rightRatio = clamp01(params.dartPosRightRatio ?? 0.72)
  const leftTipX = -waistWidthMm / 2 + waistWidthMm * leftRatio
  const rightTipX = -waistWidthMm / 2 + waistWidthMm * rightRatio
  const dartOpening = Math.max(1, params.dartOpeningMm ?? waistWidthMm * 0.06)

  const leftStartL = leftTipX - dartOpening
  const leftStartR = leftTipX + dartOpening
  const rightStartL = rightTipX - dartOpening
  const rightStartR = rightTipX + dartOpening

  return [
    { type: 'line', start: { x: leftStartL, y: yWaist }, end: { x: leftTipX, y: yTip } },
    { type: 'line', start: { x: leftStartR, y: yWaist }, end: { x: leftTipX, y: yTip } },
    { type: 'line', start: { x: rightStartL, y: yWaist }, end: { x: rightTipX, y: yTip } },
    { type: 'line', start: { x: rightStartR, y: yWaist }, end: { x: rightTipX, y: yTip } },
  ]
}

function polylineToClosedCutLine(points: Array<{ x: number; y: number }>): Curve[] {
  const curves: Curve[] = []
  if (points.length < 2) return curves
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    curves.push({ type: 'line', start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y } })
  }
  return curves
}

function resolveLaserBoxPanelSize(partId: ConfiguratorPartId, params: ConfiguratorPartParams): { w: number; h: number } {
  const boxW = Math.max(1, params.boxWidthMm ?? params.widthMm)
  const boxL = Math.max(1, params.boxLengthMm ?? params.widthMm)
  const boxH = Math.max(1, params.boxHeightMm ?? params.heightMm)
  if (partId === 'front' || partId === 'back') return { w: boxW, h: boxH }
  if (partId === 'left' || partId === 'right') return { w: boxL, h: boxH }
  return { w: boxW, h: boxL }
}

function generateLaserBoxCutLine(partId: ConfiguratorPartId, params: ConfiguratorPartParams): Curve[] {
  const panel = (partId === 'front' || partId === 'back' || partId === 'left' || partId === 'right' || partId === 'bottom'
    ? partId
    : 'front') as BoxPanelKind
  const size = resolveLaserBoxPanelSize(panel, params)
  const polyline = generateFingerJointPanelPolyline({
    panel,
    widthMm: size.w,
    heightMm: size.h,
    materialThicknessMm: Math.max(0.5, params.materialThicknessMm ?? 3),
    fingerCount: Math.max(3, params.fingerCount ?? 7),
    kerfMm: Math.max(0, params.kerfMm ?? 0.15),
    fitToleranceMm: params.fitToleranceMm ?? 0,
    openTop: Boolean(params.openTop),
    openBottom: Boolean(params.openBottom),
  })
  return polylineToClosedCutLine(polyline)
}

const KIND_LABELS: Record<ConfiguratorKindId, string> = {
  tshirt: 'T-Shirt',
  rock: 'Rock',
  laserBox: 'Laser-Box',
}

const PART_LABELS: Record<ConfiguratorPartId, string> = {
  front: 'Vorderteil',
  back: 'Rückenteil',
  left: 'Seite links',
  right: 'Seite rechts',
  bottom: 'Boden',
}

export function generateConfiguratorPartGeometry(
  kindId: ConfiguratorKindId,
  partId: ConfiguratorPartId,
  params: ConfiguratorPartParams,
): GeneratedPartGeometry {
  const pieceName = `${KIND_LABELS[kindId]} ${PART_LABELS[partId]}`
  const cutLine =
    kindId === 'rock'
      ? generateRockCutLine(params)
      : kindId === 'laserBox'
        ? generateLaserBoxCutLine(partId, params)
        : generateRectCutLine(params.widthMm, params.heightMm)
  const internalLines = kindId === 'rock' ? generateRockInternalLines(params) : []

  return {
    pieceName,
    cutLine,
    internalLines,
    transform: {
      x: params.offsetX,
      y: params.offsetY,
      rotation: 0,
      mirrored: false,
    },
  }
}

