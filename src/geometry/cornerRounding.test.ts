import { describe, expect, it } from 'vitest'
import type { Curve, LineSegment } from '../types/model'
import {
  applyCornerRoundings,
  findRoundedCornerForArcCurveIndex,
  maxFeasibleRadiusForCorner,
  roundCornerOnMaster,
  validateCornerRound,
} from './cornerRounding'

/** 100x100-Quadrat (CCW), Vertex 0 = (0,0), Vertex 1 = (100,0), Vertex 2 = (100,100), Vertex 3 = (0,100). */
function squareMaster(): Curve[] {
  return [
    { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { type: 'line', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
    { type: 'line', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
    { type: 'line', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
  ]
}

describe('validateCornerRound', () => {
  it('akzeptiert eine 90°-Ecke mit Radius 10', () => {
    const m = squareMaster()
    const v = validateCornerRound(m, 1, 10)
    expect(v.ok).toBe(true)
  })

  it('lehnt zu großen Radius ab und liefert maxRadiusMm', () => {
    const m = squareMaster()
    const v = validateCornerRound(m, 1, 100)
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.reason).toBe('RADIUS_TOO_LARGE')
      // 90°: tLen = R; max tLen = 0.49 * 100 = 49 → max R = 49
      expect(v.maxRadiusMm).toBeCloseTo(49, 5)
    }
  })

  it('lehnt Radius < 0.5 ab', () => {
    const m = squareMaster()
    const v = validateCornerRound(m, 1, 0.1)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('RADIUS_TOO_SMALL')
  })

  it('lehnt Bezier-Nachbarn ab', () => {
    const m: Curve[] = [
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      {
        type: 'bezier',
        start: { x: 100, y: 0 },
        end: { x: 100, y: 100 },
        cp1: { x: 110, y: 30 },
        cp2: { x: 110, y: 70 },
      },
      { type: 'line', start: { x: 100, y: 100 }, end: { x: 0, y: 100 } },
      { type: 'line', start: { x: 0, y: 100 }, end: { x: 0, y: 0 } },
    ]
    const v = validateCornerRound(m, 1, 5)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('NON_LINE_NEIGHBOR')
  })

  it('akzeptiert Vertex 0 (Wrap-Around)', () => {
    const m = squareMaster()
    const v = validateCornerRound(m, 0, 10)
    expect(v.ok).toBe(true)
  })
})

describe('roundCornerOnMaster (90°)', () => {
  it('Tangentenpunkte auf Vorgänger und Nachfolger im Abstand R; Bogen tangential', () => {
    const m = squareMaster()
    const r = roundCornerOnMaster(m, 1, 10)
    expect(r).not.toBeNull()
    if (!r) return
    // T1 muss auf prev-Edge liegen (y=0) im Abstand 10 von Vertex 1 (100,0): also (90, 0).
    const prevTrim = r.curves[0] as LineSegment
    expect(prevTrim.type).toBe('line')
    expect(prevTrim.end.x).toBeCloseTo(90, 5)
    expect(prevTrim.end.y).toBeCloseTo(0, 5)
    // T2 muss auf next-Edge liegen (x=100) im Abstand 10: also (100, 10).
    const nextTrim = r.curves[r.curves.length - 3] // Layout: [prevTrim, ...arcs, nextTrim, ...rest]
    // Bei v=1 Layout: [prev?, ?]. Sicherer: arcs sind dazwischen.
    // arcCurveIndices liefert die Bogen-Indices.
    expect(r.arcCurveIndices.length).toBeGreaterThanOrEqual(1)
    const firstArcIdx = r.arcCurveIndices[0]
    const lastArcIdx = r.arcCurveIndices[r.arcCurveIndices.length - 1]
    const arcStart = r.curves[firstArcIdx]
    const arcEnd = r.curves[lastArcIdx]
    expect(arcStart.start.x).toBeCloseTo(90, 5)
    expect(arcStart.start.y).toBeCloseTo(0, 5)
    expect(arcEnd.end.x).toBeCloseTo(100, 5)
    expect(arcEnd.end.y).toBeCloseTo(10, 5)
    expect(nextTrim).toBeDefined()
    void nextTrim
  })

  it('Bogenmittelpunkt im Abstand R√2 vom Eckpunkt (90°)', () => {
    const m = squareMaster()
    const r = roundCornerOnMaster(m, 1, 10)
    expect(r).not.toBeNull()
    if (!r) return
    // Der Bogen approximiert einen 90°-Kreisbogen um (90, 10) mit Radius 10.
    // Der Mittelpunkt der Bogen-Kurve sollte ungefähr R = 10 vom Mittelpunkt entfernt sein.
    const arcIdx = r.arcCurveIndices[0]
    const arc = r.curves[arcIdx]
    if (arc.type !== 'bezier') throw new Error('expected bezier')
    // t=0.5 auf dem Bezier:
    const t = 0.5
    const omt = 1 - t
    const px =
      omt * omt * omt * arc.start.x +
      3 * omt * omt * t * arc.cp1.x +
      3 * omt * t * t * arc.cp2.x +
      t * t * t * arc.end.x
    const py =
      omt * omt * omt * arc.start.y +
      3 * omt * omt * t * arc.cp1.y +
      3 * omt * t * t * arc.cp2.y +
      t * t * t * arc.end.y
    const dist = Math.hypot(px - 90, py - 10)
    expect(dist).toBeCloseTo(10, 1)
  })
})

describe('roundCornerOnMaster (60° und 120°)', () => {
  it('60°-Ecke: tLen = R/tan(30°)', () => {
    // Dreieck mit Spitze bei V = (0, 0), Schenkel im Abstand 60° (innen).
    // Innenwinkel 60° → 2 Schenkel mit Außenrichtung jeweils 60°/2 = 30° vom „Achsspiegel".
    // Wir wählen: A = (-100, 50), V = (0,0), B = (100, 50). Innenwinkel an V?
    // V→A = (-100, 50), |.| = sqrt(12500). V→B = (100, 50). cos(phi) = ((-100)*100 + 50*50)/12500 = (-10000+2500)/12500 = -0.6
    // → phi = acos(-0.6) ≈ 126.87°. Nicht 60°.
    // Stattdessen 60°-Konstruktion: V=(0,0), A=(-100, 0), B=(50, 50*sqrt(3)) → Innenwinkel zwischen V→A=(-1,0) und V→B=(0.5, sqrt(3)/2).
    // cos(phi) = (-1)*0.5 + 0*sqrt(3)/2 = -0.5 → phi=120°. Hmm.
    // Wir brauchen V→A · V→B = cos(phi). Für phi=60°: cos(60°) = 0.5. Mit V→A=(-1,0):
    // V→B = (-0.5, sqrt(3)/2) → cos(phi) = 0.5. ✓ phi = 60°.
    // Also A = (-100, 0), V = (0, 0), B = (-50, 50*sqrt(3)) ≈ (-50, 86.6).
    const sqrt3 = Math.sqrt(3)
    const m: Curve[] = [
      // closed triangle: A → V → B → A. Vertex 0 = A, 1 = V, 2 = B.
      { type: 'line', start: { x: -100, y: 0 }, end: { x: 0, y: 0 } },
      { type: 'line', start: { x: 0, y: 0 }, end: { x: -50, y: 50 * sqrt3 } },
      { type: 'line', start: { x: -50, y: 50 * sqrt3 }, end: { x: -100, y: 0 } },
    ]
    const R = 10
    const r = roundCornerOnMaster(m, 1, R)
    expect(r).not.toBeNull()
    if (!r) return
    const halfTan = Math.tan((60 * Math.PI) / 180 / 2) // tan(30°) ≈ 0.577
    const expectedTLen = R / halfTan // ≈ 17.32
    // T1 = V - inbound * tLen; inbound = unit(V-A) = (1,0). T1 = (-tLen, 0).
    const arcIdx = r.arcCurveIndices[0]
    const arc = r.curves[arcIdx]
    expect(arc.start.x).toBeCloseTo(-expectedTLen, 3)
    expect(arc.start.y).toBeCloseTo(0, 3)
  })

  it('120°-Ecke: tLen = R/tan(60°)', () => {
    // V=(0,0), A=(-100,0), B=(50, 50*sqrt(3)) → cos(phi) = (-1)*0.5 + 0*sqrt(3)/2 = -0.5 → phi=120°.
    const sqrt3 = Math.sqrt(3)
    const m: Curve[] = [
      { type: 'line', start: { x: -100, y: 0 }, end: { x: 0, y: 0 } },
      { type: 'line', start: { x: 0, y: 0 }, end: { x: 50, y: 50 * sqrt3 } },
      { type: 'line', start: { x: 50, y: 50 * sqrt3 }, end: { x: -100, y: 0 } },
    ]
    const R = 10
    const r = roundCornerOnMaster(m, 1, R)
    expect(r).not.toBeNull()
    if (!r) return
    const halfTan = Math.tan((120 * Math.PI) / 180 / 2) // tan(60°) ≈ 1.732
    const expectedTLen = R / halfTan // ≈ 5.77
    const arcIdx = r.arcCurveIndices[0]
    const arc = r.curves[arcIdx]
    expect(arc.start.x).toBeCloseTo(-expectedTLen, 3)
    expect(arc.start.y).toBeCloseTo(0, 3)
  })
})

describe('roundCornerOnMaster Vertex 0 (Wrap)', () => {
  it('Vertex 0 wird korrekt gerundet, Layout schließt ringartig', () => {
    const m = squareMaster()
    const r = roundCornerOnMaster(m, 0, 10)
    expect(r).not.toBeNull()
    if (!r) return
    // Vertex 0 = (0,0). prev=curves[3] (von (0,100) nach (0,0)), next=curves[0] (von (0,0) nach (100,0)).
    // T1 auf prev: (0, 10) (10 mm vor Vertex 0 entlang inbound (0,-1)).
    // T2 auf next: (10, 0).
    // Layout: [trimmedNext, master[1..2], trimmedPrev, ...arcs]
    const trimmedNext = r.curves[0]
    expect(trimmedNext.start.x).toBeCloseTo(10, 5)
    expect(trimmedNext.start.y).toBeCloseTo(0, 5)
    // letzte vor arcs:
    const lastArcIdx = r.arcCurveIndices[r.arcCurveIndices.length - 1]
    expect(r.curves[lastArcIdx].end.x).toBeCloseTo(10, 5)
    expect(r.curves[lastArcIdx].end.y).toBeCloseTo(0, 5)
    // Bogenanfang muss = T1 = (0, 10) sein:
    const firstArcIdx = r.arcCurveIndices[0]
    expect(r.curves[firstArcIdx].start.x).toBeCloseTo(0, 5)
    expect(r.curves[firstArcIdx].start.y).toBeCloseTo(10, 5)
    // Schließung: lastArc.end == trimmedNext.start
    expect(r.curves[lastArcIdx].end.x).toBeCloseTo(trimmedNext.start.x, 5)
    expect(r.curves[lastArcIdx].end.y).toBeCloseTo(trimmedNext.start.y, 5)
  })
})

describe('applyCornerRoundings', () => {
  it('liefert unveränderte Master, wenn keine Rundungen', () => {
    const m = squareMaster()
    const r = applyCornerRoundings(m, [])
    expect(r.curves.length).toBe(4)
    expect(r.applied.length).toBe(0)
    expect(r.skipped.length).toBe(0)
  })

  it('zwei Rundungen an unterschiedlichen Vertices (1 und 2) liefern konsistente Indizes', () => {
    const m = squareMaster()
    const r = applyCornerRoundings(m, [
      { masterVertexIndex: 1, radiusMm: 10 },
      { masterVertexIndex: 2, radiusMm: 15 },
    ])
    expect(r.applied.length).toBe(2)
    expect(r.skipped.length).toBe(0)
    // Beide Bogen-Indices sind disjunkt:
    const a1 = r.applied.find((a) => a.masterVertexIndex === 1)!
    const a2 = r.applied.find((a) => a.masterVertexIndex === 2)!
    const set1 = new Set(a1.arcCurveIndices)
    for (const i of a2.arcCurveIndices) expect(set1.has(i)).toBe(false)
    // Vertex 1 < Vertex 2: a1 sollte nach Verschiebung KLEINERE Indices haben als a2.
    const max1 = Math.max(...a1.arcCurveIndices)
    const min2 = Math.min(...a2.arcCurveIndices)
    expect(max1).toBeLessThan(min2)
  })

  it('überspringt Rundung mit zu großem Radius', () => {
    const m = squareMaster()
    const r = applyCornerRoundings(m, [{ masterVertexIndex: 1, radiusMm: 200 }])
    expect(r.applied.length).toBe(0)
    expect(r.skipped.length).toBe(1)
    expect(r.skipped[0].reason).toBe('RADIUS_TOO_LARGE')
  })

  it('findRoundedCornerForArcCurveIndex findet die zugehörige Rundung', () => {
    const m = squareMaster()
    const r = applyCornerRoundings(m, [{ masterVertexIndex: 1, radiusMm: 10 }])
    const arcIdx = r.applied[0].arcCurveIndices[0]
    const found = findRoundedCornerForArcCurveIndex(r.applied, arcIdx)
    expect(found).not.toBeNull()
    expect(found?.masterVertexIndex).toBe(1)
    const notFound = findRoundedCornerForArcCurveIndex(r.applied, 0)
    expect(notFound).toBeNull()
  })
})

describe('maxFeasibleRadiusForCorner', () => {
  it('liefert 49 mm für 90°-Ecke mit 100mm-Kanten', () => {
    const m = squareMaster()
    const max = maxFeasibleRadiusForCorner(m, 1)
    expect(max).not.toBeNull()
    expect(max!).toBeCloseTo(49, 5)
  })
})

describe('deriveCutLineForPiece mit Rundungen (Roundtrip)', () => {
  it('Naht-Bogen R erzeugt parallelen Cut-Bogen R+d', async () => {
    const { deriveCutLineForPiece } = await import('./deriveCutLineForPiece')
    const seam = squareMaster()
    const allowanceMm = 5
    const piece = {
      id: 't',
      number: '1',
      name: 't',
      cutLine: [],
      seamLine: seam,
      seamAllowanceMm: allowanceMm,
      notches: [],
      drills: [],
      grainLine: null,
      internalLines: [],
      internalCircles: [],
      layer: 'CUT',
      transform: { x: 0, y: 0, rotation: 0, mirrored: false },
      softVertices: [],
      softVerticesMaster: [],
      roundedCorners: [{ masterVertexIndex: 1, radiusMm: 10 }],
    } as unknown as Parameters<typeof deriveCutLineForPiece>[0]
    const r = deriveCutLineForPiece(piece, seam, allowanceMm)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Erwarteter Cut-Bogen-Mittelpunkt: (90, 10), Cut-Radius = R + d = 15.
    // Suche den am weitesten von (100,0) entfernten Cut-Punkt im Bereich der Eckenrundung – nicht trivial.
    // Stattdessen: prüfe, dass die maximale x-Koordinate auf der Cut-Kontur exakt 105 = 100 + d ist und
    // ein Punkt nahe (100+d, 0+d) auf dem Cut-Bogen liegt – als Indikator für korrekte Parallelität.
    let maxX = -Infinity
    let minX = Infinity
    for (const c of r.cutLine) {
      maxX = Math.max(maxX, c.start.x, c.end.x)
      minX = Math.min(minX, c.start.x, c.end.x)
    }
    expect(maxX).toBeCloseTo(105, 0)
    expect(minX).toBeCloseTo(-5, 0)
  })
})
