/**
 * Kerben-Erkennung aus POLYLINE-Vertices.
 * Basierend auf docs/DXF-MASTER-SPEZIFIKATION.txt Kap. 9–10.
 */

import type { Point } from '../types/model'

export type DxfPoint = { x: number; y: number }

const DEFAULT_SHORT_MAX_MM = 3.0
const DEFAULT_MIN_ANGLE_DEG = 45
/** Mindest-/Höchstgrenzen für importierte Messwerte (mm). */
const DEPTH_MIN = 0.5
const DEPTH_MAX = 50
const WIDTH_MIN = 1
const WIDTH_MAX = 80
const CLOSE_EPS = 0.01

export type NotchDetectOptions = {
  /** Max. Länge der beiden Kerben-Segmente (mm), Standard 3. */
  shortSegmentMaxMm?: number
  /** Min. Knickwinkel an der Spitze (Grad), Standard 45. */
  minAngleDeg?: number
  /**
   * `both`: beide Schenkel ≤ shortMax (Standard).
   * `asymmetric`: kürzerer Schenkel ≤ shortMax, längerer ≤ shortMax × 1.85 (z. B. tessellierte/unruhige DXF).
   */
  legLengthMode?: 'both' | 'asymmetric'
  /**
   * Geschlossene Kontur ohne doppelten Schließpunkt (z. B. DXF 70=1): letzte Kante = letzter → erster.
   * Wenn nicht gesetzt: nur bei fast gleichem erstem/letztem Punkt als Ring behandeln.
   */
  closedRing?: boolean
}

/** Berechnet den Winkel zwischen zwei Vektoren (Grad, 0..180). */
function angleBetweenDeg(ax: number, ay: number, bx: number, by: number): number {
  const dot = ax * bx + ay * by
  const magA = Math.hypot(ax, ay)
  const magB = Math.hypot(bx, by)
  if (magA < 1e-10 || magB < 1e-10) return 0
  const cos = Math.max(-1, Math.min(1, dot / (magA * magB)))
  return (Math.acos(cos) * 180) / Math.PI
}

function dist(a: DxfPoint, b: DxfPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function signedPolygonArea(vertices: DxfPoint[]): number {
  if (vertices.length < 3) return 0
  let a = 0
  const n = vertices.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    a += vertices[i].x * vertices[j].y - vertices[j].x * vertices[i].y
  }
  return a / 2
}

/**
 * Geschlossene Kontur: doppelten Schließ-Vertex entfernen (letzter ≈ erster).
 */
export function normalizeClosedPolylineVertices(vertices: DxfPoint[]): DxfPoint[] {
  if (vertices.length < 2) return [...vertices]
  const first = vertices[0]
  const last = vertices[vertices.length - 1]
  if (dist(first, last) < CLOSE_EPS) {
    return vertices.length > 1 ? vertices.slice(0, -1) : [...vertices]
  }
  return [...vertices]
}

/**
 * CCW: konvexe Ecke am Tip → Kreuzprodukt > 0; konkave Kerbe (V nach innen) → < 0.
 */
function isConcaveNotchAtTip(
  pPrev: DxfPoint,
  pTip: DxfPoint,
  pNext: DxfPoint,
  polygonAreaSigned: number
): boolean {
  const v0x = pTip.x - pPrev.x
  const v0y = pTip.y - pPrev.y
  const v1x = pNext.x - pTip.x
  const v1y = pNext.y - pTip.y
  const cross = v0x * v1y - v0y * v1x
  const eps = 1e-4
  if (Math.abs(polygonAreaSigned) < 1e-8) return false
  if (polygonAreaSigned > 0) return cross < -eps
  return cross > eps
}

function clampDepthWidth(depth: number, width: number): { depth: number; width: number } {
  return {
    depth: Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, depth)),
    width: Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, width)),
  }
}

export type DetectedNotch = {
  position: Point
  angle: number
  depth: number
  width: number
  /**
   * U-förmige Strich-/Schlitzkerbe (rechteckige Einbuchtung): langer Kantenabschnitt bis zur Kerbe,
   * kurze Schenkel, flacher Boden. Wenn gesetzt, entspricht das Modell `Notch.type === 'single'`.
   */
  isSlit?: boolean
}

