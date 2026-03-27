import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'

type BodyMeasuresCm = {
  groesseCm: number
  brustumfangCm: number
  tailleCm: number
  hueftumfangCm: number
  rocklaengeCm: number
}

const STANDARD_BODY: BodyMeasuresCm = {
  groesseCm: 170,
  brustumfangCm: 90,
  tailleCm: 76,
  hueftumfangCm: 96,
  rocklaengeCm: 60,
}

const UNIT_PER_CM = 4
const BASE_HEIGHT_REF_CM = 170

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

type SvgPoint = { x: number; y: number }

function computeBodySvgModel(m: BodyMeasuresCm) {
  const cx = 100
  const scaleY = m.groesseCm / BASE_HEIGHT_REF_CM

  const diameter = (circ: number) => circ / Math.PI

  // Breiten (vereinfacht aus Umfängen abgeleitet)
  const xHalfShoulder = (diameter(m.brustumfangCm) * UNIT_PER_CM) / 2 * 0.72
  const xHalfWaist = (diameter(m.tailleCm) * UNIT_PER_CM) / 2
  const xHalfHip = (diameter(m.hueftumfangCm) * UNIT_PER_CM) / 2

  const clampX = (x: number) => clamp(x, 10, 92)
  const shoulderHalf = clampX(xHalfShoulder)
  const waistHalf = clampX(xHalfWaist)
  const hipHalf = clampX(xHalfHip)

  // y-Positionen (SVG viewBox: 0..450)
  const yHead = clamp(18 * scaleY, 12, 40)
  const yShoulder = clamp(70 * scaleY, 35, 110)
  const yBust = clamp(120 * scaleY, 70, 180)
  const yWaist = clamp(210 * scaleY, 95, 240)
  const yHip = clamp(285 * scaleY, 150, 320)
  const yThigh = clamp(340 * scaleY, 230, 360)
  const yKnee = clamp(385 * scaleY, 280, 410)
  const yAnkle = clamp(430 * scaleY, 320, 450)

  const headRy = clamp(22 * scaleY, 12, 32)
  const headRx = clamp(16 * scaleY + shoulderHalf * 0.05, 12, 28)

  // Silhouette (Outer)
  const outerLeft: SvgPoint[] = [
    { x: cx - shoulderHalf, y: yShoulder },
    { x: cx - shoulderHalf * 0.95, y: yBust },
    { x: cx - waistHalf, y: yWaist },
    { x: cx - hipHalf, y: yHip },
    { x: cx - hipHalf * 0.86, y: yThigh },
    { x: cx - hipHalf * 0.62, y: yKnee },
    { x: cx - hipHalf * 0.44, y: yAnkle },
  ]

  const outerRight = outerLeft
    .slice()
    .reverse()
    .map((p) => ({ x: cx + (cx - p.x), y: p.y }))

  const silhouette = [...outerLeft, ...outerRight]

  // Konstruktion: “Ecken” / Linien
  const midLineX = cx
  const waistLineY = yWaist
  const hipLineY = yHip
  const shoulderLineY = yShoulder

  const shoulderL: SvgPoint = { x: cx - shoulderHalf, y: yShoulder }
  const shoulderR: SvgPoint = { x: cx + shoulderHalf, y: yShoulder }
  const waistL: SvgPoint = { x: cx - waistHalf, y: yWaist }
  const waistR: SvgPoint = { x: cx + waistHalf, y: yWaist }
  const hipL: SvgPoint = { x: cx - hipHalf, y: yHip }
  const hipR: SvgPoint = { x: cx + hipHalf, y: yHip }

  // Beine (vereinfachte 2-teilige Linien)
  const legInnerX = cx - hipHalf * 0.22
  const legOuterLeftX = cx - hipHalf * 0.86

  const leftOuterLeg: SvgPoint[] = [
    { x: legOuterLeftX, y: yHip },
    { x: cx - hipHalf * 0.78, y: yThigh },
    { x: cx - hipHalf * 0.56, y: yKnee },
    { x: cx - hipHalf * 0.40, y: yAnkle },
  ]
  const leftInnerLeg: SvgPoint[] = [
    { x: legInnerX, y: yHip },
    { x: cx - hipHalf * 0.58, y: yThigh },
    { x: cx - hipHalf * 0.40, y: yKnee },
    { x: cx - hipHalf * 0.26, y: yAnkle },
  ]
  const rightOuterLeg = leftOuterLeg.map((p) => ({ x: cx + (cx - p.x), y: p.y })).reverse()
  const rightInnerLeg = leftInnerLeg.map((p) => ({ x: cx + (cx - p.x), y: p.y })).reverse()

  // Arme (nur als Hinweis)
  const armL0 = { x: cx - shoulderHalf * 0.92, y: yShoulder + headRy * 0.10 }
  const armL1 = { x: cx - hipHalf * 0.42, y: yHip + (yThigh - yHip) * 0.20 }
  const armR0 = { x: cx + shoulderHalf * 0.92, y: yShoulder + headRy * 0.10 }
  const armR1 = { x: cx + hipHalf * 0.42, y: yHip + (yThigh - yHip) * 0.20 }

  return {
    cx,
    midLineX,
    head: { cx, cy: yHead + headRy * 0.35, rx: headRx, ry: headRy },
    shoulderLineY,
    waistLineY,
    hipLineY,
    silhouette,
    shoulderL,
    shoulderR,
    waistL,
    waistR,
    hipL,
    hipR,
    outerLeft,
    leftOuterLeg,
    leftInnerLeg,
    rightOuterLeg,
    rightInnerLeg,
    armL0,
    armL1,
    armR0,
    armR1,
    yAnkle,
  }
}

