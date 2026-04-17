/** Deterministische Farbe pro Profil-Kennung (PROF-002, ohne Benutzer-Palette). */

function hashProfileKey(key: string): number {
  let h = 5381
  for (let i = 0; i < key.length; i++) {
    h = (h * 33) ^ key.charCodeAt(i)
  }
  return Math.abs(h)
}

export function strokeColorForProfileKey(profileKey: string, darkMode: boolean): string {
  const hue = hashProfileKey(profileKey.trim().toUpperCase()) % 360
  if (darkMode) return `hsl(${hue}, 52%, 62%)`
  return `hsl(${hue}, 58%, 42%)`
}
