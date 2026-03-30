import type { PatternPiece } from '../types/model'
import type { OverviewImageSession } from '../workspace/workspaceOverviewBounds'
import { buildWorkspaceOverviewSvgDocument } from '../workspace/buildWorkspaceOverviewSvg'

type Props = {
  pieces: PatternPiece[]
  imageSession: OverviewImageSession | null
  imageDataUrl: string | null
}

export function WorkspaceOverviewPreview({ pieces, imageSession, imageDataUrl }: Props) {
  const svgDoc = buildWorkspaceOverviewSvgDocument(pieces, imageSession, imageDataUrl)

  if (!svgDoc) {
    return (
      <div className="stueckliste-overview-placeholder">Keine Inhalte für die Vorschau.</div>
    )
  }

  return (
    <div className="stueckliste-overview-wrap">
      <div
        className="stueckliste-overview-svg-host"
        dangerouslySetInnerHTML={{ __html: svgDoc }}
      />
    </div>
  )
}
