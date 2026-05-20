import type { PatternPiece } from '../types/model'
import type { MaterialCatalogRow } from '../material/materialCatalogTypes'
import type {
  NestingJobRequest,
  NestingJobResponse,
  NestingPieceInput,
  NestingPlan,
  NestingProgressCallback,
  NestingWorkerOutMessage,
} from './nestingTypes'
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

function safeRunNesting(request: NestingJobRequest, onProgress?: NestingProgressCallback): NestingJobResponse {
  try {
    return runNesting(request, onProgress)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Nesting-Berechnung fehlgeschlagen.'
    return { ok: false, error: message }
  }
}

/** Nesting im Web Worker; fällt bei Worker-Fehler auf Main-Thread zurück. */
export function runNestingJobAsync(
  request: NestingJobRequest,
  onProgress?: NestingProgressCallback,
): Promise<NestingJobResponse> {
  return new Promise<NestingJobResponse>((resolve) => {
    try {
      const w = getWorker()
      const cleanup = () => {
        w.removeEventListener('message', onMessage)
        w.removeEventListener('error', onWorkerError)
      }
      const onMessage = (ev: MessageEvent<NestingWorkerOutMessage>) => {
        const data = ev.data
        if (data.type === 'progress') {
          onProgress?.(data.pct, data.phase)
          return
        }
        cleanup()
        resolve(data.result)
      }
      const onWorkerError = () => {
        cleanup()
        resolve(safeRunNesting(request, onProgress))
      }
      w.addEventListener('message', onMessage)
      w.addEventListener('error', onWorkerError)
      w.postMessage(request)
    } catch {
      resolve(safeRunNesting(request, onProgress))
    }
  })
}

/** Synchron (Tests). */
export function runNestingJobSync(request: NestingJobRequest): NestingJobResponse {
  return runNesting(request)
}

export type { NestingPlan }
