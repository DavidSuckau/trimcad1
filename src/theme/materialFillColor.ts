/**
 * Arbeitsflächen-Füllfarbe aus Stücklisten-Material: gleiche Bezeichnung → gleiche Farbe.
 * Nur Anzeige; `material` bleibt Freitext in den Teiledaten.
 */

export function materialKeyNormalized(material: string): string {
  return material.trim().toLowerCase().replace(/\s+/g, ' ')
}

function hashStringToHue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return (Math.abs(h) % 360 + 360) % 360
}

/**
 * Pastellfüllung für geschlossene Teilkontur. Leer/unbekannt → null (Theme-Default wie bisher).
 * @param darkMode – an Canvas-Dark-Mode angepasste Sättigung/Helligkeit
 */
export function pieceInteriorFillFromMaterial(
  material: string | undefined | null,
  darkMode: boolean,
): string | null {
  const raw = (material ?? '').trim()
  if (!raw) return null
  const key = materialKeyNormalized(raw)
  const hue = hashStringToHue(key)
  if (darkMode) {
    return `hsl(${hue}, 44%, 42%)`
  }
  return `hsl(${hue}, 52%, 84%)`
}
