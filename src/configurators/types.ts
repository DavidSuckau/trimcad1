import type { Curve } from '../types/model'

export type ConfiguratorKindId = 'tshirt' | 'rock' | 'laserBox'

/** Identifiziert einen einzelnen Teil, den ein Konfigurator erzeugt. */
export type ConfiguratorPartId = 'front' | 'back' | 'left' | 'right' | 'bottom'

export type LaserBoxLidType = 'none' | 'removable' | 'sliding'
export type LaserBoxMaterialType = 'wood' | 'acrylic' | 'cardboard' | 'custom'

export type ConfiguratorPartParams = {
  /**
   * Generische Basisparameter:
   * - Für `tshirt`: Breite/Höhe als Rechteck-Platzhalter
   * - Für `rock`: `widthMm` = Taillen-Breite (pro Teil), `heightMm` = Rocklänge
   */
  widthMm: number
  heightMm: number
  /** Position des Teils im Workspace (Teilkoordinatenursprung via `transform.x/y`). */
  offsetX: number
  offsetY: number

  /**
   * Rock-spezifische Parameter (Grundschnitt-Ecken):
   * - `waistToHipMm`: Abstand Taillenlinie -> Hüftlinie entlang der Länge
   * - `hipWidthMm`: Hüft-Breite (pro Teil)
   * - `hemWidthMm`: Saum-Breite (pro Teil)
   *
   * Für T-Shirt bleiben diese Felder ignoriert.
   */
  waistToHipMm?: number
  hipWidthMm?: number
  hemWidthMm?: number
  /** Abnäher: Länge von Taillenlinie nach unten (pro Teil). */
  dartLengthMm?: number
  /** Abnäher: Gesamtöffnung an der Taille je Abnäher (pro Teil). */
  dartOpeningMm?: number
  /** Abnäher-Positionen relativ zur Taillenbreite (0..1, links/rechts). */
  dartPosLeftRatio?: number
  dartPosRightRatio?: number

  /**
   * Laser-Box Parameter:
   * - boxWidthMm: X-Breite (Front/Back)
   * - boxLengthMm: Y-Länge (Left/Right)
   * - boxHeightMm: Z-Höhe
   */
  boxWidthMm?: number
  boxLengthMm?: number
  boxHeightMm?: number
  materialThicknessMm?: number
  fingerCount?: number
  kerfMm?: number
  fitToleranceMm?: number
  lidType?: LaserBoxLidType
  materialType?: LaserBoxMaterialType
  openTop?: boolean
  openBottom?: boolean
}

export type ConfiguratorPart = {
  id: string
  kindId: ConfiguratorKindId
  partId: ConfiguratorPartId
  label: string
  params: ConfiguratorPartParams
  /** Der echte Piece im Workspace, den dieser Konfigurator-Teil erzeugt. */
  pieceId: string
}

export type ConfiguratorInstance = {
  id: string
  kindId: ConfiguratorKindId
  createdAt: string
  /** Hierarchie: Instanz -> Teile (jeder Teil kann separat parametrisiert werden). */
  parts: ConfiguratorPart[]
}

export type GeneratedPartGeometry = {
  pieceName: string
  cutLine: Curve[]
  /** Interne Linien (z.B. Abnäher) im Editor/DXF. */
  internalLines?: Curve[]
  transform: { x: number; y: number; rotation: number; mirrored: boolean }
}

