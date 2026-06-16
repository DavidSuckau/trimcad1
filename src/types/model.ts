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

/** Interner Kreis in Teilkoordinaten: ein Eintrag = ein Kreis (ganz löschbar). */
export type InternalCircle = {
  id: string
  center: Point
  radius: number
}

export type NotchType = 'single' | 'double' | 'v'
export type NotchRole = 'nahtanfang' | 'nahtende' | 'beides'

export type Notch = {
  id: string
  /**
   * Cache für Treffer/UI; kanonische Lage folgt der Anker-Priorität in `resolveNotchCutLineAnchor`
   * (`sNormalized` > `arcLengthMm` > Projektion von `position`).
   */
  position: Point
  angle: number
  type: NotchType
  depth: number
  /** Breite der Kerbe in mm (entlang der Kontur). Default 6. */
  width?: number
  /** @deprecated Feld bleibt nur für JSON-Kompatibilität; wird im Code ignoriert. */
  vertexIndex?: number
  /**
   * Kanonischer Anker: Anteil der Bogenlänge entlang der geschlossenen **cutLine** [0, 1].
   * Hat Vorrang vor `arcLengthMm` und `position`.
   */
  sNormalized?: number
  /** Bogenlänge in mm vom selben Startpunkt; Denormalisierung zu `sNormalized` über `totalPathLength(cutLine)`. */
  arcLengthMm?: number
  /** Semantische Rolle für Naht-/Profil-Grenzen. */
  role?: NotchRole
  /**
   * Kerbe auf interner Linie (Abnäher etc.) – nur Editor/Planung, kein DXF-Schnitt.
   * Index in `piece.internalLines`. Kanonische Lage: `internalSNormalized` / `internalArcLengthMm`
   * entlang der offenen internen Polylinie, sonst Projektion von `position`.
   */
  internalLineIndex?: number
  /** Anteil der Bogenlänge entlang aller `internalLines` [0, 1] (offene Polylinie). */
  internalSNormalized?: number
  internalArcLengthMm?: number
}

export type Drill = {
  id: string
  center: Point
  radius: number
}

/** Nahtzugaben-Override pro Kante (Ecke-zu-Ecke auf Master-Kontur). */
export type EdgeSeamAllowance = {
  /** 0-basierte Kantennummer (Ordnungsposition unter den harten Ecken der Master-Kontur). */
  edgeIndex: number
  /** Nahtzugabe in mm; 0 = keine Nahtzugabe für diese Kante. */
  allowanceMm: number
}

/**
 * Persistierte Eckenrundung an einem roten Eckpunkt der Master-Kontur.
 * Die Master-Kontur (`seamLine` bei Naht, sonst `cutLine`) bleibt **scharf** gespeichert;
 * die Rundung wird beim Rendern und beim Ableiten der parallelen `cutLine` als Derivation angewendet.
 */
export type RoundedCorner = {
  /** Vertex-Index auf der Master-Kontur (seamLine bei Naht, sonst cutLine). Identifiziert den roten Eckpunkt. */
  masterVertexIndex: number
  /** Radius in mm (>= 0.5). */
  radiusMm: number
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
  /**
   * Kantenweise Overrides der Nahtzugabe. Sparse: nur Kanten die vom globalen `seamAllowanceMm` abweichen.
   * `edgeIndex` = Ordnungsposition der Kante (0-basiert, Ecke-zu-Ecke auf der Master-Kontur).
   * Fehlende Kanten erben `seamAllowanceMm`. Leer/undefiniert = einheitliche Nahtzugabe (Clipper).
   */
  edgeSeamAllowances?: EdgeSeamAllowance[]
  /**
   * true: `cutLine` ist nicht mehr der reine Außen-Offset der `seamLine` (z. B. manuelles Naht trimmen).
   * Dann wird `cutLine` bei Spiegelung/Symmetrie und bei vielen Naht-Master-Edits parallel zur Naht mitgeführt,
   * statt sie jedes Mal neu aus `seamLine` abzuleiten. Zurueckgesetzt bei entfernter/neu gesetzter Nahtzugabe
   * oder wenn die Schnittkontur wieder vollstaendig aus der Naht abgeleitet wird.
   */
  cutLineDeviatesFromSeamAllowanceOffset?: boolean
  notches: Notch[]
  drills: Drill[]
  grainLine: Line | null
  internalLines: Curve[]
  /**
   * Weiche Eckpunkte an Verbindungen zwischen aufeinanderfolgenden Einträgen in `internalLines`:
   * Index `j` bezeichnet die gemeinsame Ecke zwischen Segment `j-1` und `j` (1 <= j < internalLines.length).
   */
  internalLineSoftJunctions?: number[]
  internalCircles: InternalCircle[]
  /**
   * Semantische Layer-Klassifikation des Teils (derzeit v. a. für UI/Interchange).
   * Der DXF-Export ordnet Geometrie aktuell über Writer-spezifische Layerregeln zu
   * (AAMA/ASTM), nicht 1:1 über dieses Feld.
   */
  layer: string
  transform: PatternPieceTransform
  /** Vertex-Indices die per "Erzeuge Punkt" eingefügt wurden (blaue Punkte, keine Eckpunkte). */
  softVertices?: number[]
  /**
   * Bei Naht als Master: weiche Eckpunkte **auf der Nahtlinie** (Master-Indizes), 1:1 mit P/E am gleichen Eck.
   * `softVertices` bleiben Schnittkontur-Indizes (z. B. nach Punkt einfügen / Offset).
   */
  softVerticesMaster?: number[]
  /**
   * Persistierte Eckenrundungen (Fillets) auf der Master-Kontur. Sparse: nur tatsächlich gerundete Ecken.
   * Indizes referenzieren die scharfe Master-Kontur (seamLine bei Naht, sonst cutLine).
   * Werden bei Topologie-Änderungen mit-remapped (analog zu softVerticesMaster).
   */
  roundedCorners?: RoundedCorner[]
  /**
   * Flächenfüllung im Editor (hellgelb). false = nur Kontur, Füllung transparent.
   * Fehlt bei alten Daten → wie true behandeln.
   */
  fillInterior?: boolean
  /** Freitext für Stückliste / Verbrauch (z. B. Stoffart); gesetzt → Pastellfüllfarbe auf der Arbeitsfläche pro Bezeichnung. */
  material?: string
  /** Freitext-Beschreibung für Stückliste (z. B. Position, Variante). */
  description?: string
  /** Stückzahl für BOM; ganzzahlig ≥ 1. */
  bomQuantity?: number
}

