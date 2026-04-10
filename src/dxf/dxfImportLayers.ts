/**
 * Layer-Namen für DXF-Import (Fremdsysteme, ASTM/AAMA-ähnlich).
 * Namen werden normalisiert (trim, uppercase) vor dem Abgleich.
 */

export function normalizeDxfLayerName(layer: string): string {
  return layer.trim().toUpperCase()
}

/** Schnittkontur / Außenlinie (wird zu einem PatternPiece.cutLine). */
export const CUT_LAYER_NAMES = new Set(
  [
    'CUT',
    '1',
    'BOUNDARY',
    '0',
    'CUTLINE',
    'NATLINE',
    'OUTLINE',
    'CONTOUR',
    'PIECE',
    'PATTERN',
    'SHAPE',
    'PART',
    'SHELL',
    'MODEL',
    'GEOMETRY',
  ].map((s) => s.toUpperCase())
)

/** Nahtlinie (Innenlinie). */
export const SEAM_LAYER_NAMES = new Set(
  ['SEAM', '14', 'SEW', 'NAHT', 'STITCH', 'INSEAM'].map((s) => s.toUpperCase())
)

/** Kerben als LINE-Entity (Layer → Notch-Typ). */
const NOTCH_ENTRIES: Array<[string, 'single' | 'double' | 'v']> = [
  ['4', 'single'],
  ['80', 'single'],
  ['81', 'double'],
  ['82', 'v'],
  ['83', 'single'],
  ['NOTCH', 'single'],
  ['NOTCHES', 'single'],
  ['SLIT', 'single'],
  ['T-NOTCH', 'single'],
  ['CASTLE', 'double'],
  ['CHECK', 'v'],
  ['U-NOTCH', 'single'],
  ['MARK', 'single'],
  ['NICK', 'single'],
  ['SCORE', 'single'],
  ['KERBE', 'single'],
  ['KERBEN', 'single'],
]

export const NOTCH_LAYER_TO_TYPE = new Map<string, 'single' | 'double' | 'v'>(
  NOTCH_ENTRIES.map(([k, v]) => [k.toUpperCase(), v])
)

/** Bohrungen (CIRCLE). */
export const DRILL_LAYER_NAMES = new Set(
  ['DRILL', '13', 'HOLE', 'BOHR', 'PUNCH', 'MARKER'].map((s) => s.toUpperCase())
)

/** Fadenlauf (LINE). */
export const GRAIN_LAYER_NAMES = new Set(
  ['GRAIN', '7', 'GRAINLINE', 'FADENLAUF', 'THREAD', 'FIBRE'].map((s) => s.toUpperCase())
)

export function isCutLayer(layer: string, extraCutLayers: readonly string[]): boolean {
  const n = normalizeDxfLayerName(layer)
  if (CUT_LAYER_NAMES.has(n)) return true
  for (const ex of extraCutLayers) {
    if (normalizeDxfLayerName(ex) === n) return true
  }
  return false
}

export function isSeamLayer(layer: string): boolean {
  return SEAM_LAYER_NAMES.has(normalizeDxfLayerName(layer))
}

export function isNotchLineLayer(layer: string): boolean {
  return NOTCH_LAYER_TO_TYPE.has(normalizeDxfLayerName(layer))
}

export function notchTypeForLayer(layer: string): 'single' | 'double' | 'v' {
  return NOTCH_LAYER_TO_TYPE.get(normalizeDxfLayerName(layer)) ?? 'single'
}

export function isDrillLayer(layer: string): boolean {
  return DRILL_LAYER_NAMES.has(normalizeDxfLayerName(layer))
}

export function isGrainLayer(layer: string): boolean {
  return GRAIN_LAYER_NAMES.has(normalizeDxfLayerName(layer))
}

/** Layer, die bei Fallback-Import (kein bekannter Schnitt-Layer) nicht als Kontur gelten. */
export function isExcludedLayerFallback(layer: string): boolean {
  const n = normalizeDxfLayerName(layer)
  if (SEAM_LAYER_NAMES.has(n)) return true
  if (NOTCH_LAYER_TO_TYPE.has(n)) return true
  if (DRILL_LAYER_NAMES.has(n)) return true
  if (GRAIN_LAYER_NAMES.has(n)) return true
  const sub = ['TEXT', 'DIMENSION', 'AXIS', 'DEFPOINTS', 'HATCH', 'CENTER', 'HIDDEN', 'DOTS', 'PHANTOM', 'VIEWPORT', 'TITLE', 'GRID', 'CONSTRUCTION', 'M-TEXT', 'LEADER', 'ATTDEF', 'ANNOTATION']
  for (const s of sub) {
    if (n.includes(s)) return true
  }
  return false
}
