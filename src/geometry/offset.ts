import type { Curve, Point } from '../types/model'
import { bezierAt, outwardNormalAngleAt, signedAreaCurves, curvesBounds } from './curveToPath'
import { samePoint } from './geometryConstants'
// @ts-expect-error clipper-lib has no types
import ClipperLib from 'clipper-lib'

/** Höhere Auflösung reduziert sichtbare „Stufen“ bei Nahtzugabe (Clipper arbeitet mit Integer-Koordinaten). */
const SCALE = 100000

/**
 * Clipper `MiterLimit` relativ zur Nahtzugabe (Offset-Distanz d).
 * Sehr hohe Werte (z. B. 50) lassen bei spitzen Winkeln extrem lange Miter-Spitzen zu.
 * Typisch 2–4: Überschreitung → Bevel (Ecke wird „abgeschnitten“, wie im Textil-/CAD-Standard).
 * Nur die abgeleitete Schnittkontur (cutLine), nicht die Nahtlinie.
 */
export const CLIPPER_MITER_LIMIT_NAHTZUGABE_OFFSET = 3

type IntPoint = { X: number; Y: number }

function toIntPoint(p: Point): IntPoint {
  return new ClipperLib.IntPoint2(Math.round(p.x * SCALE), Math.round(p.y * SCALE))
}

function fromIntPoint(ip: IntPoint): Point {
  return { x: ip.X / SCALE, y: ip.Y / SCALE }
}

const BEZIER_SAMPLES = 64
/** Höhere Abtastung nur für Selbstüberschneidungs-Checks (Bézier kann sonst „durchrutschen“). */
const BEZIER_SAMPLES_VALIDATION = 128

export type OffsetOptions = {
  joinType?: 'miter' | 'round' | 'square'
  miterLimit?: number
  /** Douglas-Peucker Toleranz (mm); kleiner = Eckpunkte bleiben erhalten */
  simplifyTolerance?: number
  /**
   * Tangentialer Außen-Fillet (Industrie: R = d/tan(φ/2)) nur an echten Naht-Ecken (curveIndex-Wechsel).
   * Kein generisches „Ecken rundmachen“ (weder Clipper jtRound noch willkürliche Radien); bei true wird
   * Douglas-Peucker auf der Schnittkontur unterdrückt, damit Tangentialität und Radius nicht verwischt werden.
   */
  cutCornerFillet?: boolean
}

/** Kurven in Punktliste umwandeln; Bézier wird fein abgetastet, damit die Naht oben der Kurve folgt. */
function curvesToPoints(curves: Curve[], bezierSamples: number = BEZIER_SAMPLES): Point[] {
  const out: Point[] = []
  for (const c of curves) {
    if (c.type === 'line') {
      if (out.length === 0 || !samePoint(out[out.length - 1], c.start)) {
        out.push({ ...c.start })
      }
      out.push({ ...c.end })
    } else {
      if (out.length === 0 || !samePoint(out[out.length - 1], c.start)) {
        out.push({ ...c.start })
      }
      const bs = Math.max(8, bezierSamples)
      for (let i = 1; i < bs; i++) {
        out.push(bezierAt(c, i / bs))
      }
      out.push({ ...c.end })
    }
  }
  return out
}

/** Convert points to line segments (Curve[]). */
function pointsToLineCurves(pts: Point[]): Curve[] {
  const out: Curve[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    out.push({ type: 'line', start: pts[i], end: pts[i + 1] })
  }
  return out
}

/** Douglas-Peucker: reduces a point list while keeping the shape within tolerance. */
function simplifyPoints(pts: Point[], tolerance: number): Point[] {
  if (pts.length <= 2) return pts
  let maxDist = 0
  let maxIdx = 0
  const first = pts[0]
  const last = pts[pts.length - 1]
  const dx = last.x - first.x
  const dy = last.y - first.y
  const lenSq = dx * dx + dy * dy
  for (let i = 1; i < pts.length - 1; i++) {
    let dist: number
    if (lenSq < 1e-12) {
      dist = Math.hypot(pts[i].x - first.x, pts[i].y - first.y)
    } else {
      const t = ((pts[i].x - first.x) * dx + (pts[i].y - first.y) * dy) / lenSq
      const projX = first.x + t * dx
      const projY = first.y + t * dy
      dist = Math.hypot(pts[i].x - projX, pts[i].y - projY)
    }
    if (dist > maxDist) {
      maxDist = dist
      maxIdx = i
    }
  }
  if (maxDist > tolerance) {
    const left = simplifyPoints(pts.slice(0, maxIdx + 1), tolerance)
    const right = simplifyPoints(pts.slice(maxIdx), tolerance)
    return [...left.slice(0, -1), ...right]
  }
  return [first, last]
}

/** Simplify a closed polygon: apply Douglas-Peucker on the ring. */
function simplifyClosedPolygon(pts: Point[], tolerance: number): Point[] {
  if (pts.length <= 3) return pts
  // Find the point farthest from pt[0] as second anchor for splitting the ring
  let maxDist = 0
  let splitIdx = Math.floor(pts.length / 2)
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y)
    if (d > maxDist) { maxDist = d; splitIdx = i }
  }
  const half1 = simplifyPoints(pts.slice(0, splitIdx + 1), tolerance)
  const half2 = simplifyPoints([...pts.slice(splitIdx), pts[0]], tolerance)
  const result = [...half1.slice(0, -1), ...half2.slice(0, -1)]
  return result.length >= 3 ? result : pts
}

/** Kurven zu geschlossener Polylinie (z. B. Clipper-Boolean). */
export function tessellateCurvesToPoints(curves: Curve[], bezierSamples: number = BEZIER_SAMPLES): Point[] {
  return curvesToPoints(curves, bezierSamples)
}