export type ViewState = {
  zoom: number
  panX: number
  panY: number
}

/** Vorgegebene Naht-Arten für Nahtzuordnungen (Eigenschaften-Dialog). */
export const SEAM_ASSIGNMENT_KIND_IDS = [
  'schluessel',
  'saum',
  'kapp',
  'doppelkapp',
  'beleg',
  'deko',
  'steppung',
] as const
export type SeamAssignmentKindId = (typeof SEAM_ASSIGNMENT_KIND_IDS)[number]

export const SEAM_ASSIGNMENT_KIND_LABELS: Record<SeamAssignmentKindId, string> = {
  schluessel: 'Schliessnaht / Standardnaht',
  saum: 'Saumnaht',
  kapp: 'Kappnaht',
  doppelkapp: 'Doppelkappnaht',
  beleg: 'Naht mit Beleg',
  deko: 'Dekorative Naht / Deco',
  steppung: 'Steppnaht',
}

/** Zuordnung zweier Nahtkanten (Eckpunkt→Eckpunkt) zwischen zwei Teilen. Nur Ansicht, nicht im DXF. */
export type SeamAssignment = {
  id: string
  pieceIdA: string
  /**
   * Curve-Indices der Master-Kontur (seamLine bei Nahtzugabe, sonst cutLine); siehe getCurvesForSeamEdge.
   * Keine Indizes der abgeleiteten cutLine, wenn Master = seamLine; kein 1:1-Segment-Mapping seam↔cut.
   */
  curveIndicesA: number[]
  /** Vom Nutzer angeklickter curveIndex – definiert die Nährichtung auf Kante A */
  clickedCurveA: number
  pieceIdB: string
  /** Wie curveIndicesA: Master-Kontur des anderen Teils */
  curveIndicesB: number[]
  clickedCurveB: number
  /** Optional: explizites Segment auf Kante A zwischen Notches (inkl. Rolle `beides`). */
  notchRangeA?: { startNotchId: string; endNotchId: string }
  /** Optional: explizites Segment auf Kante B zwischen Notches (inkl. Rolle `beides`). */
  notchRangeB?: { startNotchId: string; endNotchId: string }
  /** Reihenfolge beim Nähen; jede Nummer höchstens einmal pro Arbeitsfläche. */
  orderNumber?: number | null
  /** Art der Naht (optional). */
  seamKind?: SeamAssignmentKindId | null
  /**
   * Einzelnaht auf interner Linie (ohne Partner-Teil): Saum, Deco, Steppung usw.
   * `curveIndicesA` verweisen auf `piece.internalLines`; `pieceIdB` = `pieceIdA` (Platzhalter).
   */
  isInternalSingle?: boolean
}

/** Anhänge-Modus für Profile auf internen Linien (Stückliste / Nähplan). */
export const PROFILE_INTERNAL_LINE_ATTACHMENT_IDS = ['separate', 'with_seam'] as const
export type ProfileInternalLineAttachmentId = (typeof PROFILE_INTERNAL_LINE_ATTACHMENT_IDS)[number]

