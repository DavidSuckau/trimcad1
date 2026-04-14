/**
 * Zentrales Farbsystem für die CAD-Arbeitsfläche (SVG-Rendering).
 *
 * Alle visuellen Token an einer Stelle – WorkspaceCanvas.tsx und
 * buildWorkspaceOverviewSvg.ts importieren von hier.
 *
 * Farbsemantik:
 *   accent.interaction  – interaktive Hervorhebung (Blau)
 *   accent.hover        – Hover-State auf Teilen (Rot)
 *   accent.warning      – Warnungen / Orange-Hinweise
 *   accent.error        – Fehler / Rot-Hinweise
 *   accent.profile      – Profil-Zuordnungen (Lila)
 *   accent.success      – Erfolg / Bestätigung (Grün)
 */

export const canvasTheme = {
  // ── Canvas ────────────────────────────────────────────────────────
  background: '#ffffff',

  // ── Grid ──────────────────────────────────────────────────────────
  grid: {
    stroke: '#e8e8e8',
    strokeWidth: 0.3,
    opacity: 0.55,
  },

  // ── Teile (Piece) ────────────────────────────────────────────────
  piece: {
    /** Standard-Füllung: keine. Später per Material/Farbe dynamisch. */
    fill: 'none',
    fillOpacity: 0,
    /** Selektiertes Teil: leichte Blau-Tönung */
    fillSelected: 'rgba(74, 165, 255, 0.08)',
    /** Solide Kontur (Schnittlinie oder Nahtlinie je nach Ansicht) */
    stroke: '#000000',
    strokeWidth: 0.5,
    /** Selektiertes Teil: etwas breitere Kontur */
    strokeSelected: '#1565c0',
    strokeWidthSelected: 0.7,
    /** Hover auf Teil */
    strokeHover: '#e53935',
    strokeWidthHover: 0.8,
    /** Gestrichelte Gegen-Kontur (Naht vs Schnitt) */
    strokeDashed: '#888888',
    strokeWidthDashed: 0.5,
    dashOpacity: 0.45,
    /** Hervorgehobenes Segment (Tool-Hover) */
    strokeSegmentHover: '#1565c0',
    strokeWidthSegmentHover: 1.8,
    /** Leeres Teil (kein cutLine) */
    strokeEmpty: '#cccccc',
    /** „Vorher“-Overlay: Kontur vor letzter Änderung (Undo-Stack), nur Anzeige */
    strokeChangePreview: '#1565c0',
    strokeChangePreviewOlder: '#90a4ae',
    strokeWidthChangePreview: 0.45,
  },

  // ── Vertex-Farben ────────────────────────────────────────────────
  vertex: {
    corner: ['#ef5350', '#b71c1c'] as [string, string],
    soft: ['#42a5f5', '#1565c0'] as [string, string],
    curvePoint: ['#66bb6a', '#2e7d32'] as [string, string],
  },

  // ── Kerben (Notches) ─────────────────────────────────────────────
  notch: {
    stroke: '#000000',
    fill: '#ffffff',
    strokeHover: '#1565c0',
  },

  // ── Bohrungen (Drills) ───────────────────────────────────────────
  drill: {
    stroke: '#000000',
    strokeWidth: 0.5,
  },

  // ── Laufrichtung (Grain) ─────────────────────────────────────────
  grain: {
    stroke: '#333333',
    strokeWidth: 0.35,
    dash: '5 3',
    endpoint: '#1565c0',
    endpointStroke: '#ffffff',
  },

  // ── Interne Linien ───────────────────────────────────────────────
  internalLine: {
    stroke: '#1565c0',
    /** Soll mit `* (1/view.zoom)` multipliziert werden → dünne, zoom-unabhängige Strichstärke auf dem Bildschirm. */
    strokeWidth: 0.4,
    dash: '4 3',
    opacity: 0.55,
    strokeHover: '#e53935',
    strokeWidthHover: 0.9,
  },

  // ── Text-Beschriftungen ──────────────────────────────────────────
  text: {
    pieceName: '#333333',
    contourMeasure: '#5d4037',
    edgeAllowance: '#1a6fb5',
    haloStroke: '#ffffff',
  },

  // ── Selektion / UI-Overlays ──────────────────────────────────────
  selection: {
    marqueeFill: 'rgba(21, 101, 192, 0.08)',
    marqueeStroke: '#1565c0',
    marqueeStrokeWidth: 0.8,
    originMark: '#000000',
    pivotFill: '#333333',
    pivotStroke: '#ffffff',
    crosshairStroke: '#333333',
    rotationHandleFill: '#e3f2fd',
    rotationHandleStroke: '#1565c0',
    rotationHandleAccent: '#1565c0',
  },

  // ── Akzentfarben (wiederkehrend) ─────────────────────────────────
  accent: {
    interaction: '#1565c0',
    hover: '#e53935',
    warning: '#e65100',
    error: '#c62828',
    profile: '#7b1fa2',
    success: '#2e7d32',
  },

  // ── Digitalisierung ──────────────────────────────────────────────
  digitize: {
    segment: '#1565c0',
    segmentWidth: 0.8,
    handleLine: '#e65100',
    handleFill: '#e65100',
    handleStroke: '#ffffff',
    handleReflectStroke: '#e65100',
    nodeDefault: '#2196F3',
    nodeDefaultStroke: '#0d47a1',
    nodeNearClose: '#4caf50',
    nodeNearCloseStroke: '#1b5e20',
    preview: '#1565c0',
    previewWidth: 0.6,
  },

  // ── Werkstück-Bild ───────────────────────────────────────────────
  workspaceImage: {
    border: '#1976d2',
    borderLocked: '#e65100',
    handleFill: '#ffffff',
    handleStroke: '#1976d2',
  },

  // ── Notizen ──────────────────────────────────────────────────────
  workspaceNote: {
    fill: '#fff9c4',
    stroke: '#f9a825',
    pinStroke: '#e65100',
  },

  // ── Lineal ───────────────────────────────────────────────────────
  ruler: {
    stroke: '#1565c0',
    endpointFill: '#1565c0',
    endpointStroke: '#ffffff',
    text: '#1565c0',
  },

  // ── Nahtzuordnung / Edge Picking ─────────────────────────────────
  seamAssignment: {
    connector: '#1565c0',
    connectorWidth: 1,
    hoverStroke: '#1565c0',
    hoverWidth: 2.5,
    edgePickHalo: '#e65100',
    edgePickHaloWidth: 5,
    edgePickHaloOpacity: 0.35,
    edgePickStroke: '#e65100',
    edgePickWidth: 2.5,
  },

  // ── Drag-Vorschau (Rechteck, Linie, Bohrung) ────────────────────
  dragPreview: {
    stroke: '#000000',
    strokeWidth: 1,
    dash: '4 2',
  },

  // ── Batch-Selektion ──────────────────────────────────────────────
  batch: {
    ringStroke: '#7b1fa2',
  },

  // ── Export / Übersicht (buildWorkspaceOverviewSvg) ───────────────
  overview: {
    stroke: '#1a1a1a',
    strokeWidth: 0.45,
    strokeSeam: '#888888',
    strokeWidthSeam: 0.5,
    empty: '#bbbbbb',
    textFill: '#1a1a1a',
    textOpacity: 0.7,
  },
}