/** Geschlossene Punktliste → `Curve[]` inkl. schließendem Segment; optional Douglas-Peucker. */
export function closedPointsToLineCurves(pts: Point[], simplifyToleranceMm: number = 0.15): Curve[] {
  if (pts.length < 3) return []
  let ring = [...pts]
  if (ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])) ring.pop()
  if (simplifyToleranceMm > 0) ring = simplifyClosedPolygon(ring, simplifyToleranceMm)
  if (ring.length < 3) return []
  const segs = pointsToLineCurves(ring)
  segs.push({ type: 'line', start: ring[ring.length - 1], end: ring[0] })
  return segs
}

export type ClipperOffsetClosedResult = {
  lineCurves: Curve[]
  /** Anzahl geschlossener Pfade in der Clipper-Lösung (>1 oft bei Selbstüberschneidung / Kollaps). */
  solutionPathCount: number
}

/**
 * Clipper-Offset einer geschlossenen Kontur; liefert Segmentanzahl der Lösung für Validierung (Seam-as-Master).
 */
export function clipperOffsetClosedPolygon(
  curves: Curve[],
  deltaMm: number,
  options?: OffsetOptions
): ClipperOffsetClosedResult {
  if (curves.length === 0) {
    return { lineCurves: [], solutionPathCount: 0 }
  }
  const pts = curvesToPoints(curves)
  if (pts.length < 3) {
    return { lineCurves: [], solutionPathCount: 0 }
  }
  const path = pts.map(toIntPoint)
  const co = new ClipperLib.ClipperOffset()
  const jt = options?.joinType === 'miter' ? ClipperLib.JoinType.jtMiter
    : options?.joinType === 'square' ? ClipperLib.JoinType.jtSquare
    : ClipperLib.JoinType.jtRound
  if (options?.miterLimit != null) co.MiterLimit = options.miterLimit
  co.AddPath(path, jt, ClipperLib.EndType.etClosedPolygon)
  const solution: IntPoint[][] = []
  co.Execute(solution, deltaMm * SCALE)
  const solutionPathCount = solution.length
  if (solution.length === 0 || solution[0].length < 2) {
    return { lineCurves: [], solutionPathCount }
  }
  let outPts = solution[0].map(fromIntPoint)
  if (outPts.length > 1 && outPts[0].x === outPts[outPts.length - 1].x && outPts[0].y === outPts[outPts.length - 1].y) {
    outPts.pop()
  }
  const tol = options?.simplifyTolerance ?? 0.15
  if (tol > 0) {
    outPts = simplifyClosedPolygon(outPts, tol)
  }
  const segs = pointsToLineCurves(outPts)
  if (outPts.length >= 3) {
    segs.push({ type: 'line', start: outPts[outPts.length - 1], end: outPts[0] })
  }
  return { lineCurves: segs, solutionPathCount }
}

/**
 * Offset a closed path by delta mm (positive = outward).
 * Uses clipper-lib; curves are flattened to line segments.
 * Default join type is round (besser für Textil-Schnittmuster).
 */
export function offsetCurves(curves: Curve[], deltaMm: number, options?: OffsetOptions): Curve[] {
  return clipperOffsetClosedPolygon(curves, deltaMm, options).lineCurves
}


/** Kontur umkehren (Umlaufsinn wechseln): Segmentreihenfolge und Start/Ende pro Segment. */
function reverseCurves(curves: Curve[]): Curve[] {
  if (curves.length === 0) return []
  const out: Curve[] = []
  for (let i = curves.length - 1; i >= 0; i--) {
    const c = curves[i]
    if (c.type === 'line') {
      out.push({ type: 'line', start: { ...c.end }, end: { ...c.start } })
    } else {
      out.push({
        type: 'bezier',
        start: { ...c.end },
        end: { ...c.start },
        cp1: { ...c.cp2 },
        cp2: { ...c.cp1 },
      })
    }
  }
  return out
}

/**
 * Nahtlinie (seamLine) aus der Schnittlinie (cutLine):
 * Offset nach INNEN um die Nahtzugabe. Gleichmäßiger Abstand durch Clipper.
 * Clipper garantiert konstante Distanz – kein Dünnerwerden an Ecken/Kurven.
 */
/** Douglas-Peucker nach Clipper-Offset: zu klein → sehr viele fast kollineare Punkte (viele rote Eckpunkte in der UI); zu groß → echte Ecken können mitziehen. */
const SEAM_FROM_CUT_SIMPLIFY_MM = 0.22
/** Stärkere Vereinfachung z. B. für DXF-Import: stabilere Naht für deriveCutLineFromSeam. */
export const SEAM_FROM_CUT_SIMPLIFY_IMPORT_MM = 0.42

export function offsetCurvesInwardForSeam(
  cutLine: Curve[],
  seamAllowanceMm: number,
  simplifyToleranceMm: number = SEAM_FROM_CUT_SIMPLIFY_MM
): Curve[] {
  if (cutLine.length === 0 || seamAllowanceMm <= 0) return []
  // Keine Vereinfachung (0), damit Ecken beim Vertex-Ziehen nicht wegfallen und das Teil nicht „verzieht“
  // Leichte Vereinfachung: reduziert künstliche „Eckpunkte“ auf glatten Naht-Verläufen
  // (Bézier→Clipper), ohne echte Ecken zu zerstören (Toleranz klein).
  const raw = offsetCurves(cutLine, -seamAllowanceMm, {
    joinType: 'miter',
    miterLimit: CLIPPER_MITER_LIMIT_NAHTZUGABE_OFFSET,
    simplifyTolerance: simplifyToleranceMm,
  })
  if (raw.length === 0) return []
  const cutArea = signedAreaCurves(cutLine)
  const seamArea = signedAreaCurves(raw)
  const oriented = cutArea * seamArea < 0 ? reverseCurves(raw) : raw
  return alignClosedCurveStart(oriented, cutLine[0].start)
}

