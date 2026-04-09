import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'

type BodyMeasuresCm = {
  groesseCm: number
  tailleCm: number
  hueftumfangCm: number
  rocklaengeCm: number
}

const STANDARD_BODY: BodyMeasuresCm = {
  groesseCm: 170,
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
  // Schulterbreite grob aus Taille/Hüfte angenähert (Brustumfang wird bewusst nicht verwendet).
  const pseudoUpperTorsoCm = (m.tailleCm * 0.45 + m.hueftumfangCm * 0.55)
  const xHalfShoulder = (diameter(pseudoUpperTorsoCm) * UNIT_PER_CM) / 2 * 0.72
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
  const dartLengthMm = waistToHipMm * 0.78
  const dartOpeningMm = Math.max(12, waistWidthMm * 0.06)
  const dartPosLeftRatio = 0.28
  const dartPosRightRatio = 0.72

  // Platzierung der beiden Panels im Editor (damit sie nicht überlappen)
  const frontOffsetX = 0
  const backOffsetX = waistWidthMm + 120

  return {
    widthMm: waistWidthMm,
    heightMm: rockHeightMm,
    waistToHipMm,
    hipWidthMm,
    hemWidthMm,
    dartLengthMm,
    dartOpeningMm,
    dartPosLeftRatio,
    dartPosRightRatio,
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
  const [showTechnicalPreview, setShowTechnicalPreview] = useState(false)
  const photoPreviewUrl = `${import.meta.env.BASE_URL}rock-preview-photo.png?v=20260327-1`
  const [openAiApiKey, setOpenAiApiKey] = useState('')
  const [personPrompt, setPersonPrompt] = useState('')
  const [rockColor, setRockColor] = useState('#1a1a1a')
  const [beltColor, setBeltColor] = useState('#3a3a3a')
  const [stylePrompt, setStylePrompt] = useState('schlicht, elegant, fotorealistisch')
  const [isGeneratingAi, setIsGeneratingAi] = useState(false)
  const [aiPreviewUrl, setAiPreviewUrl] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)

  useEffect(() => {
    if (rockGeneratorModalOpen) {
      setMeasures({ ...STANDARD_BODY })
      setShowTechnicalPreview(false)
    }
  }, [rockGeneratorModalOpen])

  useEffect(() => {
    return () => {
      if (aiPreviewUrl && aiPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(aiPreviewUrl)
      }
    }
  }, [aiPreviewUrl])

  const svgModel = useMemo(() => computeBodySvgModel(measures), [measures])
  const rockParams = useMemo(() => computeRockParamsFromBodyMeasures(measures), [measures])
  const activePhotoPreviewUrl = aiPreviewUrl ?? photoPreviewUrl
  const dartSvgLines = useMemo(() => {
    // Darstellung der Abnäher (Wedge-Kanten) in der SVG-Vorschau.
    const waistWidthSvg = svgModel.waistR.x - svgModel.waistL.x
    const xLeft = svgModel.waistL.x
    const yWaist = svgModel.waistLineY
    const yHip = svgModel.hipLineY

    const yTip = yWaist + (yHip - yWaist) * 0.78
    const leftTipX = xLeft + waistWidthSvg * (rockParams.dartPosLeftRatio ?? 0.28)
    const rightTipX = xLeft + waistWidthSvg * (rockParams.dartPosRightRatio ?? 0.72)
    const dartOpeningSvg = Math.max(2, (rockParams.dartOpeningMm ?? 24) * 0.1)

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
  }, [svgModel, rockParams.dartOpeningMm, rockParams.dartPosLeftRatio, rockParams.dartPosRightRatio])

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
      dartLengthMm: rockParams.dartLengthMm,
      dartOpeningMm: rockParams.dartOpeningMm,
      dartPosLeftRatio: rockParams.dartPosLeftRatio,
      dartPosRightRatio: rockParams.dartPosRightRatio,
      offsetX: rockParams.frontOffsetX,
      offsetY: rockParams.offsetY,
    })
    updateConfiguratorPartParams(instanceId, 'back', {
      widthMm: rockParams.widthMm,
      heightMm: rockParams.heightMm,
      waistToHipMm: rockParams.waistToHipMm,
      hipWidthMm: rockParams.hipWidthMm,
      hemWidthMm: rockParams.hemWidthMm,
      dartLengthMm: rockParams.dartLengthMm,
      dartOpeningMm: rockParams.dartOpeningMm,
      dartPosLeftRatio: rockParams.dartPosLeftRatio,
      dartPosRightRatio: rockParams.dartPosRightRatio,
      offsetX: rockParams.backOffsetX,
      offsetY: rockParams.offsetY,
    })
    regenerateConfiguratorPart(instanceId, 'front')
    regenerateConfiguratorPart(instanceId, 'back')

    setShowRockGeneratorModal(false)
    setShowConfiguratorModal(true)
  }

  const hexToSimpleColorName = (hex: string): string => {
    const h = hex.toLowerCase()
    if (h === '#000000' || h === '#111111' || h === '#1a1a1a') return 'schwarz'
    if (h === '#ffffff' || h === '#f5f5f5') return 'weiß'
    if (h.startsWith('#7')) return 'grau'
    if (h.startsWith('#8b') || h.startsWith('#6b')) return 'braun'
    if (h.startsWith('#2') || h.startsWith('#1f')) return 'dunkelblau'
    if (h.startsWith('#b') || h.startsWith('#c')) return 'violett'
    return hex
  }

  const generateAiPreview = async () => {
    const key = openAiApiKey.trim()
    if (!key) {
      setAiError('Bitte OpenAI API-Key eingeben.')
      return
    }
    setAiError(null)
    setIsGeneratingAi(true)
    try {
      const fixedSystemPrompt = [
        'Immer eine einzelne Frau, ca. 30 Jahre alt.',
        'Schwarze Haare, ordentlich zusammengebunden (Pferdeschwanz oder Dutt).',
        'Frontale Ganzkörperpose, neutraler Studio-Hintergrund.',
        'Kein Text, keine Logos, keine zusätzlichen Personen.',
      ].join(' ')
      const prompt = [
        fixedSystemPrompt,
        'Fotorealistisches Ganzkörperbild, frontale Pose.',
        personPrompt.trim() || 'Moderne, schlichte Darstellung.',
        `Der Rock MUSS exakt die Farbe ${rockColor} (${hexToSimpleColorName(rockColor)}) haben.`,
        `Der Gürtel MUSS exakt die Farbe ${beltColor} (${hexToSimpleColorName(beltColor)}) haben.`,
        'Verwende keine abweichenden Hauptfarben für Rock oder Gürtel.',
        `Körpergröße ca. ${Math.round(measures.groesseCm)} cm.`,
        `Taillenumfang ca. ${Math.round(measures.tailleCm)} cm.`,
        `Hüftumfang ca. ${Math.round(measures.hueftumfangCm)} cm.`,
        `Rocklänge ca. ${Math.round(measures.rocklaengeCm)} cm.`,
        `Kleidungsstil: ${stylePrompt.trim() || 'schlicht, elegant, fotorealistisch'}.`,
        'Volle Figur inkl. Schuhe sichtbar.',
      ].join(' ')

      const resp = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt,
          size: '1024x1024',
        }),
      })

      if (!resp.ok) {
        const txt = await resp.text()
        throw new Error(`OpenAI Fehler (${resp.status}): ${txt.slice(0, 280)}`)
      }
      const data = await resp.json() as {
        data?: Array<{ b64_json?: string; url?: string }>
      }
      const item = data.data?.[0]
      if (!item) throw new Error('Keine Bilddaten von OpenAI erhalten.')

      if (item.url) {
        if (aiPreviewUrl && aiPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(aiPreviewUrl)
        setAiPreviewUrl(item.url)
      } else if (item.b64_json) {
        const bytes = atob(item.b64_json)
        const arr = new Uint8Array(bytes.length)
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
        const blob = new Blob([arr], { type: 'image/png' })
        const blobUrl = URL.createObjectURL(blob)
        if (aiPreviewUrl && aiPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(aiPreviewUrl)
        setAiPreviewUrl(blobUrl)
      } else {
        throw new Error('Antwort enthält weder URL noch Base64-Bilddaten.')
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'KI-Bild konnte nicht erzeugt werden.')
    } finally {
      setIsGeneratingAi(false)
    }
  }

  const valid =
    Number.isFinite(measures.groesseCm) &&
    measures.groesseCm > 120 &&
    Number.isFinite(measures.hueftumfangCm) &&
    measures.hueftumfangCm > 40 &&
    Number.isFinite(measures.tailleCm) &&
    measures.tailleCm > 40 &&
    Number.isFinite(measures.rocklaengeCm) &&
    measures.rocklaengeCm > 10

  return (
    <div className="nahtzugabe-dialog-overlay" onClick={() => setShowRockGeneratorModal(false)} role="dialog" aria-modal="true" aria-label="Rock-Konfigurator">
      <div className="nahtzugabe-dialog" onClick={(e) => e.stopPropagation()} style={{ minWidth: 820 }}>
        <h3 className="nahtzugabe-dialog-title">Rock-Konfigurator (Generator)</h3>

        <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
          <div style={{ flex: '0 0 320px' }}>
            <p className="nahtzugabe-dialog-hint" style={{ marginTop: 0 }}>
              Bild-Vorschau (fotorealistisches Referenzbild) mit optionaler technischer SVG-Ansicht.
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
              {!showTechnicalPreview ? (
                <img
                  src={activePhotoPreviewUrl}
                  alt="Fotorealistische Rock-Referenz"
                  onError={() => setShowTechnicalPreview(true)}
                  style={{
                    display: 'block',
                    width: '280px',
                    height: '520px',
                    objectFit: 'cover',
                    borderRadius: 4,
                    border: '1px solid #e0e0e0',
                  }}
                />
              ) : (
                <svg width="280" height="520" viewBox="0 0 200 450" style={{ display: 'block' }}>
                {/* Konstruktion */}
                <line x1={svgModel.midLineX} x2={svgModel.midLineX} y1={10} y2={450} stroke="#bdbdbd" strokeWidth="1" />

                <line x1="20" x2="180" y1={svgModel.shoulderLineY} y2={svgModel.shoulderLineY} stroke="#cfcfcf" strokeWidth="1" />
                <line x1="20" x2="180" y1={svgModel.waistLineY} y2={svgModel.waistLineY} stroke="#cfcfcf" strokeWidth="1" />
                <line x1="20" x2="180" y1={svgModel.hipLineY} y2={svgModel.hipLineY} stroke="#cfcfcf" strokeWidth="1" />

                {/* Kopf */}
                <ellipse cx={svgModel.head.cx} cy={svgModel.head.cy} rx={svgModel.head.rx} ry={svgModel.head.ry} fill="none" stroke="#000" strokeWidth="2" />
                {/* Haare */}
                <path
                  d={`
                    M ${svgModel.head.cx - svgModel.head.rx * 1.05} ${svgModel.head.cy - svgModel.head.ry * 0.2}
                    Q ${svgModel.head.cx} ${svgModel.head.cy - svgModel.head.ry * 1.5}
                      ${svgModel.head.cx + svgModel.head.rx * 1.05} ${svgModel.head.cy - svgModel.head.ry * 0.2}
                    L ${svgModel.head.cx + svgModel.head.rx * 1.2} ${svgModel.head.cy + svgModel.head.ry * 0.75}
                    Q ${svgModel.head.cx} ${svgModel.head.cy + svgModel.head.ry * 1.25}
                      ${svgModel.head.cx - svgModel.head.rx * 1.2} ${svgModel.head.cy + svgModel.head.ry * 0.75}
                    Z
                  `}
                  fill="#4b3621"
                  opacity={0.9}
                />
                {/* Gesicht */}
                <circle cx={svgModel.head.cx - svgModel.head.rx * 0.28} cy={svgModel.head.cy - svgModel.head.ry * 0.08} r="1.4" fill="#222" />
                <circle cx={svgModel.head.cx + svgModel.head.rx * 0.28} cy={svgModel.head.cy - svgModel.head.ry * 0.08} r="1.4" fill="#222" />
                <path
                  d={`
                    M ${svgModel.head.cx} ${svgModel.head.cy - svgModel.head.ry * 0.02}
                    L ${svgModel.head.cx - 0.8} ${svgModel.head.cy + svgModel.head.ry * 0.16}
                    L ${svgModel.head.cx + 0.8} ${svgModel.head.cy + svgModel.head.ry * 0.16}
                  `}
                  fill="#c88f6a"
                  opacity={0.7}
                />
                <path
                  d={`
                    M ${svgModel.head.cx - svgModel.head.rx * 0.22} ${svgModel.head.cy + svgModel.head.ry * 0.32}
                    Q ${svgModel.head.cx} ${svgModel.head.cy + svgModel.head.ry * 0.5}
                      ${svgModel.head.cx + svgModel.head.rx * 0.22} ${svgModel.head.cy + svgModel.head.ry * 0.32}
                  `}
                  fill="none"
                  stroke="#8b1e3f"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />

                {/* Arme (Hinweislinien) */}
                <line x1={svgModel.armL0.x} x2={svgModel.armL1.x} y1={svgModel.armL0.y} y2={svgModel.armL1.y} stroke="#757575" strokeWidth="1.5" />
                <line x1={svgModel.armR0.x} x2={svgModel.armR1.x} y1={svgModel.armR0.y} y2={svgModel.armR1.y} stroke="#757575" strokeWidth="1.5" />

                {/* Oberteil */}
                <path
                  d={`
                    M ${svgModel.shoulderL.x + 4} ${svgModel.shoulderL.y + 4}
                    Q ${svgModel.midLineX} ${svgModel.shoulderLineY - 6}
                      ${svgModel.shoulderR.x - 4} ${svgModel.shoulderR.y + 4}
                    L ${svgModel.waistR.x + 10} ${svgModel.waistLineY + 2}
                    Q ${svgModel.midLineX} ${svgModel.waistLineY + 10}
                      ${svgModel.waistL.x - 10} ${svgModel.waistLineY + 2}
                    Z
                  `}
                  fill="#8ecae6"
                  opacity={0.75}
                  stroke="#4a90a4"
                  strokeWidth="0.8"
                />

                {/* Rock (einfaches Kleidungsstück) */}
                <path
                  d={`
                    M ${svgModel.waistL.x - 8} ${svgModel.waistLineY + 2}
                    L ${svgModel.waistR.x + 8} ${svgModel.waistLineY + 2}
                    Q ${svgModel.hipR.x + 10} ${svgModel.hipLineY - 2}
                      ${svgModel.rightOuterLeg[0].x + 6} ${svgModel.rightOuterLeg[0].y + 6}
                    L ${svgModel.leftOuterLeg[0].x - 6} ${svgModel.leftOuterLeg[0].y + 6}
                    Q ${svgModel.hipL.x - 10} ${svgModel.hipLineY - 2}
                      ${svgModel.waistL.x - 8} ${svgModel.waistLineY + 2}
                    Z
                  `}
                  fill="#d8bfd8"
                  opacity={0.72}
                  stroke="#8b6f8b"
                  strokeWidth="0.9"
                />
                {/* Gürtel */}
                <line
                  x1={svgModel.waistL.x - 8}
                  x2={svgModel.waistR.x + 8}
                  y1={svgModel.waistLineY + 2}
                  y2={svgModel.waistLineY + 2}
                  stroke="#444"
                  strokeWidth="2"
                />

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
              )}
            </div>
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#666' }}>
                {showTechnicalPreview ? 'Technische Ansicht aktiv' : 'Fotoansicht aktiv'}
              </span>
              <button
                type="button"
                className="sidebar-btn"
                style={{ padding: '4px 10px', fontSize: 12 }}
                onClick={() => setShowTechnicalPreview((v) => !v)}
              >
                {showTechnicalPreview ? 'Foto anzeigen' : 'Technik anzeigen'}
              </button>
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

            <div style={{ marginTop: 18, borderTop: '1px solid #ddd', paddingTop: 12 }}>
              <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>KI-Preview (OpenAI)</h4>
              <p style={{ margin: '0 0 10px', fontSize: 12, color: '#555' }}>
                API-Key wird nur temporär im Browser verwendet und nicht gespeichert.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label className="nahtzugabe-dialog-label">
                  <span>OpenAI API-Key</span>
                  <input
                    type="password"
                    className="nahtzugabe-dialog-input"
                    value={openAiApiKey}
                    onChange={(e) => setOpenAiApiKey(e.target.value)}
                    placeholder="sk-..."
                  />
                </label>
                <label className="nahtzugabe-dialog-label">
                  <span>Stil</span>
                  <input
                    type="text"
                    className="nahtzugabe-dialog-input"
                    value={stylePrompt}
                    onChange={(e) => setStylePrompt(e.target.value)}
                  />
                </label>
                <label className="nahtzugabe-dialog-label">
                  <span>Rockfarbe</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="color" value={rockColor} onChange={(e) => setRockColor(e.target.value)} />
                  <input
                    type="text"
                    className="nahtzugabe-dialog-input"
                    value={rockColor}
                    onChange={(e) => setRockColor(e.target.value)}
                    placeholder="#1a1a1a"
                  />
                </div>
                </label>
                <label className="nahtzugabe-dialog-label">
                  <span>Gürtelfarbe</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="color" value={beltColor} onChange={(e) => setBeltColor(e.target.value)} />
                  <input
                    type="text"
                    className="nahtzugabe-dialog-input"
                    value={beltColor}
                    onChange={(e) => setBeltColor(e.target.value)}
                    placeholder="#3a3a3a"
                  />
                </div>
                </label>
              </div>
              <label className="nahtzugabe-dialog-label" style={{ marginTop: 8 }}>
                <span>Zusatzwunsch (optional)</span>
                <textarea
                  className="nahtzugabe-dialog-input"
                  value={personPrompt}
                  onChange={(e) => setPersonPrompt(e.target.value)}
                  rows={3}
                  style={{ resize: 'vertical' }}
                  placeholder="z.B. modern, zurückhaltend, business ..."
                />
              </label>
              <div className="nahtzugabe-dialog-actions" style={{ marginTop: 10 }}>
                <button type="button" className="sidebar-btn primary" onClick={generateAiPreview} disabled={isGeneratingAi}>
                  {isGeneratingAi ? 'Generiere…' : 'KI-Bild generieren'}
                </button>
                <button
                  type="button"
                  className="sidebar-btn"
                  onClick={() => {
                    if (aiPreviewUrl && aiPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(aiPreviewUrl)
                    setAiPreviewUrl(null)
                  }}
                  disabled={!aiPreviewUrl}
                >
                  Auf Standardbild zurück
                </button>
              </div>
              {aiError && (
                <p style={{ margin: '8px 0 0', color: '#c62828', fontSize: 12 }}>
                  {aiError}
                </p>
              )}
              {aiPreviewUrl && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#2e7d32' }}>KI-Bild ist aktiv und links als Hauptvorschau sichtbar.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

