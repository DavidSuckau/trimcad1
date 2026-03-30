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

  // rock
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

