import { describe, expect, it, vi } from 'vitest'
import type { Dispatch, SetStateAction } from 'react'
import {
  clientPosEqualRough,
  shallowEqualHover,
  withStableSetState,
} from './stableSetState'

describe('stableSetState', () => {
  it('withStableSetState liefert bei Gleichheit denselben prev-Wert zurück', () => {
    const seen: string[] = []
    const tracking = vi.fn((action: SetStateAction<string>) => {
      const prev = seen.length ? seen[seen.length - 1]! : 'a'
      const next = typeof action === 'function' ? action(prev) : action
      seen.push(Object.is(next, prev) ? prev : next)
    }) as Dispatch<SetStateAction<string>>
    const stable = withStableSetState(tracking)
    stable('a')
    stable('a')
    stable('b')
    expect(seen[0]).toBe(seen[1])
    expect(seen[2]).toBe('b')
  })

  it('shallowEqualHover vergleicht curveIndices und Punkte', () => {
    expect(
      shallowEqualHover(
        { pieceId: 'p', curveIndices: [1, 2] },
        { pieceId: 'p', curveIndices: [1, 2] },
      ),
    ).toBe(true)
    expect(
      shallowEqualHover(
        { pieceId: 'p', curveIndices: [1, 2] },
        { pieceId: 'p', curveIndices: [1, 3] },
      ),
    ).toBe(false)
    expect(
      shallowEqualHover({ pieceId: 'p', point: { x: 1, y: 2 } }, { pieceId: 'p', point: { x: 1, y: 2 } }),
    ).toBe(true)
  })

  it('clientPosEqualRough toleriert kleine Pixelabweichung', () => {
    expect(clientPosEqualRough({ clientX: 10, clientY: 10 }, { clientX: 11, clientY: 10 })).toBe(true)
    expect(clientPosEqualRough({ clientX: 10, clientY: 10 }, { clientX: 13, clientY: 10 })).toBe(false)
  })
})