function computeRockParamsFromBodyMeasures(m: BodyMeasuresCm) {
  // Grundschnitt-Ecken:
  // - Breite an der Taille (aus Taillenumfang)
  // - Breite an der Hüfte (aus Hüftumfang)
  // - Flare von Taille -> Hüfte über die Länge, plus leichter Saumzuschlag
  const mmPerCm = 10

  const easeWaistMm = 20
  const easeHipMm = 20
  const waistWidthMm = Math.max(20, (m.tailleCm * mmPerCm) / 2 + easeWaistMm)
  const hipWidthMm = Math.max(20, (m.hueftumfangCm * mmPerCm) / 2 + easeHipMm)

  const waistToHipCm = clamp(m.groesseCm * 0.1, 14, 22)
  const waistToHipMm = waistToHipCm * mmPerCm

  const rockHeightMm = Math.max(20, m.rocklaengeCm * mmPerCm)

  const flareFromWaistToHipMm = Math.max(0, hipWidthMm - waistWidthMm) * 0.15
  const hemExtraMm = 20
  const hemWidthMm = Math.max(waistWidthMm, hipWidthMm + flareFromWaistToHipMm + hemExtraMm)

  // Platzierung der beiden Panels im Editor (damit sie nicht überlappen)
  const frontOffsetX = 0
  const backOffsetX = waistWidthMm + 120

  return {
    widthMm: waistWidthMm,
    heightMm: rockHeightMm,
    waistToHipMm,
    hipWidthMm,
    hemWidthMm,
    frontOffsetX,
    backOffsetX,
    offsetY: 0,
  }
}

