/**
 * DXF-Import: Konvertiert DXF-Daten zu PatternPiece[].
 * Nutzt dxfParser, notchDetection und Layer-Heuristiken für Fremdsysteme.
 */

import type { PatternPiece, Curve, Notch, Drill, Line } from '../types/model'
import { parseDxf, type DxfEntity, type DxfPoint } from './dxfParser'
import { detectNotchesInPolyline } from './notchDetection'
import {
  deriveCutLineFromSeamWithValidation,
  offsetCurvesInwardForSeam,
  SEAM_FROM_CUT_SIMPLIFY_IMPORT_MM,
} from '../geometry/offset'
import { isNotchLineLayer, isDrillLayer, isGrainLayer } from './dxfImportLayers'
import {
  collectDedupedPieceDrafts,
  dxfVertexRingClosed,
  dxfVerticesToLineCurves,
  lineToNotchDxf,
  pointToNotchDxf,
  NEAR_DUPE_REL_TOL,
  type BBox,
} from './dxfCollectCutDrafts'
import { resyncNotchesAfterCutLineRebuilt } from '../geometry/notchResyncCutLine'
import { nearestCurveIndexAndPoint } from '../geometry/nearestOnCurve'
import { isBinaryDxf, scanUnsupportedEntityHints } from './dxfBinaryHints'

export type ImportDxfOptions = {
  /** Zusätzliche Layer-Namen (kommagetrennt in den Einstellungen), die als Schnittkontur gelten. */
  extraCutLayers?: string[]
  /** Optionaler manueller Faktor auf den gesamten Import (nach DXF-Units), z. B. 10 bei 10x zu klein. */
  importScale?: number
  /** V-Kerben in der Polyligne erkennen und zu Notches mit bereinigter Kontur (Standard: true). */
  detectVNotchesInPolyline?: boolean
  /**
   * Wenn die DXF keine Naht-Polyline liefert: Nahtlinie per Offset nach innen erzeugen und Schnittkontur daraus ableiten.
   * Erfordert `importSeamAllowanceMm` &gt; 0.
   */
  createSeamLineOnImport?: boolean
  /** Nahtzugabe in mm für `createSeamLineOnImport` (z. B. 8). */
  importSeamAllowanceMm?: number
}

export type ImportDxfResult = {
  pieces: PatternPiece[]
  error?: string
  warnings?: string[]
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 12)
}