/**
 * Schnittlinie (cutLine) aus der Nahtlinie (seamLine):
 * Offset nach AUSSEN um die Nahtzugabe. Die bestehende Kontur bleibt die Nahtlinie,
 * die CutLine wird zusätzlich nach außen hinzugefügt.
 */
export function offsetCurvesOutwardForCut(seamLine: Curve[], seamAllowanceMm: number): Curve[] {
  if (seamLine.length === 0 || seamAllowanceMm <= 0) return []
  const { lineCurves: raw } = clipperOffsetClosedPolygon(seamLine, seamAllowanceMm, {
    joinType: 'miter',
    miterLimit: CLIPPER_MITER_LIMIT_NAHTZUGABE_OFFSET,
    simplifyTolerance: 0.06,
  })
  if (raw.length === 0) return []
  const seamArea = signedAreaCurves(seamLine)
  const cutArea = signedAreaCurves(raw)
  const oriented = seamArea * cutArea < 0 ? reverseCurves(raw) : raw
  return alignClosedCurveStart(oriented, seamLine[0].start)
}

/**
 * Rotiert eine geschlossene Kurvenliste, sodass der Startpunkt dem Referenzpunkt am nächsten liegt.
 * Clipper-Offset ändert den Startpunkt; diese Funktion stellt die Ausrichtung zur Quellkontur wieder her.
 */
function alignClosedCurveStart(curves: Curve[], referenceStart: Point): Curve[] {
  if (curves.length <= 1) return curves
  let bestIdx = 0
  let bestDist = Infinity
  for (let i = 0; i < curves.length; i++) {
    const d = Math.hypot(curves[i].start.x - referenceStart.x, curves[i].start.y - referenceStart.y)
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  if (bestIdx === 0) return curves
  return [...curves.slice(bestIdx), ...curves.slice(0, bestIdx)]
}

/** Mindestlänge eines Naht-Segments (Start–Ende); darunter ist der Clipper-Offset unzuverlässig. */
const MIN_SEAM_SEGMENT_LEN_MM = 0.03

const EPS_CROSS = 1e-9

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx
}

function segmentIntersectionProper(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point
): boolean {
  const d1x = a2.x - a1.x
  const d1y = a2.y - a1.y
  const d2x = b2.x - b1.x
  const d2y = b2.y - b1.y
  const den = cross(d1x, d1y, d2x, d2y)
  if (Math.abs(den) < EPS_CROSS) return false
  const t = cross(b1.x - a1.x, b1.y - a1.y, d2x, d2y) / den
  const u = cross(b1.x - a1.x, b1.y - a1.y, d1x, d1y) / den
  return t > EPS_CROSS && t < 1 - EPS_CROSS && u > EPS_CROSS && u < 1 - EPS_CROSS
}

/** Prüft, ob ein geschlossener Polygonzug (ohne doppelten Schlusspunkt) sich selbst schneidet. */
export function closedPolylineSelfIntersects(pts: Point[]): boolean {
  const n = pts.length
  if (n < 4) return false
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n
    const a1 = pts[i]
    const a2 = pts[i2]
    for (let j = i + 1; j < n; j++) {
      const j2 = (j + 1) % n
      if (i2 === j || j2 === i) continue
      const b1 = pts[j]
      const b2 = pts[j2]
      if (segmentIntersectionProper(a1, a2, b1, b2)) return true
    }
  }
  return false
}

/** V liegt auf der offenen Strecke AB (nicht in den Endpunkten); verhindert T-Kreuzungen ohne „proper“ Schnitt. */
function pointOnOpenSegment(v: Point, a: Point, b: Point, eps: number): boolean {
  if (samePoint(v, a, eps) || samePoint(v, b, eps)) return false
  const cross = Math.abs((b.x - a.x) * (v.y - a.y) - (b.y - a.y) * (v.x - a.x))
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  if (len < eps) return false
  if (cross > eps * len * 4) return false
  const dot = (v.x - a.x) * (b.x - a.x) + (v.y - a.y) * (b.y - a.y)
  const lenSq = len * len
  return dot > eps * len && dot < lenSq - eps * len
}

/** Ein Eckpunkt liegt auf einer nicht benachbarten Kante (T-Kreuzung). */
function polygonVertexOnNonAdjacentEdge(vertices: Point[], eps: number): boolean {
  const n = vertices.length
  if (n < 4) return false
  for (let vi = 0; vi < n; vi++) {
    const v = vertices[vi]
    for (let ej = 0; ej < n; ej++) {
      if (ej === (vi - 1 + n) % n || ej === vi) continue
      const a = vertices[ej]
      const b = vertices[(ej + 1) % n]
      if (pointOnOpenSegment(v, a, b, eps)) return true
    }
  }
  return false
}

function minChordLengthMm(curves: Curve[]): number {
  let m = Infinity
  for (const c of curves) {
    const len =
      c.type === 'line'
        ? Math.hypot(c.end.x - c.start.x, c.end.y - c.start.y)
        : Math.hypot(c.end.x - c.start.x, c.end.y - c.start.y)
    if (len < m) m = len
  }
  return m === Infinity ? 0 : m
}

/** Mindestkante beim Verschieben von Eckpunkten (mm); darunter numerische Artefakte und Clipper-Fehler. */
export const MIN_VERTEX_EDGE_LENGTH_MM = 0.12

/** Fläche unterhalb derer die Kontur als kollabiert gilt (mm²). */
const MIN_POLYGON_SIGNED_AREA_MM2 = 0.05