function tryDetectNotchAtTip(
  pPrev: DxfPoint,
  pTip: DxfPoint,
  pNext: DxfPoint,
  shortMax: number,
  minAng: number,
  polygonAreaSigned: number | null,
  legLengthMode: 'both' | 'asymmetric' = 'both'
): DetectedNotch | null {
  const seg1 = dist(pPrev, pTip)
  const seg2 = dist(pTip, pNext)
  const v1x = pTip.x - pPrev.x
  const v1y = pTip.y - pPrev.y
  const v2x = pNext.x - pTip.x
  const v2y = pNext.y - pTip.y
  const ang = angleBetweenDeg(v1x, v1y, v2x, v2y)

  const ASYMMETRIC_LONG_LEG = 1.85
  const legTooLong =
    legLengthMode === 'asymmetric'
      ? Math.min(seg1, seg2) > shortMax || Math.max(seg1, seg2) > shortMax * ASYMMETRIC_LONG_LEG
      : seg1 > shortMax || seg2 > shortMax
  if (legTooLong || ang <= minAng) return null

  if (polygonAreaSigned != null) {
    if (!isConcaveNotchAtTip(pPrev, pTip, pNext, polygonAreaSigned)) return null
  }

  const midX = (pPrev.x + pNext.x) / 2
  const midY = (pPrev.y + pNext.y) / 2
  const position: Point = { x: midX, y: midY }
  const inwardAngle = Math.atan2(pTip.y - midY, pTip.x - midX)
  const angle = (inwardAngle * 180) / Math.PI
  const rawDepth = dist({ x: midX, y: midY }, pTip)
  const rawWidth = dist(pPrev, pNext)
  const { depth, width } = clampDepthWidth(rawDepth, rawWidth)

  return { position, angle, depth, width }
}

/** Max. Länge der senkrechten „Ein“- und „Aus“-Schenkel einer Schlitzkerbe (mm). */
const SLIT_LEG_MAX_MM = 10
/** Boden der Schlitzkerbe (mm): typisch Breite der flachen Einbuchtung. */
const SLIT_BOTTOM_MIN_MM = 0.8
const SLIT_BOTTOM_MAX_MM = 35

/**
 * Strich-/Schlitzkerbe (U-Form): b–c und d–e kurz, c–d der flache Boden; a–b bzw. e–f können lang sein
 * (Kontur vor/nach der Kerbe) — deshalb erkennt die reine V-Spitzen-Logik diese Geometrie nicht.
 */
function tryDetectSlitNotchAt(
  ring: DxfPoint[],
  i: number,
  polygonAreaSigned: number
): Omit<DetectedNotch, 'isSlit'> | null {
  const n = ring.length
  if (n < 6) return null
  const ib = i
  const ic = (i + 1) % n
  const id = (i + 2) % n
  const ie = (i + 3) % n
  if (new Set([ib, ic, id, ie]).size < 4) return null

  const b = ring[ib]
  const c = ring[ic]
  const d = ring[id]
  const e = ring[ie]

  const bc = dist(b, c)
  const cd = dist(c, d)
  const de = dist(d, e)

  if (bc > SLIT_LEG_MAX_MM || de > SLIT_LEG_MAX_MM) return null
  if (bc < DEPTH_MIN || de < DEPTH_MIN) return null
  if (cd < SLIT_BOTTOM_MIN_MM || cd > SLIT_BOTTOM_MAX_MM) return null

  /** Konkave Ecken der U-Form sind die inneren Bodenwinkel (c und d), nicht die Schultern b/e. */
  if (!isConcaveNotchAtTip(b, c, d, polygonAreaSigned)) return null
  if (!isConcaveNotchAtTip(c, d, e, polygonAreaSigned)) return null

  const opening = dist(b, e)
  if (opening < WIDTH_MIN * 0.4) return null

  const midOx = (b.x + e.x) / 2
  const midOy = (b.y + e.y) / 2
  const midBx = (c.x + d.x) / 2
  const midBy = (c.y + d.y) / 2
  const position: Point = { x: midOx, y: midOy }
  const rawDepth = dist({ x: midOx, y: midOy }, { x: midBx, y: midBy })
  const rawWidth = opening
  const inwardAngle = Math.atan2(midBy - midOy, midBx - midOx)
  const angle = (inwardAngle * 180) / Math.PI
  const { depth, width } = clampDepthWidth(rawDepth, rawWidth)

  return { position, angle, depth, width }
}

function applySlitNotchesInRing(
  work: DxfPoint[],
  initialPolyArea: number
): { ring: DxfPoint[]; slits: DetectedNotch[] } {
  let ring = work
  let polyArea = initialPolyArea
  const slits: DetectedNotch[] = []
  let guard = 0
  while (ring.length >= 6 && guard < 200) {
    guard++
    const n = ring.length
    let found: Omit<DetectedNotch, 'isSlit'> | null = null
    let start = -1
    for (let i = 0; i < n; i++) {
      const det = tryDetectSlitNotchAt(ring, i, polyArea)
      if (det) {
        found = det
        start = i
        break
      }
    }
    if (!found || start < 0) break
    const rm = new Set<number>([(start + 1) % n, (start + 2) % n])
    ring = ring.filter((_, j) => !rm.has(j))
    slits.push({ ...found, isSlit: true })
    polyArea = signedPolygonArea(ring)
    if (Math.abs(polyArea) < 1e-6) break
  }
  return { ring, slits }
}

