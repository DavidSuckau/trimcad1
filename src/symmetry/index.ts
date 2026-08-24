/**
 * Teil-Symmetrie (UI-Typen, Konstanten, Anwendung auf ein Stück).
 * Kerngeometrie (Clipper, Spiegeln von Punkten/Kurven) liegt in {@link ../geometry/pieceSymmetry}.
 */
export type { PieceSymmetryPhase, PieceSymmetryUiState } from './types'
export { SYMMETRY_INTERNAL_HOVER_MM } from './constants'
export { applyPieceSymmetryToPiece, type ApplyPieceSymmetryToPieceResult } from './applyPieceSymmetryToPiece'
export {
  finalizePieceContourEdit,
  findKeepSidePartnerVertex,
  findMirrorSidePartnerVertex,
  getContourVertexPosition,
  mapContourVertexEditForSymmetry,
  mapCurveEditForSymmetry,
  mirrorSymmetricContourPointInsert,
  appendSymmetricMirroredNotches,
  syncPieceSymmetryGeometry,
  syncMasterCurvesByMirroring,
  symmetryConstraintFromAxis,
} from './reconcilePieceSymmetry'
export {
  crossZ,
  symmetryAxisEndpointsFromCurveTangentHit,
  symmetryAxisEndpointsFromInternalCurve,
  symmetryAxisEndpointsFromStraightMasterEdge,
  symmetryAxisFromMasterEdgePick,
  symmetryAxisClippedToPieceBounds,
  type PieceSymmetryKeepSide,
} from '../geometry/pieceSymmetry'