/**
 * Prüft Kontur nach Verschieben eines Eckpunkts (oder ähnlicher Edit): keine Nullkanten, keine Selbstüberschneidung.
 * Verhindert „zerreißende“ Teile, wenn eine Ecke über eine andere oder durch die Kontur gezogen wird.
 */
export function validateContourAfterVertexMove(
  curves: Curve[]
): { ok: true } | { ok: false; message: string } {
  if (curves.length < 3) {
    return { ok: false, message: 'Kontur hat zu wenig Segmente.' }
  }
  const minChord = minChordLengthMm(curves)
  if (minChord < MIN_VERTEX_EDGE_LENGTH_MM) {
    return {
      ok: false,
      message: `Kante zu kurz (< ${MIN_VERTEX_EDGE_LENGTH_MM} mm); Ziehen nicht möglich.`,
    }
  }
  const areaAbs = Math.abs(signedAreaCurves(curves))
  if (areaAbs < MIN_POLYGON_SIGNED_AREA_MM2) {
    return { ok: false, message: 'Kontur ist zu klein oder entartet; Ziehen nicht möglich.' }
  }
  const cornerEps = 0.08
  const corners = curves.map((c) => ({ ...c.start }))
  if (corners.length >= 4 && polygonVertexOnNonAdjacentEdge(corners, cornerEps)) {
    return { ok: false, message: 'Ecke liegt auf einer gegenüberliegenden Kante; Ziehen nicht möglich.' }
  }
  const flat = curvesToPoints(curves, BEZIER_SAMPLES_VALIDATION)
  if (flat.length >= 4) {
    const ring = [...flat]
    if (ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])) ring.pop()
    if (ring.length >= 4 && closedPolylineSelfIntersects(ring)) {
      return { ok: false, message: 'Kontur überschneidet sich; Ziehen nicht möglich.' }
    }
  }
  return { ok: true }
}

export type DeriveCutLineFromSeamResult =
  | { ok: true; cutLine: Curve[] }
  | { ok: false; message: string }

export type DeriveCutLineFromSeamOptions = {
  /** Nur bei `true`: tangentialer Fillet an Naht-Ecken. Standard: Clipper-Miter (scharf). */
  cutCornerFillet?: boolean
}

/**
 * Schnittlinie aus Nahtlinie (Seam-as-Master): Offset nur übernehmen, wenn die Lösung plausibel ist.
 * Bei Fehler: keine stillschweigende „kaputte“ Kontur — Aufrufer soll Zustand nicht ändern und Hinweis zeigen.
 */
export function deriveCutLineFromSeamWithValidation(
  seamLine: Curve[],
  seamAllowanceMm: number,
  deriveOptions?: DeriveCutLineFromSeamOptions
): DeriveCutLineFromSeamResult {
  if (seamLine.length < 3 || seamAllowanceMm <= 0) {
    return { ok: false, message: 'Nahtlinie ungültig oder Nahtzugabe fehlt.' }
  }

  const allowanceCheck = validateSeamAllowance(seamLine, seamAllowanceMm)
  if (!allowanceCheck.valid) {
    return {
      ok: false,
      message: allowanceCheck.warning ?? 'Nahtzugabe passt nicht zur Nahtlinie (z. B. größer als möglicher Radius / Kontur).',
    }
  }

  const minChord = minChordLengthMm(seamLine)
  if (minChord < MIN_SEAM_SEGMENT_LEN_MM) {
    return {
      ok: false,
      message: `Nahtlinie hat sehr kurze Segmente (< ${MIN_SEAM_SEGMENT_LEN_MM} mm); Offset wird nicht angewendet.`,
    }
  }

  const seamFlat = curvesToPoints(seamLine)
  if (seamFlat.length >= 4) {
    const ring = [...seamFlat]
    if (ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])) ring.pop()
    if (ring.length >= 4 && closedPolylineSelfIntersects(ring)) {
      return {
        ok: false,
        message: 'Nahtlinie überschneidet sich; Offset wird nicht angewendet.',
      }
    }
  }

  const useFillet = deriveOptions?.cutCornerFillet === true
  let raw: Curve[]
  if (useFillet) {
    const allowanceMap = new Map<number, number>()
    for (let ci = 0; ci < seamLine.length; ci++) allowanceMap.set(ci, seamAllowanceMm)
    const poly = offsetClosedPolygonVariable(seamLine, allowanceMap, {
      joinType: 'miter',
      miterLimit: CLIPPER_MITER_LIMIT_NAHTZUGABE_OFFSET,
      simplifyTolerance: 0.06,
      cutCornerFillet: true,
    })
    if (!poly.success || poly.lineCurves.length < 3) {
      return {
        ok: false,
        message: 'Nahtzugabe-Offset ergab keine gültige Schnittkontur. Änderung verworfen.',
      }
    }
    raw = poly.lineCurves
  } else {
    const clip = clipperOffsetClosedPolygon(seamLine, seamAllowanceMm, {
      joinType: 'miter',
      miterLimit: CLIPPER_MITER_LIMIT_NAHTZUGABE_OFFSET,
      /** 0: keine DP-Vereinfachung — scharfe Miter-Ecken bleiben erhalten (reine Nahtzugabe). */
      simplifyTolerance: 0,
    })
    if (clip.solutionPathCount !== 1) {
      return {
        ok: false,
        message:
          'Nahtzugabe-Offset liefert mehrere getrennte Konturen (enge Radien oder Selbstüberschneidung). Änderung verworfen.',
      }
    }
    if (clip.lineCurves.length < 3) {
      return {
        ok: false,
        message: 'Nahtzugabe-Offset ergab keine gültige Schnittkontur. Änderung verworfen.',
      }
    }
    raw = clip.lineCurves
  }

  let cutLine = raw
  const seamArea = signedAreaCurves(seamLine)
  const cutAreaSigned = signedAreaCurves(cutLine)
  if (seamArea * cutAreaSigned < 0) {
    cutLine = reverseCurves(cutLine)
  }
  cutLine = alignClosedCurveStart(cutLine, seamLine[0].start)

  const cutArea = Math.abs(signedAreaCurves(cutLine))
  const seamAreaAbs = Math.abs(seamArea)
  if (seamAreaAbs >= 1 && cutArea < seamAreaAbs * 0.88) {
    return {
      ok: false,
      message: 'Schnittkontur nach Offset zu klein (Kollaps oder Nahtzugabe zu groß für die Radien). Änderung verworfen.',
    }
  }

  const cutPts = curvesToPoints(cutLine)
  if (cutPts.length >= 4) {
    const ring = [...cutPts]
    if (ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])) ring.pop()
    if (ring.length >= 4 && closedPolylineSelfIntersects(ring)) {
      return {
        ok: false,
        message: 'Schnittkontur nach Offset ist selbstüberschneidend. Änderung verworfen.',
      }
    }
  }

  return { ok: true, cutLine }
}

