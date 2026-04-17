import type { Point } from '../types/model'

/** UI: Spiegelachse für Teil-Symmetrie (Teilkoordinaten). */
export type PieceSymmetryPhase =
  | 'chooseMethod'
  | 'axisA'
  | 'axisB'
  | 'pickInternalLine'
  | 'pickEdge'
  | 'pickSide'

export type PieceSymmetryUiState =
  | {
      pieceId: string
      phase: PieceSymmetryPhase
      axisA?: Point
      axisB?: Point
    }
  | null
