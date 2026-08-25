/** Region auf dem Sitz-Dummy, auf die ein 2D-Teil gelegt wird. */
export type SeatRegion = 'cushion' | 'backrest'

export type SeatPiecePlacement = {
  pieceId: string
  region: SeatRegion
  /** Zusätzlicher Offset auf der Region (mm, lokal u/v). */
  offsetU: number
  offsetV: number
}