/**
 * Schnittlinie aus Nahtlinie mit variablen Nahtzugaben pro Kante.
 * `allowancePerCurveIndex` ordnet jedem curveIndex der seamLine seine Nahtzugabe zu.
 * Gleiche Validierungsschritte wie `deriveCutLineFromSeamWithValidation`.
 */
export function deriveCutLineFromSeamWithVariableAllowance(
  seamLine: Curve[],
  allowancePerCurveIndex: Map<number, number>,
  maxAllowanceMm: number,
  deriveOptions?: DeriveCutLineFromSeamOptions
): DeriveCutLineFromSeamResult {
  if (seamLine.length < 3) {
    return { ok: false, message: 'Nahtlinie ungültig.' }
  }

  if (maxAllowanceMm > 0) {
    const allowanceCheck = validateSeamAllowance(seamLine, maxAllowanceMm)
    if (!allowanceCheck.valid) {
      return {
        ok: false,
        message: allowanceCheck.warning ?? 'Nahtzugabe passt nicht zur Nahtlinie.',
      }
    }
  }

  const minChord = minChordLengthMm(seamLine)
  if (minChord < MIN_SEAM_SEGMENT_LEN_MM) {
    return {
      ok: false,
      message: `Nahtlinie hat sehr kurze Segmente (< ${MIN_SEAM_SEGMENT_LEN_MM} mm); Offset wird nicht angewendet.`,
    }
  }

  const seamFlat = curvesToPoints(seamLine)
  if (seamFlat.length >= 4) {
    const ring = [...seamFlat]
    if (ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])) ring.pop()
    if (ring.length >= 4 && closedPolylineSelfIntersects(ring)) {
      return {
        ok: false,
        message: 'Nahtlinie überschneidet sich; Offset wird nicht angewendet.',
      }
    }
  }

  const useFilletVar = deriveOptions?.cutCornerFillet === true
  const { lineCurves: raw, success } = offsetClosedPolygonVariable(seamLine, allowancePerCurveIndex, {
    joinType: 'miter',
    miterLimit: CLIPPER_MITER_LIMIT_NAHTZUGABE_OFFSET,
    simplifyTolerance: useFilletVar ? 0.06 : 0,
    cutCornerFillet: useFilletVar,
  })

  if (!success || raw.length < 3) {
    return {
      ok: false,
      message: 'Variabler Nahtzugabe-Offset ergab keine gültige Schnittkontur. Änderung verworfen.',
    }
  }

  let cutLine = raw
  const seamArea = signedAreaCurves(seamLine)
  const cutAreaSigned = signedAreaCurves(cutLine)
  if (seamArea * cutAreaSigned < 0) {
    cutLine = reverseCurves(cutLine)
  }
  cutLine = alignClosedCurveStart(cutLine, seamLine[0].start)

  const cutArea = Math.abs(signedAreaCurves(cutLine))
  const seamAreaAbs = Math.abs(seamArea)
  if (seamAreaAbs >= 1 && cutArea < seamAreaAbs * 0.5) {
    return {
      ok: false,
      message: 'Schnittkontur nach variablem Offset zu klein (Kollaps). Änderung verworfen.',
    }
  }

  const cutPts = curvesToPoints(cutLine)
  if (cutPts.length >= 4) {
    const ring = [...cutPts]
    if (ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])) ring.pop()
    if (ring.length >= 4 && closedPolylineSelfIntersects(ring)) {
      return {
        ok: false,
        message: 'Schnittkontur nach variablem Offset ist selbstüberschneidend. Änderung verworfen.',
      }
    }
  }

  return { ok: true, cutLine }
}

/**
 * Einzelnes Segment um deltaMm in Außenrichtung verschieben.
 * Für Linien: einheitliche Verschiebung entlang Mittennormale.
 * Für Bézier: Start/cp1 entlang Startnormale, cp2/Ende entlang Endnormale (paralleler Offset).
 */