export const PROFILE_INTERNAL_LINE_ATTACHMENT_LABELS: Record<ProfileInternalLineAttachmentId, string> = {
  separate: 'Profil wird separat angenäht',
  with_seam: 'Profil wird mit Naht angenäht',
}

/** Profilzuordnung an einer Kante (Ecke-zu-Ecke). Nur Visualisierung/Stückliste, nicht im DXF-Export. */
export type ProfileAssignment = {
  id: string
  pieceId: string
  /** 0-basierte Kantennummer (Ecke-zu-Ecke auf Master-Kontur, analog EdgeSeamAllowance). */
  edgeIndex: number
  /**
   * true: Profil auf einem Segment in `piece.internalLines` (Punkt→Punkt).
   * Dann ist `edgeIndex` der Index dieses Segments in `internalLines`, nicht die Kontur-Kantennummer.
   */
  onInternalLine?: boolean
  /** Optionaler Start-Notch für Teilsegment auf der Kante. */
  startNotchId?: string
  /** Optionales Ende-Notch für Teilsegment auf der Kante. */
  endNotchId?: string
  /** Nahtzugabe in mm entlang dieser Kante (optional, visuell dargestellt). */
  seamAllowanceMm?: number
  /** Lieferantennummer. */
  supplierNumber?: string
  /** Interne Artikelnummer. */
  internalArticleNumber?: string
  /** Profilbezeichnung (Pflicht). */
  profileName: string
  /** Eindeutige Kennung, z. B. A, B, C (Pflicht). */
  profileKey: string
  /** Pfad/URL zu hinterlegtem PDF-Dokument. */
  pdfDocumentUrl?: string
  /**
   * Nur bei `onInternalLine`: ob das Profil im Nähplan mit der internen Nahtzuordnung
   * zusammengefasst wird (`with_seam`) oder separat als Profilnaht geführt wird.
   * Fehlt → `separate`.
   */
  internalLineAttachment?: ProfileInternalLineAttachmentId
  /**
   * Feste Profillänge in mm (5-mm-Raster), gesetzt beim Speichern der Zuordnung.
   * Geometrie wird beim Anlegen und nach Bearbeitung an diese Länge angepasst.
   */
  targetLengthMm?: number
}

/** Editor-Notiz am Schnittteil (Teilkoordinaten, mm); bewegt sich mit dem Teil; kein DXF-Export. */
export type WorkspaceNote = {
  id: string
  pieceId: string
  /** Position in Teilkoordinaten (wie cutLine), nicht Welt-mm. */
  position: Point
  text: string
}

export type Workspace = {
  id: string
  name: string
  pieces: PatternPiece[]
  view: ViewState
  /** Nahtzuordnungen (welche Naht an welcher zusammennähen). Nur für die Ansicht, nicht DXF-Export. */
  seamAssignments: SeamAssignment[]
  /**
   * true (default): Bei Nahtzuordnung werden überstehende Miter-Ecken an beiden Teilen automatisch angeglichen.
   * false: Keine automatische Eck-Anpassung.
   */
  autoAdjustSeamAssignmentCorners?: boolean
  /** Freie Notizzettel (nur Editor, nicht DXF-Export). */
  notes?: WorkspaceNote[]
  /** Profilzuordnungen an Kanten (nur Visualisierung/Stückliste, nicht DXF-Export). */
  profileAssignments?: ProfileAssignment[]
  /** Zuletzt gespeicherter oder geladener Projektdateiname (Anzeige Stückliste). */
  projectFileName?: string
  /** Stückliste: Dokumentversion (frei). */
  bomDocumentVersion?: string
  /** Stückliste: Entwickler (Name). */
  bomDeveloperName?: string
  /** Stückliste: Ingenieur (Name). */
  bomEngineerName?: string
}

export const DXF_LAYERS = ['CUT', 'SEAM', 'NOTCH', 'DRILL', 'GRAIN', 'TEXT'] as const
export type DxfLayer = (typeof DXF_LAYERS)[number]

/**
 * Fensterauswahl: Filter für Batch-Aktionen (nur UI, nicht exportiert).
 * `softVertices` / `hardVertices`: nur weiche (blau) bzw. feste (rot) Konturpunkte.
 */
export type BatchSelectionFilter =
  | 'all'
  | 'vertices'
  | 'softVertices'
  | 'hardVertices'
  | 'notches'
  | 'curvePoints'
  | 'internalLines'
  | 'pieces'

/** Einzelziel der Fensterauswahl (Teil + geometrische Referenz). */
export type BatchSelectionTarget =
  | { kind: 'vertex'; pieceId: string; vertexIndex: number }
  | { kind: 'curvePoint'; pieceId: string; curveIndex: number }
  | { kind: 'notch'; pieceId: string; notchId: string }
  | { kind: 'internalLine'; pieceId: string; curveIndex: number }
  | { kind: 'internalCircle'; pieceId: string; circleId: string }
  | { kind: 'piece'; pieceId: string }

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
