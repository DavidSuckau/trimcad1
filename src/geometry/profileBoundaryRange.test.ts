import { describe, expect, it } from 'vitest'
import {
  deriveProfileBoundaryRangeAtArcLength,
  deriveProfileBoundaryRangeOnPath,
  isProfileBoundaryNotchRole,
  pieceNotchRoleById,
} from './profileBoundaryRange'

describe('isProfileBoundaryNotchRole', () => {
  it('erkennt Nahtanfang, Nahtende und beides', () => {
    expect(isProfileBoundaryNotchRole('nahtanfang')).toBe(true)
    expect(isProfileBoundaryNotchRole('nahtende')).toBe(true)
    expect(isProfileBoundaryNotchRole('beides')).toBe(true)
    expect(isProfileBoundaryNotchRole(undefined)).toBe(false)
  })
})

describe('deriveProfileBoundaryRangeAtArcLength', () => {
  const roles = pieceNotchRoleById({
    notches: [
      { id: 'a', role: 'nahtanfang' },
      { id: 'b', role: 'nahtanfang' },
      { id: 'c', role: 'nahtende' },
    ],
  })

  it('findet Strecke zwischen zwei Kerben gleicher Rolle', () => {
    const notches = [
      { notchId: 'a', arcLength: 10 },
      { notchId: 'b', arcLength: 60 },
    ]
    expect(deriveProfileBoundaryRangeAtArcLength(notches, 35, roles)).toEqual({
      startNotchId: 'a',
      endNotchId: 'b',
    })
  })

  it('findet Strecke zwischen Nahtende und Nahtanfang', () => {
    const notches = [
      { notchId: 'c', arcLength: 20 },
      { notchId: 'a', arcLength: 80 },
    ]
    expect(deriveProfileBoundaryRangeAtArcLength(notches, 50, roles)).toEqual({
      startNotchId: 'c',
      endNotchId: 'a',
    })
  })

  it('Eckpunkt bis Rollen-Kerbe', () => {
    const notches = [{ notchId: 'c', arcLength: 25 }]
    expect(deriveProfileBoundaryRangeAtArcLength(notches, 10, roles)).toEqual({ endNotchId: 'c' })
  })

  it('Rollen-Kerbe bis Eckpunkt', () => {
    const notches = [{ notchId: 'a', arcLength: 25 }]
    expect(deriveProfileBoundaryRangeAtArcLength(notches, 90, roles)).toEqual({ startNotchId: 'a' })
  })

  it('wählt Nachbar-Paar bei drei Rollen-Kerben', () => {
    const notches = [
      { notchId: 'a', arcLength: 10 },
      { notchId: 'b', arcLength: 40 },
      { notchId: 'c', arcLength: 70 },
    ]
    expect(deriveProfileBoundaryRangeAtArcLength(notches, 55, roles)).toEqual({
      startNotchId: 'b',
      endNotchId: 'c',
    })
  })
})

describe('deriveProfileBoundaryRangeOnPath', () => {
  it('liefert bei genau zwei Rollen-Kerben das Zwischensegment', () => {
    const roles = pieceNotchRoleById({
      notches: [
        { id: 'x', role: 'nahtende' },
        { id: 'y', role: 'nahtende' },
      ],
    })
    expect(
      deriveProfileBoundaryRangeOnPath(
        [
          { notchId: 'x', arcLength: 15 },
          { notchId: 'y', arcLength: 55 },
        ],
        roles
      )
    ).toEqual({ startNotchId: 'x', endNotchId: 'y' })
  })
})
