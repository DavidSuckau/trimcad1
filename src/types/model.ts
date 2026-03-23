/** Alle Koordinaten in mm, number (double precision). */

export type Point = { x: number; y: number }

export type Line = { start: Point; end: Point }

/** Kubische Bézier: start, end, control1, control2 */
export type BezierCurve = {
  type: 'bezier'
  start: Point
  end: Point
  cp1: Point
  cp2: Point
}

export type LineSegment = {
  type: 'line'
  start: Point
  end: Point
}

export type Curve = LineSegment | BezierCurve

export type NotchType = 'single' | 'double' | 'v'

export type Notch = {
  id: string
  /** Absolute Position – einzige Quelle der Wahrheit. Wird nur bei bewusstem Verschieben geändert. */
  position: Point
  angle: number
  type: NotchType
  depth: number
  /** Breite der Kerbe in mm (entlang der Kontur). Default 6. */
  width?: number
  /** Index des Konturpunkts (Knick) – Notch folgt dem Vertex wenn er sich bewegt. */
  vertexIndex?: number
}

export type Drill = {
  id: string
  center: Point
  radius: number
}

export type PatternPieceTransform = {
  x: number
  y: number
  rotation: number
  mirrored: boolean
  /** Drehpunkt in Teilkoordinaten; wenn nicht gesetzt: Bounds-Mitte. */
  pivotLocal?: Point
}

export type PatternPiece = {
  id: string
  number: string
  name: string
  cutLine: Curve[]
  seamLine: Curve[]
  /** Nahtzugabe in mm; wenn gesetzt, wird seamLine bei Konturänderung neu berechnet */
  seamAllowanceMm?: number | null
  notches: Notch[]
  drills: Drill[]
  grainLine: Line | null
  internalLines: Curve[]
  layer: string
  transform: PatternPieceTransform
  /** Vertex-Indices die per "Erzeuge Punkt" eingefügt wurden (blaue Punkte, keine Eckpunkte). */
  softVertices?: number[]
  /**
   * Flächenfüllung im Editor (hellgelb). false = nur Kontur, Füllung transparent.
   * Fehlt bei alten Daten → wie true behandeln.
   */
  fillInterior?: boolean
}

export type ViewState = {
  zoom: number
  panX: number
  panY: number
}

/** Zuordnung zweier Nahtkanten (Eckpunkt→Eckpunkt) zwischen zwei Teilen. Nur Ansicht, nicht im DXF. */
export type SeamAssignment = {
  id: string
  pieceIdA: string
  /** Curve-Indices der Master-Kontur (seamLine bei Nahtzugabe, sonst cutLine); siehe getCurvesForSeamEdge */
  curveIndicesA: number[]
  /** Vom Nutzer angeklickter curveIndex – definiert die Nährichtung auf Kante A */
  clickedCurveA: number
  pieceIdB: string
  /** Wie curveIndicesA: Master-Kontur des anderen Teils */
  curveIndicesB: number[]
  clickedCurveB: number
}

export type Workspace = {
  id: string
  name: string
  pieces: PatternPiece[]
  view: ViewState
  /** Nahtzuordnungen (welche Naht an welcher zusammennähen). Nur für die Ansicht, nicht DXF-Export. */
  seamAssignments: SeamAssignment[]
}

export const DXF_LAYERS = ['CUT', 'SEAM', 'NOTCH', 'DRILL', 'GRAIN', 'TEXT'] as const
export type DxfLayer = (typeof DXF_LAYERS)[number]

/** Einzelner Knoten beim Digitalisieren (Pen-Tool). */
export type DigitizeNode = {
  point: Point
  /** Ausgehende Tangente (durch Ziehen definiert). null = scharfe Ecke / Liniensegment. */
  handleOut: Point | null
}

/** Zustand der laufenden Digitalisierung. */
export type DigitizeState = {
  nodes: DigitizeNode[]
  isDragging: boolean
  dragPosition: Point | null
}
