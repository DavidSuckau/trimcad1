/**
 * Heuristiken für nicht unterstützte oder problematische DXF-Varianten.
 */

export function isBinaryDxf(text: string): boolean {
  if (text.includes('\0')) return true
  if (text.startsWith('AutoCAD Binary DXF')) return true
  return false
}

/** Grober Text-Scan auf Entity-Namen (ASCII), die der Parser nicht verarbeitet. */
export function scanUnsupportedEntityHints(text: string): string[] {
  const found = new Set<string>()
  const u = text
  const patterns: Array<[RegExp, string]> = [
    [/\n0\nSPLINE\n/i, 'SPLINE'],
    [/\n0\nELLIPSE\n/i, 'ELLIPSE'],
    [/\n0\nSOLID\n/i, 'SOLID'],
    [/\n0\n3DFACE\n/i, '3DFACE'],
    [/\n0\nMTEXT\n/i, 'MTEXT'],
    [/\n0\nTEXT\n/i, 'TEXT'],
  ]
  for (const [re, name] of patterns) {
    if (re.test(u)) found.add(name)
  }
  return [...found]
}