export function offsetSegmentPoints(
  curves: Curve[],
  curveIndex: number,
  deltaMm: number
): { start: Point; end: Point; cp1?: Point; cp2?: Point } | null {
  if (curveIndex < 0 || curveIndex >= curves.length) return null
  const c = curves[curveIndex]
  if (c.type === 'line') {
    const angleDeg = outwardNormalAngleAt(curves, curveIndex, 0.5)
    const rad = (angleDeg * Math.PI) / 180
    const dx = deltaMm * Math.cos(rad)
    const dy = deltaMm * Math.sin(rad)
    return {
      start: { x: c.start.x + dx, y: c.start.y + dy },
      end: { x: c.end.x + dx, y: c.end.y + dy },
    }
  }
  const angleStart = outwardNormalAngleAt(curves, curveIndex, 0)
  const angleCp1 = outwardNormalAngleAt(curves, curveIndex, 1 / 3)
  const angleCp2 = outwardNormalAngleAt(curves, curveIndex, 2 / 3)
  const angleEnd = outwardNormalAngleAt(curves, curveIndex, 1)
  const radS = (angleStart * Math.PI) / 180
  const radCp1 = (angleCp1 * Math.PI) / 180
  const radCp2 = (angleCp2 * Math.PI) / 180
  const radE = (angleEnd * Math.PI) / 180
  const dxS = deltaMm * Math.cos(radS)
  const dyS = deltaMm * Math.sin(radS)
  const dxE = deltaMm * Math.cos(radE)
  const dyE = deltaMm * Math.sin(radE)
  return {
    start: { x: c.start.x + dxS, y: c.start.y + dyS },
    end: { x: c.end.x + dxE, y: c.end.y + dyE },
    cp1: { x: c.cp1.x + deltaMm * Math.cos(radCp1), y: c.cp1.y + deltaMm * Math.sin(radCp1) },
    cp2: { x: c.cp2.x + deltaMm * Math.cos(radCp2), y: c.cp2.y + deltaMm * Math.sin(radCp2) },
  }
}

// ---------------------------------------------------------------------------
// Variable offset: per-segment allowance with miter intersection at corners
// ---------------------------------------------------------------------------

/**
 * Outward normal vector for a line segment (respects winding).
 * Returns a unit vector pointing outward.
 */
function outwardNormalForSegment(
  p1: Point,
  p2: Point,
  areaSign: number
): { nx: number; ny: number } {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const len = Math.hypot(dx, dy) || 1
  const lnx = -dy / len
  const lny = dx / len
  const nx = areaSign >= 0 ? -lnx : lnx
  const ny = areaSign >= 0 ? -lny : lny
  return { nx, ny }
}

/**
 * Schnitt zweier Geraden (p1→p2) und (p3→p4). Liefert den Schnittpunkt oder null bei Parallelität.
 */
function lineLineIntersection(
  p1: Point, p2: Point,
  p3: Point, p4: Point
): Point | null {
  const d1x = p2.x - p1.x
  const d1y = p2.y - p1.y
  const d2x = p4.x - p3.x
  const d2y = p4.y - p3.y
  const den = d1x * d2y - d1y * d2x
  if (Math.abs(den) < 1e-12) return null
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den
  return { x: p1.x + t * d1x, y: p1.y + t * d1y }
}

/** Außen-Fillet nur bei Innenwinkel ≤ 150° (sonst Miter). */
const CUT_FILLET_PHI_MAX_RAD = (150 * Math.PI) / 180
/** Unterhalb kein Fillet (numerisch / fast kollinear). */
const CUT_FILLET_PHI_MIN_RAD = (2 * Math.PI) / 180
const CUT_FILLET_R_MIN_MM = 0.5
const CUT_FILLET_R_MAX_MM = 80
/** Feinere Abtastung = näher an exaktem Kreisbogen (Ausgabe bleibt Polylinie). */
const CUT_FILLET_ARC_STEP_RAD = (2 * Math.PI) / 180

function unitDir2(ax: number, ay: number): { x: number; y: number } | null {
  const len = Math.hypot(ax, ay)
  if (len < 1e-12) return null
  return { x: ax / len, y: ay / len }
}

/** Innenwinkel an Ecke v zwischen Kanten prev→v und v→next. */
function interiorAngleAtPolyVertex(prev: Point, v: Point, next: Point): number {
  const e1x = v.x - prev.x
  const e1y = v.y - prev.y
  const e2x = next.x - v.x
  const e2y = next.y - v.y
  const u1 = unitDir2(e1x, e1y)
  const u2 = unitDir2(e2x, e2y)
  if (!u1 || !u2) return Math.PI
  const c = Math.max(-1, Math.min(1, -(u1.x * u2.x + u1.y * u2.y)))
  return Math.acos(c)
}

/** Punkt auf der Geraden durch lineS–lineE im Abstand dist von M; wählt die Seite näher an origPt (Naht-Ecke). */
function pickTangentPointOnOffsetLine(
  M: Point,
  lineS: Point,
  lineE: Point,
  dist: number,
  origPt: Point
): Point | null {
  const u = unitDir2(lineE.x - lineS.x, lineE.y - lineS.y)
  if (!u) return null
  const c1 = { x: M.x + u.x * dist, y: M.y + u.y * dist }
  const c2 = { x: M.x - u.x * dist, y: M.y - u.y * dist }
  const d1 = Math.hypot(c1.x - origPt.x, c1.y - origPt.y)
  const d2 = Math.hypot(c2.x - origPt.x, c2.y - origPt.y)
  return d1 < d2 ? c1 : c2
}

function findArcCenterFromTangents(
  T1: Point,
  uA: { x: number; y: number },
  T2: Point,
  R: number
): Point | null {
  const perp1 = { x: -uA.y, y: uA.x }
  const perp2 = { x: uA.y, y: -uA.x }
  let best: Point | null = null
  let bestErr = Infinity
  for (const perp of [perp1, perp2]) {
    for (const sig of [-1, 1] as const) {
      const Ox = T1.x + perp.x * sig * R
      const Oy = T1.y + perp.y * sig * R
      const err = Math.abs(Math.hypot(T2.x - Ox, T2.y - Oy) - R)
      if (err < bestErr) {
        bestErr = err
        best = { x: Ox, y: Oy }
      }
    }
  }
  if (best == null || bestErr > R * 0.08) return null
  return best
}

