import type { Dispatch, SetStateAction } from 'react'

/** setState, das bei gleichem Wert denselben State behält (kein Re-Render). */
export function withStableSetState<T>(
  setState: Dispatch<SetStateAction<T>>,
  equal: (a: T, b: T) => boolean = Object.is,
): Dispatch<SetStateAction<T>> {
  return (action) => {
    setState((prev) => {
      const next = typeof action === 'function' ? (action as (p: T) => T)(prev) : action
      return equal(prev, next) ? prev : next
    })
  }
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!Object.is(a[i], b[i])) return false
    }
    return true
  }
  if (
    a != null &&
    b != null &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    'x' in a &&
    'y' in a &&
    'x' in b &&
    'y' in b
  ) {
    const pa = a as { x: number; y: number }
    const pb = b as { x: number; y: number }
    return Object.is(pa.x, pb.x) && Object.is(pa.y, pb.y)
  }
  return false
}

/** Flacher Vergleich für Hover-Objekte (inkl. number[] und {x,y}). */
export function shallowEqualHover<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true
  if (a == null || b == null) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const keys = Object.keys(ao)
  if (keys.length !== Object.keys(bo).length) return false
  for (const k of keys) {
    if (!valuesEqual(ao[k], bo[k])) return false
  }
  return true
}

/** Client-Position: nur bei spürbarer Bewegung aktualisieren (spart Menü-Re-Renders). */
export function clientPosEqualRough(
  a: { clientX: number; clientY: number } | null,
  b: { clientX: number; clientY: number } | null,
  tolPx = 2,
): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return Math.abs(a.clientX - b.clientX) < tolPx && Math.abs(a.clientY - b.clientY) < tolPx
}