function buildRingVertices(vertices: DxfPoint[], options?: NotchDetectOptions): DxfPoint[] {
  if (vertices.length < 3) return [...vertices]
  const explicitClosed = options?.closedRing
  const dupClose =
    vertices.length >= 2 && dist(vertices[0], vertices[vertices.length - 1]) < CLOSE_EPS
  const treatAsRing = explicitClosed === true || (explicitClosed !== false && dupClose)
  if (dupClose) return normalizeClosedPolylineVertices(vertices)
  if (treatAsRing) return [...vertices]
  return [...vertices]
}

function isRingMode(vertices: DxfPoint[], ring: DxfPoint[], options?: NotchDetectOptions): boolean {
  const dupClose =
    vertices.length >= 2 && dist(vertices[0], vertices[vertices.length - 1]) < CLOSE_EPS
  if (dupClose) return ring.length >= 3
  if (options?.closedRing === true) return ring.length >= 3
  return false
}

/**
 * Erkennt geometrische Kerben in einer Vertex-Liste: V-Einbuchtungen (Spitze wird entfernt)
 * sowie U-förmige Strich-/Schlitzkerben (Boden c–d wird entfernt, Sehne b–e).
 */
export function detectNotchesInPolyline(
  vertices: DxfPoint[],
  options?: NotchDetectOptions
): {
  cleanedVertices: DxfPoint[]
  notches: DetectedNotch[]
} {
  const shortMax = options?.shortSegmentMaxMm ?? DEFAULT_SHORT_MAX_MM
  const minAng = options?.minAngleDeg ?? DEFAULT_MIN_ANGLE_DEG
  const legLengthMode = options?.legLengthMode ?? 'both'

  const work = buildRingVertices(vertices, options)
  const ringMode = isRingMode(vertices, work, options)

  if (work.length < 5) return { cleanedVertices: [...vertices], notches: [] }

  const notches: DetectedNotch[] = []
  const tipIndices = new Set<number>()

  if (ringMode && work.length >= 4) {
    const polyArea = signedPolygonArea(work)
    if (Math.abs(polyArea) < 1e-6) return { cleanedVertices: [...vertices], notches: [] }

    let ring = work
    const slitNotches: DetectedNotch[] = []
    if (ring.length >= 6) {
      const slitRes = applySlitNotchesInRing(ring, polyArea)
      ring = slitRes.ring
      slitNotches.push(...slitRes.slits)
    }

    const polyAreaForV = signedPolygonArea(ring)
    const n = ring.length
    let i = 0
    while (i < n) {
      const iPrev = (i - 1 + n) % n
      const iNext = (i + 1) % n
      const detected = tryDetectNotchAtTip(
        ring[iPrev],
        ring[i],
        ring[iNext],
        shortMax,
        minAng,
        polyAreaForV,
        legLengthMode
      )
      if (detected) {
        tipIndices.add(i)
        notches.push(detected)
        i += 2
      } else {
        i++
      }
    }

    const cleanedRing = ring.filter((_, idx) => !tipIndices.has(idx))
    const cleanedVertices = restoreClosingVertex(vertices, cleanedRing)
    return { cleanedVertices, notches: [...slitNotches, ...notches] }
  }

  let i = 1
  while (i < work.length - 1) {
    const detected = tryDetectNotchAtTip(
      work[i - 1],
      work[i],
      work[i + 1],
      shortMax,
      minAng,
      null,
      legLengthMode
    )
    if (detected) {
      tipIndices.add(i)
      notches.push(detected)
      i += 2
    } else {
      i++
    }
  }

  const cleanedVertices = work.filter((_, idx) => !tipIndices.has(idx))
  return { cleanedVertices, notches }
}

/** Wenn Original einen Schließpunkt hatte, denselben Stil am Ende wieder anfügen. */
function restoreClosingVertex(original: DxfPoint[], cleanedRing: DxfPoint[]): DxfPoint[] {
  if (original.length < 2) return cleanedRing
  const hadDup =
    dist(original[0], original[original.length - 1]) < CLOSE_EPS && original.length >= 4
  if (!hadDup || cleanedRing.length === 0) return cleanedRing
  return [...cleanedRing, { ...cleanedRing[0] }]
}
