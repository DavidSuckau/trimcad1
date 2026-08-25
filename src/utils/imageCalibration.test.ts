import { describe, expect, it } from 'vitest'
import {
  IMAGE_SCALE_REF_MM,
  computeMmPerPixelXYFromRightAngle,
  effectiveMmPerPixelXY,
  imagePixelToWorld,
  worldToImagePixel,
} from './imageCalibration'

describe('computeMmPerPixelXYFromRightAngle', () => {
  it('10×10 cm achsparallel: 200 px / Schenkel → 0.5 mm/px', () => {
    const r = computeMmPerPixelXYFromRightAngle({
      cornerPx: { x: 100, y: 100 },
      armAPx: { x: 300, y: 100 }, // +200 px horizontal
      armBPx: { x: 100, y: 300 }, // +200 px vertical
    })
    expect(r).not.toBeNull()
    expect(r!.mmPerPixelX).toBeCloseTo(IMAGE_SCALE_REF_MM / 200, 6)
    expect(r!.mmPerPixelY).toBeCloseTo(IMAGE_SCALE_REF_MM / 200, 6)
  })

  it('unterschiedliche X/Y-Pixelstrecken → anisotroper Maßstab', () => {
    const r = computeMmPerPixelXYFromRightAngle({
      cornerPx: { x: 0, y: 0 },
      armAPx: { x: 100, y: 0 }, // 100 px = 100 mm → 1 mm/px X
      armBPx: { x: 0, y: 200 }, // 200 px = 100 mm → 0.5 mm/px Y
    })
    expect(r).not.toBeNull()
    expect(r!.mmPerPixelX).toBeCloseTo(1, 6)
    expect(r!.mmPerPixelY).toBeCloseTo(0.5, 6)
  })

  it('vertauschte Arm-Reihenfolge liefert gleiches Ergebnis', () => {
    const a = computeMmPerPixelXYFromRightAngle({
      cornerPx: { x: 0, y: 0 },
      armAPx: { x: 100, y: 0 },
      armBPx: { x: 0, y: 200 },
    })
    const b = computeMmPerPixelXYFromRightAngle({
      cornerPx: { x: 0, y: 0 },
      armAPx: { x: 0, y: 200 },
      armBPx: { x: 100, y: 0 },
    })
    expect(a).toEqual(b)
  })

  it('null bei degenerierten Punkten', () => {
    expect(
      computeMmPerPixelXYFromRightAngle({
        cornerPx: { x: 0, y: 0 },
        armAPx: { x: 0, y: 0 },
        armBPx: { x: 0, y: 100 },
      }),
    ).toBeNull()
  })
})

describe('effectiveMmPerPixelXY / Pixel↔Welt', () => {
  it('Fallback auf isotropes renderMmPerPixel', () => {
    const xy = effectiveMmPerPixelXY({
      imagePosition: { x: 0, y: 0 },
      imageSizePx: { width: 100, height: 100 },
      renderMmPerPixel: 2,
    })
    expect(xy).toEqual({ x: 2, y: 2 })
  })

  it('Welt↔Pixel mit anisotroper Skala rundtrip', () => {
    const session = {
      imagePosition: { x: 50, y: -20 },
      imageSizePx: { width: 200, height: 100 },
      renderMmPerPixel: 1,
      renderMmPerPixelX: 0.5,
      renderMmPerPixelY: 1,
    }
    const xy = effectiveMmPerPixelXY(session)
    const world = { x: 60, y: -10 }
    const px = worldToImagePixel({
      world,
      imagePosition: session.imagePosition,
      imageSizePx: session.imageSizePx,
      mmPerPixelEffective: session.renderMmPerPixel,
      mmPerPixelX: xy.x,
      mmPerPixelY: xy.y,
    })
    const back = imagePixelToWorld({
      pixel: px,
      imagePosition: session.imagePosition,
      imageSizePx: session.imageSizePx,
      mmPerPixelEffective: session.renderMmPerPixel,
      mmPerPixelX: xy.x,
      mmPerPixelY: xy.y,
    })
    expect(back.x).toBeCloseTo(world.x, 6)
    expect(back.y).toBeCloseTo(world.y, 6)
  })
})
