/** Deutsche Dezimalnotation (z. B. 1,2 oder 1.234,56) → Zahl. */
export function parseDeDecimal(s: string): number | null {
  const t = s.trim().replace(/\s/g, '')
  if (t === '') return null
  const lastComma = t.lastIndexOf(',')
  const lastDot = t.lastIndexOf('.')
  let normalized = t
  if (lastComma > lastDot) {
    normalized = t.replace(/\./g, '').replace(',', '.')
  } else if (lastDot > lastComma) {
    normalized = t.replace(/,/g, '')
  } else if (lastComma >= 0) {
    normalized = t.replace(',', '.')
  }
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

export function formatDeDecimal(n: number | null, fractionDigits = 4): string {
  if (n == null || !Number.isFinite(n)) return ''
  return n.toLocaleString('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  })
}