export function parseExtraCutLayers(extra?: string): string[] {
  if (!extra || !extra.trim()) return []
  return extra
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function estimateSeamAllowanceMm(seamPts: DxfPoint[], cutCurves: Curve[]): number | null {
  if (seamPts.length < 3 || cutCurves.length < 3) return null
  const distances: number[] = []
  for (const p of seamPts) {
    const nr = nearestCurveIndexAndPoint(p, cutCurves)
    if (nr) distances.push(nr.distance)
  }
  if (distances.length === 0) return null
  distances.sort((a, b) => a - b)
  const med = distances[Math.floor(distances.length / 2)]
  if (med > 0.05 && med < 500) return med
  const nr0 = nearestCurveIndexAndPoint(seamPts[0], cutCurves)
  const d0 = nr0?.distance
  return d0 != null && d0 > 0.05 && d0 < 500 ? d0 : null
}

export function assignToPieceForDxfImport(mx: number, my: number, cutBounds: BBox[]): number {
  let bestPiece = -1
  let bestDist = Infinity
  for (let i = 0; i < cutBounds.length; i++) {
    const b = cutBounds[i]
    if (mx >= b.minX - 50 && mx <= b.maxX + 50 && my >= b.minY - 50 && my <= b.maxY + 50) {
      const d = Math.max(0, b.minX - mx, mx - b.maxX, b.minY - my, my - b.maxY)
      if (d < bestDist) {
        bestDist = d
        bestPiece = i
      }
    }
  }
  return bestPiece
}

export function extractStandaloneNotches(
  entities: DxfEntity[],
  cutBounds: BBox[],
  unitScale: number
): Map<number, Notch[]> {
  const byPiece = new Map<number, Notch[]>()
  for (const e of entities) {
    if (e.type === 'LINE' && isNotchLineLayer(e.layer)) {
      const mx = ((e.x1 + e.x2) / 2) * unitScale
      const my = ((e.y1 + e.y2) / 2) * unitScale
      const bestPiece = assignToPieceForDxfImport(mx, my, cutBounds)
      if (bestPiece >= 0) {
        const n = lineToNotchDxf(e.x1, e.y1, e.x2, e.y2, e.layer, unitScale)
        if (n) {
          const list = byPiece.get(bestPiece) ?? []
          list.push(n)
          byPiece.set(bestPiece, list)
        }
      }
    }
    if (e.type === 'POINT' && isNotchLineLayer(e.layer)) {
      const mx = e.x * unitScale
      const my = e.y * unitScale
      const bestPiece = assignToPieceForDxfImport(mx, my, cutBounds)
      if (bestPiece >= 0) {
        const n = pointToNotchDxf(e.x, e.y, e.layer, unitScale)
        const list = byPiece.get(bestPiece) ?? []
        list.push(n)
        byPiece.set(bestPiece, list)
      }
    }
  }
  return byPiece
}

export function extractStandaloneDrills(
  entities: DxfEntity[],
  cutBounds: BBox[],
  unitScale: number
): Map<number, Drill[]> {
  const byPiece = new Map<number, Drill[]>()
  for (const e of entities) {
    if (e.type === 'CIRCLE' && isDrillLayer(e.layer)) {
      const mx = e.cx * unitScale
      const my = e.cy * unitScale
      let bestPiece = -1
      let bestDist = Infinity
      for (let i = 0; i < cutBounds.length; i++) {
        const b = cutBounds[i]
        if (mx >= b.minX - 50 && mx <= b.maxX + 50 && my >= b.minY - 50 && my <= b.maxY + 50) {
          const d = Math.max(0, b.minX - mx, mx - b.maxX, b.minY - my, my - b.maxY)
          if (d < bestDist) {
            bestDist = d
            bestPiece = i
          }
        }
      }
      if (bestPiece >= 0) {
        const r = e.radius * unitScale
        const list = byPiece.get(bestPiece) ?? []
        list.push({
          id: generateId(),
          center: { x: mx, y: my },
          radius: Math.max(0.1, r),
        })
        byPiece.set(bestPiece, list)
      }
    }
  }
  return byPiece
}

export function extractStandaloneGrain(
  entities: DxfEntity[],
  cutBounds: BBox[],
  unitScale: number
): Map<number, Line> {
  const byPiece = new Map<number, Line>()
  for (const e of entities) {
    if (e.type === 'LINE' && isGrainLayer(e.layer)) {
      const p1 = { x: e.x1 * unitScale, y: e.y1 * unitScale }
      const p2 = { x: e.x2 * unitScale, y: e.y2 * unitScale }
      const mx = (p1.x + p2.x) / 2
      const my = (p1.y + p2.y) / 2
      let bestPiece = -1
      let bestScore = Infinity
      for (let i = 0; i < cutBounds.length; i++) {
        const b = cutBounds[i]
        const inside = mx >= b.minX && mx <= b.maxX && my >= b.minY && my <= b.maxY
        const d = inside ? 0 : Math.max(b.minX - mx, mx - b.maxX, b.minY - my, my - b.maxY)
        if (d < bestScore) {
          bestScore = d
          bestPiece = i
        }
      }
      if (bestPiece >= 0 && bestScore < 800) {
        byPiece.set(bestPiece, { start: p1, end: p2 })
      }
    }
  }
  return byPiece
}

/** Max. Abstand importierter Eckpunkte zur abgeleiteten Schnittkontur (Clipper-Roundtrip). */
function maxDeviationVerticesToCurves(vertices: DxfPoint[], curves: Curve[]): number {
  let max = 0
  for (const p of vertices) {
    const nr = nearestCurveIndexAndPoint({ x: p.x, y: p.y }, curves)
    if (nr) max = Math.max(max, nr.distance)
  }
  return max
}

const SEAM_ROUNDTRIP_WARN_MM = 2
const NOTCH_SHORT_MAX_RELAXED_MM = 9
const NOTCH_MIN_ANGLE_RELAXED_DEG = 30
/** Dritte Stufe: längere Schenkel, flachere Winkel, max-Längen-Modus. */
const NOTCH_SHORT_MAX_VERY_RELAXED_MM = 16
const NOTCH_MIN_ANGLE_VERY_RELAXED_DEG = 20

export type NotchImportDetectTier = 'strict' | 'relaxed' | 'veryRelaxed' | null

function detectNotchesWithToleranceFallback(
  vertices: DxfPoint[],
  closedRing: boolean
): {
  cleanedVertices: DxfPoint[]
  notches: ReturnType<typeof detectNotchesInPolyline>['notches']
  notchTier: NotchImportDetectTier
} {
  const strict = detectNotchesInPolyline(vertices, { closedRing })
  if (strict.notches.length > 0) {
    return { ...strict, notchTier: 'strict' }
  }
  const relaxed = detectNotchesInPolyline(vertices, {
    closedRing,
    shortSegmentMaxMm: NOTCH_SHORT_MAX_RELAXED_MM,
    minAngleDeg: NOTCH_MIN_ANGLE_RELAXED_DEG,
  })
  if (relaxed.notches.length > 0) {
    return { ...relaxed, notchTier: 'relaxed' }
  }
  const veryRelaxed = detectNotchesInPolyline(vertices, {
    closedRing,
    shortSegmentMaxMm: NOTCH_SHORT_MAX_VERY_RELAXED_MM,
    minAngleDeg: NOTCH_MIN_ANGLE_VERY_RELAXED_DEG,
    legLengthMode: 'asymmetric',
  })
  if (veryRelaxed.notches.length > 0) {
    return { ...veryRelaxed, notchTier: 'veryRelaxed' }
  }
  return { ...strict, notchTier: null }
}

/**
 * Parst DXF-Text und erzeugt PatternPiece[].
 * Erkennt geometrische Kerben in Polylines und separate Notch-Entities (ASTM Layer 4, 80–83).
 */
export function importDxfFromString(content: string, options?: ImportDxfOptions): ImportDxfResult {
  const warnings: string[] = []
  const extraCutLayers = options?.extraCutLayers ?? []
  const manualImportScale =
    typeof options?.importScale === 'number' && Number.isFinite(options.importScale) && options.importScale > 0
      ? options.importScale
      : 1
  const detectVNotches = options?.detectVNotchesInPolyline !== false
  const createSeamOnImport = options?.createSeamLineOnImport === true
  const importSeamMm =
    typeof options?.importSeamAllowanceMm === 'number' &&
    Number.isFinite(options.importSeamAllowanceMm) &&
    options.importSeamAllowanceMm > 0
      ? options.importSeamAllowanceMm
      : null

  const text = content.replace(/^\uFEFF/, '')

  if (isBinaryDxf(text)) {
    return {
      pieces: [],
      error: 'Binär-DXF wird nicht unterstützt. Bitte als ASCII R12 (AC1009) exportieren.',
    }
  }

  const unsupported = scanUnsupportedEntityHints(text)
  for (const u of unsupported) {
    warnings.push(`${u}-Entities werden ignoriert.`)
  }

  try {
    const parsed = parseDxf(text)
    const { insUnits } = parsed
    const unitScale = insUnits === 4 ? 10 : 1
    const scale = unitScale * manualImportScale

    if (parsed.entities.length === 0) {
      warnings.push('Keine Entities in der ENTITIES-Sektion gefunden. Prüfen Sie, ob die Datei DXF R12 ASCII ist.')
    }

    const collected = collectDedupedPieceDrafts(parsed, extraCutLayers, manualImportScale)
    const { drafts } = collected
    if (collected.usedFallback) {
      warnings.push(
        'Kein bekannter Schnitt-Layer: geschlossene Konturen wurden von anderen Layern übernommen (Fläche ≥ 2 mm², keine Hilfs-/Beschriftungs-Layer).'
      )
    }
    if (collected.removedExactDupes > 0) {
      warnings.push(
        `${collected.removedExactDupes} doppelte Schnittkontur(en) entfernt (exakt gleiche Geometrie nach Hash-Rundung). Es bleibt jeweils der zuerst verarbeitete Entwurf (üblicherweise Block/INSERT vor Modellraum).`
      )
    }
    if (collected.removedNearDupes > 0) {
      warnings.push(
        `${collected.removedNearDupes} nahezu identische Schnittkontur(en) entfernt (Größe/Fläche je ±${Math.round(NEAR_DUPE_REL_TOL * 100)} %, hohe Bounding-Box-Überlappung, nahe Schwerpunkte). Block-Entwürfe haben Vorrang vor später in der Liste stehenden Quellen.`
      )
    }

    if (drafts.length === 0) {
      return {
        pieces: [],
        error:
          'Keine Schnittkonturen gefunden. Erwartet: POLYLINE/LWPOLYLINE (ggf. mit Bulge) auf einem Schnitt-Layer (z. B. CUT, 1, BOUNDARY) oder in Blöcken. In den Einstellungen zusätzliche Schnitt-Layer eintragen oder in der Quelle als R12 ASCII mit geschlossenen Polylines exportieren.',
        warnings: warnings.length ? warnings : undefined,
      }
    }

    const pieces: PatternPiece[] = []
    const cutBounds: BBox[] = []

    for (let d = 0; d < drafts.length; d++) {
      const draft = drafts[d]
      const vertices = draft.cutVertices
      const closed = draft.closed
      if (vertices.length < 3) continue

      const contourClosed = closed || dxfVertexRingClosed(vertices)
      const detectRes = detectVNotches
        ? detectNotchesWithToleranceFallback(vertices, contourClosed)
        : { cleanedVertices: [...vertices], notches: [], notchTier: null as NotchImportDetectTier }
      const { cleanedVertices, notches: geomNotches } = detectRes
      const pieceNum = String(pieces.length + 1).padStart(3, '0')
      if (detectRes.notchTier === 'relaxed') {
        warnings.push(
          `Teil ${pieceNum}: V-Kerben mit mittlerer Toleranz erkannt (${NOTCH_SHORT_MAX_RELAXED_MM} mm / ${NOTCH_MIN_ANGLE_RELAXED_DEG}°).`
        )
      } else if (detectRes.notchTier === 'veryRelaxed') {
        warnings.push(
          `Teil ${pieceNum}: V-Kerben mit großzügiger Toleranz erkannt (${NOTCH_SHORT_MAX_VERY_RELAXED_MM} mm / ${NOTCH_MIN_ANGLE_VERY_RELAXED_DEG}°, asymmetrische Schenkel erlaubt).`
        )
      }

      const isContourClosed = closed || dxfVertexRingClosed(cleanedVertices)
      if (!isContourClosed) continue

      let cutLine = dxfVerticesToLineCurves(cleanedVertices, isContourClosed)
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity
      for (const p of cleanedVertices) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }

      let allNotches: Notch[] = [
        ...geomNotches.map((n) => ({
          id: generateId(),
          position: n.position,
          angle: n.angle,
          type: (n.isSlit ? 'single' : 'v') as Notch['type'],
          depth: n.depth,
          width: n.width,
        })),
        ...draft.notchesFromLayers,
      ]

      let seamLine: Curve[] = []
      let seamAllowanceMm: number | null = null
      const hasSeamFromDxf = draft.seamVertices && draft.seamVertices.length >= 3
      let cutLineOldForNotchResync = cutLine

      if (hasSeamFromDxf) {
        const sc = draft.seamClosed || dxfVertexRingClosed(draft.seamVertices!)
        const sl = dxfVerticesToLineCurves(draft.seamVertices!, sc)
        const est = estimateSeamAllowanceMm(draft.seamVertices!, cutLine)
        if (est != null && sl.length >= 3) {
          seamLine = sl
          seamAllowanceMm = est
        }
      } else if (createSeamOnImport && importSeamMm != null && cutLine.length >= 3) {
        const importedCut = cutLine
        let sl = offsetCurvesInwardForSeam(cutLine, importSeamMm)
        let derived = sl.length >= 3 ? deriveCutLineFromSeamWithValidation(sl, importSeamMm) : { ok: false as const, message: 'Keine Nahtlinie' }

        if (!derived.ok && sl.length >= 3) {
          const slAlt = offsetCurvesInwardForSeam(cutLine, importSeamMm, SEAM_FROM_CUT_SIMPLIFY_IMPORT_MM)
          if (slAlt.length >= 3) {
            const d2 = deriveCutLineFromSeamWithValidation(slAlt, importSeamMm)
            if (d2.ok) {
              sl = slAlt
              derived = d2
              warnings.push(
                `Teil ${pieceNum}: Nahtlinie mit stärkerer Kantenvereinfachung erzeugt (Import-Stabilität).`
              )
            }
          }
        }

        if (derived.ok) {
          const dev = maxDeviationVerticesToCurves(cleanedVertices, derived.cutLine)
          if (dev > SEAM_ROUNDTRIP_WARN_MM) {
            warnings.push(
              `Teil ${pieceNum}: Schnittkontur weicht nach Naht-Offset-Roundtrip um bis zu ${dev.toFixed(1)} mm von der importierten Polylinie ab.`
            )
          }
          cutLine = derived.cutLine
          cutLineOldForNotchResync = importedCut
          seamLine = sl
          seamAllowanceMm = importSeamMm
        } else if (sl.length >= 3) {
          seamLine = sl
          seamAllowanceMm = importSeamMm
          cutLineOldForNotchResync = importedCut
          warnings.push(
            `Teil ${pieceNum}: Nahtlinie und Nahtzugabe gesetzt; Schnittkontur bleibt wie importiert (kein Roundtrip: ${derived.message}). Beim Bearbeiten der Naht wird die Schnittkontur ggf. angeglichen.`
          )
        } else {
          warnings.push(
            `Teil ${pieceNum}: Innere Naht konnte nicht erzeugt werden (Offset leer oder zu klein).`
          )
        }
      }

      allNotches = resyncNotchesAfterCutLineRebuilt(allNotches, cutLineOldForNotchResync, cutLine)

      const id = generateId()
      const number = String(pieces.length + 1).padStart(3, '0')
      const piece: PatternPiece = {
        id,
        number,
        name: `Teil ${number}`,
        cutLine,
        seamLine,
        seamAllowanceMm,
        notches: allNotches,
        drills: [...draft.drillsFromLayers],
        grainLine: draft.grainLine,
        internalLines: [],
        internalCircles: [],
        layer: 'CUT',
        transform: { x: 0, y: 0, rotation: 0, mirrored: false },
        softVertices: [],
        softVerticesMaster: [],
        fillInterior: true,
      }
      pieces.push(piece)
      cutBounds.push({ minX, minY, maxX, maxY })
    }

    const standaloneNotches = extractStandaloneNotches(parsed.entities, cutBounds, scale)
    const standaloneDrills = extractStandaloneDrills(parsed.entities, cutBounds, scale)
    const standaloneGrain = extractStandaloneGrain(parsed.entities, cutBounds, scale)

    for (const [idx, notchList] of standaloneNotches) {
      if (pieces[idx]) {
        const merged = [...(pieces[idx].notches ?? []), ...notchList]
        pieces[idx].notches = resyncNotchesAfterCutLineRebuilt(merged, pieces[idx].cutLine, pieces[idx].cutLine)
      }
    }
    for (const [idx, drillList] of standaloneDrills) {
      if (pieces[idx]) {
        pieces[idx].drills = [...pieces[idx].drills, ...drillList]
      }
    }
    for (const [idx, grain] of standaloneGrain) {
      if (pieces[idx] && !pieces[idx].grainLine) {
        pieces[idx].grainLine = grain
      }
    }

    if (pieces.length === 0 && drafts.length > 0) {
      return {
        pieces: [],
        error:
          'Konturen gefunden, aber keine geschlossene Schnittlinie (mindestens 3 Punkte, geschlossen).',
        warnings: warnings.length ? warnings : undefined,
      }
    }

    return { pieces, warnings: warnings.length ? warnings : undefined }
  } catch (err) {
    return {
      pieces: [],
      error: err instanceof Error ? err.message : 'Unbekannter Fehler beim DXF-Import',
    }
  }
}
