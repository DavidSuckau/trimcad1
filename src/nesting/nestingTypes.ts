/** Stückzahl und Regeln pro Teil im Nesting-Dialog (unabhängig von BOM). */
export type NestingPieceInput = {
  pieceId: string
  quantity: number
  allowRotate180: boolean
}

export type NestingRotationDeg = 0 | 180

export type NestingPlacement = {
  pieceId: string
  instanceIndex: number
  x: number
  y: number
  rotationDeg: NestingRotationDeg
  mirrored: boolean
}

export type NestingPlan = {
  materialKey: string
  rollWidthMm: number
  spacingMm: number
  placements: NestingPlacement[]
  usedLengthMm: number
  efficiencyPct: number
  totalPieceAreaMm2: number
  warnings: string[]
}

export type NestingWorkerStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

/** Serialisierbares Teil-Polygon für Worker / Engine. */
export type NestingPartGeometry = {
  pieceId: string
  name: string
  areaMm2: number
  /** Variante 0°: Kette zeigt +Y, Schwerpunkt bei (0,0). */
  polygon0: { x: number; y: number }[]
  /** Optional: 180°-Variante um Ursprung. */
  polygon180: { x: number; y: number }[] | null
  grain0: { start: { x: number; y: number }; end: { x: number; y: number } }
  grain180: { start: { x: number; y: number }; end: { x: number; y: number } } | null
}

export type NestingJobRequest = {
  materialKey: string
  rollWidthMm: number
  spacingMm: number
  maxRollLengthMm: number | null
  parts: Array<{
    pieceId: string
    quantity: number
    geometry: NestingPartGeometry
  }>
  timeLimitMs: number
}

export type NestingJobResponse =
  | { ok: true; plan: NestingPlan }
  | { ok: false; error: string }