type Widen<T> =
  T extends readonly [string, string] ? [string, string] :
  T extends string ? string :
  T extends number ? number :
  T extends object ? { [K in keyof T]: Widen<T[K]> } :
  T

export type CanvasTheme = Widen<typeof canvasTheme>

/**
 * Dark-Mode-Variante – alle Farben invertiert/angepasst für dunklen
 * Hintergrund.  Struktur identisch mit `canvasTheme` (Light).
 *
 * Aktivierung: `setCanvasThemeMode('dark')` im Store; WorkspaceCanvas
 * liest dann `canvasThemeDark` statt `canvasTheme`.
 */
export const canvasThemeDark: CanvasTheme = {
  background: '#2D2F31',

  grid: {
    stroke: '#3A3C3E',
    strokeWidth: 0.3,
    opacity: 0.6,
  },

  piece: {
    fill: 'none',
    fillOpacity: 0,
    fillSelected: 'rgba(74, 165, 255, 0.12)',
    stroke: '#ffffff',
    strokeWidth: 0.5,
    strokeSelected: '#4AA5FF',
    strokeWidthSelected: 0.7,
    strokeHover: '#FF5050',
    strokeWidthHover: 0.8,
    strokeDashed: '#999999',
    strokeWidthDashed: 0.5,
    dashOpacity: 0.5,
    strokeSegmentHover: '#4AA5FF',
    strokeWidthSegmentHover: 1.8,
    strokeEmpty: '#555555',
    strokeChangePreview: '#64b5f6',
    strokeChangePreviewOlder: '#546e7a',
    strokeWidthChangePreview: 0.45,
  },

  vertex: {
    corner: ['#FF5050', '#ff8a80'] as [string, string],
    soft: ['#4AA5FF', '#82b1ff'] as [string, string],
    curvePoint: ['#69f0ae', '#b9f6ca'] as [string, string],
  },

  notch: {
    stroke: '#ffffff',
    fill: '#2D2F31',
    strokeHover: '#4AA5FF',
  },

  drill: {
    stroke: '#ffffff',
    strokeWidth: 0.5,
  },

  grain: {
    stroke: '#aaaaaa',
    strokeWidth: 0.35,
    dash: '5 3',
    endpoint: '#4AA5FF',
    endpointStroke: '#2D2F31',
  },

  internalLine: {
    stroke: '#4AA5FF',
    strokeWidth: 0.4,
    dash: '4 3',
    opacity: 0.55,
    strokeHover: '#FF5050',
    strokeWidthHover: 0.9,
  },

  text: {
    pieceName: '#cccccc',
    contourMeasure: '#bcaaa4',
    edgeAllowance: '#64b5f6',
    haloStroke: '#2D2F31',
  },

  selection: {
    marqueeFill: 'rgba(74, 165, 255, 0.1)',
    marqueeStroke: '#4AA5FF',
    marqueeStrokeWidth: 0.8,
    originMark: '#ffffff',
    pivotFill: '#cccccc',
    pivotStroke: '#2D2F31',
    crosshairStroke: '#cccccc',
    rotationHandleFill: '#1a237e',
    rotationHandleStroke: '#4AA5FF',
    rotationHandleAccent: '#4AA5FF',
  },

  accent: {
    interaction: '#4AA5FF',
    hover: '#FF5050',
    warning: '#ffab40',
    error: '#ff5252',
    profile: '#ce93d8',
    success: '#69f0ae',
  },

  digitize: {
    segment: '#4AA5FF',
    segmentWidth: 0.8,
    handleLine: '#ffab40',
    handleFill: '#ffab40',
    handleStroke: '#2D2F31',
    handleReflectStroke: '#ffab40',
    nodeDefault: '#4AA5FF',
    nodeDefaultStroke: '#82b1ff',
    nodeNearClose: '#69f0ae',
    nodeNearCloseStroke: '#b9f6ca',
    preview: '#4AA5FF',
    previewWidth: 0.6,
  },

  workspaceImage: {
    border: '#4AA5FF',
    borderLocked: '#ffab40',
    handleFill: '#2D2F31',
    handleStroke: '#4AA5FF',
  },

  workspaceNote: {
    fill: '#4a4522',
    stroke: '#f9a825',
    pinStroke: '#ffab40',
  },

  ruler: {
    stroke: '#4AA5FF',
    endpointFill: '#4AA5FF',
    endpointStroke: '#2D2F31',
    text: '#4AA5FF',
  },

  seamAssignment: {
    connector: '#4AA5FF',
    connectorWidth: 1,
    hoverStroke: '#4AA5FF',
    hoverWidth: 2.5,
    edgePickHalo: '#ffab40',
    edgePickHaloWidth: 5,
    edgePickHaloOpacity: 0.35,
    edgePickStroke: '#ffab40',
    edgePickWidth: 2.5,
  },

  dragPreview: {
    stroke: '#ffffff',
    strokeWidth: 1,
    dash: '4 2',
  },

  batch: {
    ringStroke: '#ce93d8',
  },

  overview: {
    stroke: '#e0e0e0',
    strokeWidth: 0.45,
    strokeSeam: '#888888',
    strokeWidthSeam: 0.5,
    empty: '#555555',
    textFill: '#e0e0e0',
    textOpacity: 0.7,
  },
} as const
