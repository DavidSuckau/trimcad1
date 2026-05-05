import type { ConfiguratorKindId, ConfiguratorPartId, ConfiguratorPartParams } from './types'

export type DefaultPartDef = {
  partId: ConfiguratorPartId
  label: string
  params: ConfiguratorPartParams
}

export function getDefaultConfiguratorParts(kindId: ConfiguratorKindId): DefaultPartDef[] {
  // Placeholder-Defaults: erst Architektur + getrennte Bearbeitung, danach Geometrie präzisieren.
  if (kindId === 'tshirt') {
    return [
      {
        partId: 'front',
        label: 'Vorderteil',
        params: { widthMm: 320, heightMm: 650, offsetX: 0, offsetY: 0 },
      },
      {
        partId: 'back',
        label: 'Rückenteil',
        params: { widthMm: 320, heightMm: 650, offsetX: 380, offsetY: 0 },
      },
    ]
  }

  if (kindId === 'rock') {
    return [
      {
        partId: 'front',
        label: 'Vorderteil',
        // Fürs MVP: Breite = Taillenumfang/2, Flare aus Hüfte - Taille abgeleitet.
        params: {
          widthMm: 400,
          heightMm: 600,
          waistToHipMm: 180,
          hipWidthMm: 500,
          hemWidthMm: 530,
          dartLengthMm: 140,
          dartOpeningMm: 24,
          dartPosLeftRatio: 0.28,
          dartPosRightRatio: 0.72,
          offsetX: 0,
          offsetY: 0,
        },
      },
      {
        partId: 'back',
        label: 'Rückenteil',
        params: {
          widthMm: 400,
          heightMm: 600,
          waistToHipMm: 180,
          hipWidthMm: 500,
          hemWidthMm: 530,
          dartLengthMm: 140,
          dartOpeningMm: 24,
          dartPosLeftRatio: 0.28,
          dartPosRightRatio: 0.72,
          offsetX: 480,
          offsetY: 0,
        },
      },
    ]
  }

  const boxWidthMm = 220
  const boxLengthMm = 160
  const boxHeightMm = 120
  const shared = {
    widthMm: boxWidthMm,
    heightMm: boxHeightMm,
    boxWidthMm,
    boxLengthMm,
    boxHeightMm,
    materialThicknessMm: 3,
    fingerCount: 7,
    kerfMm: 0.15,
    fitToleranceMm: 0.05,
    lidType: 'removable' as const,
    materialType: 'wood' as const,
    openTop: false,
    openBottom: false,
  }
  return [
    {
      partId: 'front',
      label: 'Front',
      params: {
        ...shared,
        offsetX: 0,
        offsetY: 0,
      },
    },
    {
      partId: 'back',
      label: 'Back',
      params: {
        ...shared,
        offsetX: boxWidthMm + 70,
        offsetY: 0,
      },
    },
    {
      partId: 'left',
      label: 'Left',
      params: {
        ...shared,
        offsetX: 0,
        offsetY: boxHeightMm + 70,
      },
    },
    {
      partId: 'right',
      label: 'Right',
      params: {
        ...shared,
        offsetX: boxLengthMm + 70,
        offsetY: boxHeightMm + 70,
      },
    },
    {
      partId: 'bottom',
      label: 'Bottom',
      params: {
        ...shared,
        widthMm: boxWidthMm,
        heightMm: boxLengthMm,
        offsetX: boxLengthMm * 2 + 100,
        offsetY: 0,
      },
    },
  ]
}

