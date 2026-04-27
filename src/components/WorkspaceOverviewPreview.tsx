import type { PatternPiece, ProfileAssignment } from '../types/model'
import DOMPurify from 'dompurify'
import type { OverviewImageSession } from '../workspace/workspaceOverviewBounds'
import { buildWorkspaceOverviewSvgDocument } from '../workspace/buildWorkspaceOverviewSvg'

type Props = {
  pieces: PatternPiece[]
  imageSession: OverviewImageSession | null
  imageDataUrl: string | null
  profileAssignments?: ProfileAssignment[]
}

export function WorkspaceOverviewPreview({ pieces, imageSession, imageDataUrl, profileAssignments }: Props) {
  const unsafeSvgDoc = buildWorkspaceOverviewSvgDocument(pieces, imageSession, imageDataUrl, profileAssignments)
  const svgDoc = unsafeSvgDoc
    ? DOMPurify.sanitize(unsafeSvgDoc, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ['script', 'foreignObject'],
        FORBID_ATTR: [
          'onload',
          'onerror',
          'onclick',
          'onmouseover',
          'onmouseenter',
          'onmouseleave',
          'onfocus',
          'onblur',
          'onanimationstart',
        ],
      })
    : null

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