export function RockGeneratorModal() {
  const rockGeneratorModalOpen = useStore((s) => s.rockGeneratorModalOpen)
  const setShowRockGeneratorModal = useStore((s) => s.setShowRockGeneratorModal)

  const createConfiguratorInstance = useStore((s) => s.createConfiguratorInstance)
  const updateConfiguratorPartParams = useStore((s) => s.updateConfiguratorPartParams)
  const regenerateConfiguratorPart = useStore((s) => s.regenerateConfiguratorPart)
  const setShowConfiguratorModal = useStore((s) => s.setShowConfiguratorModal)

  const [measures, setMeasures] = useState<BodyMeasuresCm>({ ...STANDARD_BODY })

  useEffect(() => {
    if (rockGeneratorModalOpen) setMeasures({ ...STANDARD_BODY })
  }, [rockGeneratorModalOpen])

  const svgModel = useMemo(() => computeBodySvgModel(measures), [measures])
  const rockParams = useMemo(() => computeRockParamsFromBodyMeasures(measures), [measures])
  const dartSvgLines = useMemo(() => {
    // Darstellung der Abnäher (Wedge-Kanten) in der SVG-Vorschau.
    const waistWidthSvg = svgModel.waistR.x - svgModel.waistL.x
    const cx = svgModel.midLineX
    const yWaist = svgModel.waistLineY
    const yTip = svgModel.hipLineY * 0.78

    const leftTipX = cx - waistWidthSvg * 0.22
    const rightTipX = cx + waistWidthSvg * 0.22
    const dartOpeningSvg = waistWidthSvg * 0.06

    const leftStartL = leftTipX - dartOpeningSvg
    const leftStartR = leftTipX + dartOpeningSvg
    const rightStartL = rightTipX - dartOpeningSvg
    const rightStartR = rightTipX + dartOpeningSvg

    return [
      { x1: leftStartL, y1: yWaist, x2: leftTipX, y2: yTip },
      { x1: leftStartR, y1: yWaist, x2: leftTipX, y2: yTip },
      { x1: rightStartL, y1: yWaist, x2: rightTipX, y2: yTip },
      { x1: rightStartR, y1: yWaist, x2: rightTipX, y2: yTip },
    ]
  }, [svgModel])

  if (!rockGeneratorModalOpen) return null

  const setField = (key: keyof BodyMeasuresCm, value: number) => {
    setMeasures((s) => ({ ...s, [key]: value }))
  }

  const onCreateRock = () => {
    const instanceId = createConfiguratorInstance('rock')

    // Vorder-/Rückenteil jeweils als eigenes Piece im Workspace
    updateConfiguratorPartParams(instanceId, 'front', {
      widthMm: rockParams.widthMm,
      heightMm: rockParams.heightMm,
      waistToHipMm: rockParams.waistToHipMm,
      hipWidthMm: rockParams.hipWidthMm,
      hemWidthMm: rockParams.hemWidthMm,
      offsetX: rockParams.frontOffsetX,
      offsetY: rockParams.offsetY,
    })
    updateConfiguratorPartParams(instanceId, 'back', {
      widthMm: rockParams.widthMm,
      heightMm: rockParams.heightMm,
      waistToHipMm: rockParams.waistToHipMm,
      hipWidthMm: rockParams.hipWidthMm,
      hemWidthMm: rockParams.hemWidthMm,
      offsetX: rockParams.backOffsetX,
      offsetY: rockParams.offsetY,
    })
    regenerateConfiguratorPart(instanceId, 'front')
    regenerateConfiguratorPart(instanceId, 'back')

    setShowRockGeneratorModal(false)
    setShowConfiguratorModal(true)
  }

  const valid =
    Number.isFinite(measures.groesseCm) &&
    measures.groesseCm > 120 &&
    Number.isFinite(measures.hueftumfangCm) &&
    measures.hueftumfangCm > 40 &&
    Number.isFinite(measures.tailleCm) &&
    measures.tailleCm > 40 &&
    Number.isFinite(measures.brustumfangCm) &&
    measures.brustumfangCm > 40 &&
    Number.isFinite(measures.rocklaengeCm) &&
    measures.rocklaengeCm > 10

  return (
    <div className="nahtzugabe-dialog-overlay" onClick={() => setShowRockGeneratorModal(false)} role="presentation">
      <div className="nahtzugabe-dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 820 }}>
        <h3 className="nahtzugabe-dialog-title">Rock-Konfigurator (Generator)</h3>

        <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
          <div style={{ flex: '0 0 320px' }}>
            <p className="nahtzugabe-dialog-hint" style={{ marginTop: 0 }}>
              SVG-Vorschau (vereinfachte Silhouette) – dient nur als Orientierung.
            </p>
            <div
              style={{
                border: '1px solid #ddd',
                borderRadius: 8,
                padding: 10,
                background: '#fff',
                display: 'flex',
                justifyContent: 'center',
              }}
            >
              <svg width="280" height="520" viewBox="0 0 200 450" style={{ display: 'block' }}>
                {/* Konstruktion */}
                <line x1={svgModel.midLineX} x2={svgModel.midLineX} y1={10} y2={450} stroke="#bdbdbd" strokeWidth="1" />

                <line x1="20" x2="180" y1={svgModel.shoulderLineY} y2={svgModel.shoulderLineY} stroke="#cfcfcf" strokeWidth="1" />
                <line x1="20" x2="180" y1={svgModel.waistLineY} y2={svgModel.waistLineY} stroke="#cfcfcf" strokeWidth="1" />
                <line x1="20" x2="180" y1={svgModel.hipLineY} y2={svgModel.hipLineY} stroke="#cfcfcf" strokeWidth="1" />

                {/* Kopf */}
                <ellipse cx={svgModel.head.cx} cy={svgModel.head.cy} rx={svgModel.head.rx} ry={svgModel.head.ry} fill="none" stroke="#000" strokeWidth="2" />

                {/* Arme (Hinweislinien) */}
                <line x1={svgModel.armL0.x} x2={svgModel.armL1.x} y1={svgModel.armL0.y} y2={svgModel.armL1.y} stroke="#757575" strokeWidth="1.5" />
                <line x1={svgModel.armR0.x} x2={svgModel.armR1.x} y1={svgModel.armR0.y} y2={svgModel.armR1.y} stroke="#757575" strokeWidth="1.5" />

                {/* Beine */}
                <polyline
                  points={svgModel.leftOuterLeg.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                  fill="none"
                  stroke="#4f4f4f"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <polyline
                  points={svgModel.leftInnerLeg.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                  fill="none"
                  stroke="#4f4f4f"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                  strokeDasharray="4 3"
                />
                <polyline
                  points={svgModel.rightOuterLeg.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                  fill="none"
                  stroke="#4f4f4f"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <polyline
                  points={svgModel.rightInnerLeg.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                  fill="none"
                  stroke="#4f4f4f"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                  strokeDasharray="4 3"
                />

                {/* Silhouette */}
                <polyline
                  points={svgModel.silhouette.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                  fill="none"
                  stroke="#000"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />

                {/* Abnäher (Vorschau) */}
                {dartSvgLines.map((l, idx) => (
                  <line key={idx} x1={l.x1} x2={l.x2} y1={l.y1} y2={l.y2} stroke="#d32f2f" strokeWidth="1.6" />
                ))}

                {/* Markierungen (Ecken) */}
                {[
                  { p: svgModel.shoulderL, label: 'Schulter' },
                  { p: svgModel.waistL, label: 'Taille' },
                  { p: svgModel.hipL, label: 'Huefte' },
                ].map((item) => (
                  <g key={item.label}>
                    <circle cx={item.p.x} cy={item.p.y} r="3.2" fill="#1976d2" />
                  </g>
                ))}
              </svg>
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <label className="nahtzugabe-dialog-label" style={{ minWidth: 160 }}>
                <span>Größe (cm)</span>
                <input
                  type="number"
                  className="nahtzugabe-dialog-input"
                  value={measures.groesseCm}
                  onChange={(e) => setField('groesseCm', clamp(Number(e.target.value), 120, 250))}
                />
              </label>
              <label className="nahtzugabe-dialog-label" style={{ minWidth: 160 }}>
                <span>Brustumfang (cm)</span>
                <input
                  type="number"
                  className="nahtzugabe-dialog-input"
                  value={measures.brustumfangCm}
                  onChange={(e) => setField('brustumfangCm', clamp(Number(e.target.value), 50, 140))}
                />
              </label>
              <label className="nahtzugabe-dialog-label" style={{ minWidth: 160 }}>
                <span>Taillenumfang (cm)</span>
                <input
                  type="number"
                  className="nahtzugabe-dialog-input"
                  value={measures.tailleCm}
                  onChange={(e) => setField('tailleCm', clamp(Number(e.target.value), 40, 140))}
                />
              </label>
              <label className="nahtzugabe-dialog-label" style={{ minWidth: 160 }}>
                <span>Hüftumfang (cm)</span>
                <input
                  type="number"
                  className="nahtzugabe-dialog-input"
                  value={measures.hueftumfangCm}
                  onChange={(e) => setField('hueftumfangCm', clamp(Number(e.target.value), 50, 180))}
                />
              </label>
              <label className="nahtzugabe-dialog-label" style={{ minWidth: 160 }}>
                <span>Rocklänge (cm)</span>
                <input
                  type="number"
                  className="nahtzugabe-dialog-input"
                  value={measures.rocklaengeCm}
                  onChange={(e) => setField('rocklaengeCm', clamp(Number(e.target.value), 10, 120))}
                />
              </label>
            </div>

            <div style={{ marginTop: 14 }}>
              <p className="nahtzugabe-dialog-hint" style={{ marginTop: 0 }}>
                Abgeleitet (Platzhalter-Muster):
              </p>
              <div style={{ fontSize: 13, color: '#222' }}>
                Breite je Teil: <strong>{Math.round(rockParams.widthMm)} mm</strong>
                <br />
                Höhe (Rocklänge): <strong>{Math.round(rockParams.heightMm)} mm</strong>
              </div>
            </div>

            <div className="nahtzugabe-dialog-actions" style={{ marginTop: 16 }}>
              <button type="button" className="sidebar-btn" onClick={() => setMeasures({ ...STANDARD_BODY })}>
                Standard Normal Körper
              </button>
              <button type="button" className="sidebar-btn primary" disabled={!valid} onClick={onCreateRock}>
                Rock erstellen
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