/** Bogenpunkte von T1 nach T2 auf Kreis um O (Radius R); Wahl der Seite über Nähe zum Miter M. */
function arcSamplePoints(O: Point, R: number, T1: Point, T2: Point, M: Point, origPt: Point, stepRad: number): Point[] {
  const a1 = Math.atan2(T1.y - O.y, T1.x - O.x)
  const a2 = Math.atan2(T2.y - O.y, T2.x - O.x)
  let d = a2 - a1
  while (d <= -Math.PI) d += 2 * Math.PI
  while (d > Math.PI) d -= 2 * Math.PI
  const alt = d > 0 ? d - 2 * Math.PI : d + 2 * Math.PI
  let sweep = Math.abs(d) <= Math.abs(alt) ? d : alt
  const midAng = a1 + sweep / 2
  const midX = O.x + R * Math.cos(midAng)
  const midY = O.y + R * Math.sin(midAng)
  const dM = Math.hypot(midX - M.x, midY - M.y)
  const dO = Math.hypot(midX - origPt.x, midY - origPt.y)
  if (dM > dO) sweep = sweep > 0 ? sweep - 2 * Math.PI : sweep + 2 * Math.PI
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / stepRad))
  const out: Point[] = []
  for (let k = 1; k < n; k++) {
    const t = k / n
    const ang = a1 + sweep * t
    out.push({ x: O.x + R * Math.cos(ang), y: O.y + R * Math.sin(ang) })
  }
  return out
}

export type VariableOffsetResult = {
  lineCurves: Curve[]
  success: boolean
}

/**
 * Offsettet ein geschlossenes Polygon (als Curve[]) mit unterschiedlichen Abständen pro Segment.
 * `allowancePerCurveIndex` ordnet jedem curveIndex seine Nahtzugabe zu (mm, 0 = kein Offset).
 *
 * Algorithmus:
 * 1. Flatten zu Polyline (Bézier → fein abgetastet)
 * 2. Jedes Polyline-Segment erhält den Offset seines Quell-curveIndex
 * 3. Offset entlang der Auswärts-Normalen
 * 4. Miter-Intersection zwischen aufeinanderfolgenden Offset-Segmenten
 * 5. Miter-Limit (schneidet extreme Spitzen ab)
 * 6. Optional: tangentialer Fillet R = d/tan(φ/2) an echten Naht-Ecken (kein Clipper-Round-Join)
 * 7. Douglas-Peucker + Schließen — bei cutCornerFillet: weglassen, sonst würden Bögen optisch „einfach rund“ verwischt
 */
