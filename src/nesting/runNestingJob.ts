import type { PatternPiece } from '../types/model'
import type { MaterialCatalogRow } from '../material/materialCatalogTypes'
import type { NestingJobRequest, NestingJobResponse, NestingPieceInput, NestingPlan } from './nestingTypes'
import { buildNestingPartGeometry } from './nestingGeometry'
import { runNesting } from './nestingEngine'
import { findCatalogRowByMaterialKey } from '../bom/materialCatalogCost'
import { piecesForMaterial, allowRotate180ForGrain } from './nestingMaterial'

const DEFAULT_TIME_LIMIT_MS = 25_000

let worker: Worker | null = null

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./nesting.worker.ts', import.meta.url), { type: 'module' })
  }
  return worker
}

export function terminateNestingWorker(): void {
  worker?.terminate()
  worker = null
}

export function buildNestingJobRequest(
  materialKey: string,
  pieces: PatternPiece[],
  inputs: NestingPieceInput[],
  catalogRows: MaterialCatalogRow[],
  spacingMm: number,
  maxRollLengthMm: number | null,
  timeLimitMs = DEFAULT_TIME_LIMIT_MS,
): { ok: true; request: NestingJobRequest } | { ok: false; error: string } {
  const row = findCatalogRowByMaterialKey(catalogRows, materialKey)
  if (!row) return { ok: false, error: 'Material nicht im Katalog gefunden.' }
  if (!row.rollWidthMm || row.rollWidthMm <= 0) {
    return { ok: false, error: 'Rollenbreite im Materialkatalog fehlt oder ist ungültig.' }
  }

  const materialPieces = piecesForMaterial(pieces, materialKey)
  const inputById = new Map(inputs.map((i) => [i.pieceId, i]))
  const allow180 = allowRotate180ForGrain(row.grainDirection)

  const parts: NestingJobRequest['parts'] = []
  for (const piece of materialPieces) {
    const inp = inputById.get(piece.id)
    const quantity = inp?.quantity ?? 0
    if (quantity <= 0) continue
    const geometry = buildNestingPartGeometry(piece, spacingMm, allow180)
    if (!geometry) {
      return { ok: false, error: `Teil „${piece.name}“ hat keine gültige Schnittkontur.` }
    }
    parts.push({ pieceId: piece.id, quantity, geometry })
  }

  if (parts.length === 0) {
    return { ok: false, error: 'Keine Teile mit Stückzahl > 0 für dieses Material.' }
  }

  return {
    ok: true,
    request: {
      materialKey,
      rollWidthMm: row.rollWidthMm,
      spacingMm,
      maxRollLengthMm,
      parts,
      timeLimitMs,
    },
  }
}

/** Nesting im Web Worker; fällt bei Worker-Fehler auf Main-Thread zurück. */
export function runNestingJobAsync(request: NestingJobRequest): Promise<NestingJobResponse> {
  return new Promise<NestingJobResponse>((resolve) => {
    const w = getWorker()
    const onMessage = (ev: MessageEvent<NestingJobResponse>) => {
      w.removeEventListener('message', onMessage)
      resolve(ev.data)
    }
    w.addEventListener('message', onMessage)
    w.postMessage(request)
  }).catch(() => runNesting(request))
}

/** Synchron (Tests). */
export function runNestingJobSync(request: NestingJobRequest): NestingJobResponse {
  return runNesting(request)
}

export type { NestingPlan }
