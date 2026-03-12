/**
 * Kerben-Erkennung aus POLYLINE-Vertices.
 * Basierend auf docs/DXF-MASTER-SPEZIFIKATION.txt Kap. 10.
 */

import type { Point } from '../types/model'

export type DxfPoint = { x: number; y: number }

const SHORT_THRESH = 3.0 // mm – max. Segmentlänge für Notch-Erkennung
const ANGLE_THRESH = 45 // Grad – min. Winkelaenderung

/** Berechnet den Winkel zwischen zwei Vektoren (Grad, 0..180). */
function angleBetweenDeg(
  ax: number, ay: number,
  bx: number, by: number
): number {
  const dot = ax * bx + ay * by
  const magA = Math.hypot(ax, ay)
  const magB = Math.hypot(bx, by)
  if (magA < 1e-10 || magB < 1e-10) return 0
  const cos = Math.max(-1, Math.min(1, dot / (magA * magB)))
  return (Math.acos(cos) * 180) / Math.PI
}

function dist(a: DxfPoint, b: DxfPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Prüft, ob der Mittelpunkt eine Einbuchtung nach außen ist.
 * Dazu: Flächeninhalt des Dreiecks (prev, tip, next) – negativ = Einbuchtung nach außen
 * bei mathematisch positivem Umlaufsinn (CCW) der Kontur.
 */
function isExternalIndentation(
  pPrev: DxfPoint,
  pTip: DxfPoint,
  pNext: DxfPoint,
  vertices: DxfPoint[]
): boolean {
  // Signed area of triangle
  const cross = (pTip.x - pPrev.x) * (pNext.y - pPrev.y) - (pTip.y - pPrev.y) * (pNext.x - pPrev.x)
  // Kontur-Umlaufsinn: signed area der gesamten Polygonfläche
  let polygonArea = 0
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]
    const b = vertices[(i + 1) % vertices.length]
    polygonArea += (b.x - a.x) * (a.y + b.y)
  }
  // CCW (positiv) = Außenseite links. Einbuchtung nach außen: tip liegt "rechts" der Kante prev->next.
  // Wenn Kontur CCW: Einbuchtung hat negatives Kreuzprodukt (tip "innen").
  // Vereinfacht: Wir prüfen ob die drei Punkte eine spitze Ecke bilden, die nach innen zeigt.
  // Nach DXF-Spez: "Einbuchtung nach außen" = die Kerbe geht vom Rand weg ins Material.
  // Bei einer Schnittkontur ist "außen" = außerhalb der Kontur = wo geschnitten wird.
  // Die V-Kerbe hat die Spitze (pTip) als den Punkt, der von der Konturlinie aus "eingebuchtet" ist.
  // Für die Erkennung: seg1 und seg2 sind kurz, der Winkel ist groß.
  // Wir akzeptieren sowohl links als auch rechts Einbuchtungen (verschiedene Umlaufrichtungen).
  return Math.abs(cross) > 0.01
}

export type DetectedNotch = {
  position: Point
  angle: number
  depth: number
  width: number
}

/**
 * Erkennt geometrische Kerben (V-Einbuchtungen) in einer Vertex-Liste.
 * Gibt die bereinigte Vertex-Liste (ohne Notch-Punkte) und die erkannten Notches zurück.
 */
export function detectNotchesInPolyline(vertices: DxfPoint[]): {
  cleanedVertices: DxfPoint[]
  notches: DetectedNotch[]
} {
  if (vertices.length < 5) return { cleanedVertices: [...vertices], notches: [] }

  const notches: DetectedNotch[] = []
  const toRemove = new Set<number>()

  for (let i = 1; i < vertices.length - 1; i++) {
    const pPrev = vertices[i - 1]
    const pTip = vertices[i]
    const pNext = vertices[i + 1]

    const seg1 = dist(pPrev, pTip)
    const seg2 = dist(pTip, pNext)
    const v1x = pTip.x - pPrev.x
    const v1y = pTip.y - pPrev.y
    const v2x = pNext.x - pTip.x
    const v2y = pNext.y - pTip.y
    const ang = angleBetweenDeg(v1x, v1y, v2x, v2y)

    if (seg1 < SHORT_THRESH && seg2 < SHORT_THRESH && ang > ANGLE_THRESH) {
      if (isExternalIndentation(pPrev, pTip, pNext, vertices)) {
        toRemove.add(i - 1)
        toRemove.add(i)
        toRemove.add(i + 1)

        const midX = (pPrev.x + pNext.x) / 2
        const midY = (pPrev.y + pNext.y) / 2
        const position: Point = { x: midX, y: midY }

        const inwardAngle = Math.atan2(pTip.y - midY, pTip.x - midX)
        const angle = (inwardAngle * 180) / Math.PI

        const depth = dist({ x: midX, y: midY }, pTip)
        const width = dist(pPrev, pNext)

        notches.push({
          position,
          angle,
          depth: Math.max(1.5, Math.min(5, depth)),
          width: Math.max(2, Math.min(6, width)),
        })

        i += 2
      }
    }
  }

  const cleanedVertices = vertices.filter((_, idx) => !toRemove.has(idx))
  return { cleanedVertices, notches }
}