export function offsetClosedPolygonVariable(
  curves: Curve[],
  allowancePerCurveIndex: Map<number, number>,
  options?: OffsetOptions
): VariableOffsetResult {
  if (curves.length === 0) return { lineCurves: [], success: false }

  const area = signedAreaCurves(curves)
  const areaSign = area

  // Flatten to polyline, tracking which curveIndex each segment belongs to
  const polyPts: Point[] = []
  const polySegCurveIdx: number[] = [] // polySegCurveIdx[i] = curveIndex for segment polyPts[i]→polyPts[i+1]
  const BS = 64

  for (let ci = 0; ci < curves.length; ci++) {
    const c = curves[ci]
    if (c.type === 'line') {
      if (polyPts.length === 0 || !ptEq(polyPts[polyPts.length - 1], c.start)) {
        polyPts.push({ ...c.start })
      }
      polyPts.push({ ...c.end })
      polySegCurveIdx.push(ci)
    } else {
      if (polyPts.length === 0 || !ptEq(polyPts[polyPts.length - 1], c.start)) {
        polyPts.push({ ...c.start })
      }
      for (let k = 1; k < BS; k++) {
        polyPts.push(bezierAt(c, k / BS))
        polySegCurveIdx.push(ci)
      }
      polyPts.push({ ...c.end })
      polySegCurveIdx.push(ci)
    }
  }

  // Remove duplicate closing point
  if (polyPts.length > 1 && ptEq(polyPts[0], polyPts[polyPts.length - 1])) {
    polyPts.pop()
  }

  const n = polyPts.length
  if (n < 3) return { lineCurves: [], success: false }

  // Ensure polySegCurveIdx covers all n segments (closed ring: segment i = pt[i]→pt[(i+1)%n])
  while (polySegCurveIdx.length < n) {
    polySegCurveIdx.push(polySegCurveIdx.length > 0 ? polySegCurveIdx[polySegCurveIdx.length - 1] : 0)
  }

  // Build offset segments: each segment i = polyPts[i]→polyPts[(i+1)%n] offset by its allowance
  const offsetSegs: Array<{ s: Point; e: Point }> = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const p1 = polyPts[i]
    const p2 = polyPts[j]
    const ci = polySegCurveIdx[i]
    const mm = allowancePerCurveIndex.get(ci) ?? 0
    const { nx, ny } = outwardNormalForSegment(p1, p2, areaSign)
    offsetSegs.push({
      s: { x: p1.x + nx * mm, y: p1.y + ny * mm },
      e: { x: p2.x + nx * mm, y: p2.y + ny * mm },
    })
  }

  // Compute miter intersections between consecutive offset segments.
  // At each vertex i, offset-segments (prev) and (i) meet.
  // For convex corners the miter point is outward; for concave corners
  // the intersection can flip to the wrong side → bevel fallback.
  const miterLimit = options?.miterLimit ?? CLIPPER_MITER_LIMIT_NAHTZUGABE_OFFSET
  const resultPts: Point[] = []
  const appendDedup = (p: Point) => {
    const last = resultPts[resultPts.length - 1]
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-5) resultPts.push(p)
  }

  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n
    const segA = offsetSegs[prev]
    const segB = offsetSegs[i]
    const origPt = polyPts[i]
    const ciA = polySegCurveIdx[prev]
    const ciB = polySegCurveIdx[i]
    const maxAllowance = Math.max(allowancePerCurveIndex.get(ciA) ?? 0, allowancePerCurveIndex.get(ciB) ?? 0)
    const dEff = Math.min(allowancePerCurveIndex.get(ciA) ?? 0, allowancePerCurveIndex.get(ciB) ?? 0)
    const realSeamCorner = polySegCurveIdx[prev] !== polySegCurveIdx[i]

    const inter = lineLineIntersection(segA.s, segA.e, segB.s, segB.e)
    if (!inter) {
      appendDedup({ x: (segA.e.x + segB.s.x) / 2, y: (segA.e.y + segB.s.y) / 2 })
      continue
    }

    const miterDist = Math.hypot(inter.x - origPt.x, inter.y - origPt.y)
    const avgNx =
      (outwardNormalForSegment(polyPts[prev], polyPts[i], areaSign).nx +
        outwardNormalForSegment(polyPts[i], polyPts[(i + 1) % n], areaSign).nx) /
      2
    const avgNy =
      (outwardNormalForSegment(polyPts[prev], polyPts[i], areaSign).ny +
        outwardNormalForSegment(polyPts[i], polyPts[(i + 1) % n], areaSign).ny) /
      2
    const toInterX = inter.x - origPt.x
    const toInterY = inter.y - origPt.y
    const dotOutward = toInterX * avgNx + toInterY * avgNy
    const isConcave = dotOutward < 0
    const bevelForMiterLimit = maxAllowance > 0 && miterDist > maxAllowance * miterLimit

    if (isConcave || bevelForMiterLimit) {
      appendDedup({ ...segA.e })
      appendDedup({ ...segB.s })
      continue
    }

    let didFillet = false
    if (options?.cutCornerFillet === true && realSeamCorner && dEff > 1e-6) {
      const phi = interiorAngleAtPolyVertex(polyPts[prev], polyPts[i], polyPts[(i + 1) % n])
      if (phi <= CUT_FILLET_PHI_MAX_RAD && phi >= CUT_FILLET_PHI_MIN_RAD) {
        const halfTan = Math.tan(phi / 2)
        if (halfTan > 1e-9) {
          let rad = dEff / halfTan
          rad = Math.max(CUT_FILLET_R_MIN_MM, Math.min(CUT_FILLET_R_MAX_MM, rad))
          const tLen = rad * halfTan
          const uA = unitDir2(segA.e.x - segA.s.x, segA.e.y - segA.s.y)
          if (uA && tLen > 1e-6) {
            const T1 = pickTangentPointOnOffsetLine(inter, segA.s, segA.e, tLen, origPt)
            const T2 = pickTangentPointOnOffsetLine(inter, segB.s, segB.e, tLen, origPt)
            if (T1 && T2) {
              const O = findArcCenterFromTangents(T1, uA, T2, rad)
              if (O) {
                const arcInner = arcSamplePoints(O, rad, T1, T2, inter, origPt, CUT_FILLET_ARC_STEP_RAD)
                appendDedup({ ...T1 })
                for (const q of arcInner) appendDedup(q)
                appendDedup({ ...T2 })
                didFillet = true
              }
            }
          }
        }
      }
    }

    if (!didFillet) appendDedup({ ...inter })
  }

  if (resultPts.length < 3) return { lineCurves: [], success: false }

  // Simplify: bei tangentialen Fillets kein Douglas-Peucker — sonst kollabiert der Bogen zu einem undefinierten „Rund“.
  const tol = options?.cutCornerFillet === true ? 0 : options?.simplifyTolerance ?? 0.06
  let outPts = tol > 0 ? simplifyClosedPolygon(resultPts, tol) : resultPts
  if (outPts.length < 3) outPts = resultPts

  // Remove degenerate (near-zero-length) segments
  const DEGEN_EPS = 0.001
  const filtered: Point[] = []
  for (let i = 0; i < outPts.length; i++) {
    const next = outPts[(i + 1) % outPts.length]
    if (Math.hypot(next.x - outPts[i].x, next.y - outPts[i].y) > DEGEN_EPS) {
      filtered.push(outPts[i])
    }
  }
  if (filtered.length >= 3) outPts = filtered

  // Convert to Curve[] (line segments, closed)
  const segs = pointsToLineCurves(outPts)
  if (outPts.length >= 3) {
    segs.push({ type: 'line', start: outPts[outPts.length - 1], end: outPts[0] })
  }

  return { lineCurves: segs, success: true }
}

const ptEq = samePoint

/** Prüft ob Nahtzugabe für die Kontur gültig ist. */
export function validateSeamAllowance(
  cutLine: Curve[],
  seamAllowanceMm: number
): { valid: boolean; warning?: string } {
  if (cutLine.length < 3) return { valid: false, warning: 'Kontur hat weniger als 3 Segmente' }
  if (seamAllowanceMm <= 0) return { valid: false, warning: 'Nahtzugabe muss positiv sein' }
  const bounds = curvesBounds(cutLine)
  if (!bounds) return { valid: false, warning: 'Bounding-Box konnte nicht berechnet werden' }
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const minDim = Math.min(width, height)
  if (seamAllowanceMm >= minDim / 2) {
    return {
      valid: false,
      warning: `Nahtzugabe (${seamAllowanceMm} mm) ist zu groß für die Kontur (min. Dimension: ${minDim.toFixed(1)} mm)`,
    }
  }
  if (seamAllowanceMm >= minDim / 3) {
    return {
      valid: true,
      warning: `Nahtzugabe ist relativ groß im Verhältnis zur Kontur`,
    }
  }
  return { valid: true }
}
