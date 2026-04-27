/**
 * Separater DXF-Import: offene Schnitt-Polylines als Vorlagen-Teile (keine geschlossene Kontur nötig).
 * Standard-Import (`importDxfFromString`) bleibt unverändert; gemeinsam nur Draft-Sammlung und Parser.
 */

import type { PatternPiece } from '../types/model'
import { parseDxf } from './dxfParser'
import { isBinaryDxf, scanUnsupportedEntityHints } from './dxfBinaryHints'
import {
  collectDedupedPieceDrafts,
  dxfVertexRingClosed,
  dxfVerticesToLineCurves,
  boundsOfDxfPoints,
  NEAR_DUPE_REL_TOL,
  type BBox,
} from './dxfCollectCutDrafts'
import type { ImportDxfOptions, ImportDxfResult } from './dxfImporter'
import {
  extractStandaloneNotches,
  extractStandaloneDrills,
  extractStandaloneGrain,
} from './dxfImporter'
import { resyncNotchesAfterCutLineRebuilt } from '../geometry/notchResyncCutLine'

function generateId(): string {
  return Math.random().toString(36).slice(2, 12)
}

export type ImportDxfOpenContourOptions = Pick<ImportDxfOptions, 'extraCutLayers' | 'importScale'> &
  Pick<ImportDxfOptions, 'createSeamLineOnImport' | 'importSeamAllowanceMm'>

function isOpenCutDraft(d: { cutVertices: { x: number; y: number }[]; closed: boolean }): boolean {
  const v = d.cutVertices
  if (v.length < 2) return false
  return !(d.closed || dxfVertexRingClosed(v))
}

/**
 * Importiert nur **offene** Schnitt-Polylines (ein Teil pro Polyline). Nahtzugabe/Naht aus DXF-Einstellungen
 * werden ignoriert; V-Kerben-Erkennung in der Polylinie ist deaktiviert (Layer-Kerben aus Blöcken bleiben).
 */
export function importDxfOpenContoursFromString(
  content: string,
  options?: ImportDxfOpenContourOptions
): ImportDxfResult {
  const warnings: string[] = []
  const extraCutLayers = options?.extraCutLayers ?? []
  const manualImportScale =
    typeof options?.importScale === 'number' && Number.isFinite(options.importScale) && options.importScale > 0
      ? options.importScale
      : 1

  const createSeamOnImport = options?.createSeamLineOnImport === true
  const importSeamMm =
    typeof options?.importSeamAllowanceMm === 'number' &&
    Number.isFinite(options.importSeamAllowanceMm) &&
    options.importSeamAllowanceMm > 0
      ? options.importSeamAllowanceMm
      : null
  if (createSeamOnImport && importSeamMm != null) {
    warnings.push(
      `Vorlagen-Import: automatische Naht (Nahtzugabe ${importSeamMm} mm) aus den DXF-Einstellungen wird bei offenen Konturen nicht angewendet.`
    )
  }

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
          'Keine Schnittkonturen gefunden. Erwartet: POLYLINE/LWPOLYLINE auf einem Schnitt-Layer (z. B. CUT, 1, BOUNDARY) oder in Blöcken.',
        warnings: warnings.length ? warnings : undefined,
      }
    }

    const openDrafts = drafts.filter(isOpenCutDraft)
    if (openDrafts.length === 0) {
      return {
        pieces: [],
        error:
          'Keine offenen Schnittkonturen gefunden (nur geschlossene oder zu kurze Polylines). Für geschlossene Konturen den Standard-DXF-Import verwenden.',
        warnings: warnings.length ? warnings : undefined,
      }
    }

    const pieces: PatternPiece[] = []
    const cutBounds: BBox[] = []

    for (const draft of openDrafts) {
      const vertices = draft.cutVertices
      const cutLine = dxfVerticesToLineCurves(vertices, false)
      if (cutLine.length === 0) continue

      const b = boundsOfDxfPoints(vertices)
      const id = generateId()
      const number = String(pieces.length + 1).padStart(3, '0')
      const piece: PatternPiece = {
        id,
        number,
        name: `Vorlage ${number}`,
        cutLine,
        seamLine: [],
        seamAllowanceMm: null,
        notches: [...draft.notchesFromLayers],
        drills: [...draft.drillsFromLayers],
        grainLine: draft.grainLine,
        internalLines: [],
        internalCircles: [],
        layer: 'CUT_VORLAGE',
        transform: { x: 0, y: 0, rotation: 0, mirrored: false },
        softVertices: [],
        softVerticesMaster: [],
        fillInterior: false,
      }
      pieces.push(piece)
      cutBounds.push(b)
    }

    if (pieces.length === 0) {
      return {
        pieces: [],
        error: 'Offene Konturen gefunden, aber keine verwertbare Linie (zu wenige Punkte nach Bereinigung).',
        warnings: warnings.length ? warnings : undefined,
      }
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

    return { pieces, warnings: warnings.length ? warnings : undefined }
  } catch (err) {
    return {
      pieces: [],
      error: err instanceof Error ? err.message : 'Unbekannter Fehler beim DXF-Vorlagen-Import',
    }
  }
}
