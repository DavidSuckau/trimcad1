export type WorkspaceActionTarget = 'all_pieces' | 'selected_pieces'

export type WorkspacePieceActionType =
  | 'remove_seam_allowance'
  | 'clear_notches'
  | 'clear_drills'
  | 'delete_pieces'

export type WorkspacePieceAction = {
  type: WorkspacePieceActionType
  target: WorkspaceActionTarget
}

export type WorkspaceGlobalAction = {
  type: 'clear_all_seam_assignments'
}

export type CreateRectangleAction = {
  type: 'create_rectangle'
  widthMm: number
  heightMm: number
  /** Weltkoordinate Ecke unten-links (mm), wie Rechteck-Werkzeug */
  originWorldX: number
  originWorldY: number
  name?: string
}

export type CreateCircleAction = {
  type: 'create_circle'
  radiusMm: number
  centerWorldX: number
  centerWorldY: number
  segments: number
  name?: string
}

export type AddEmptyPieceAction = {
  type: 'add_empty_piece'
  name?: string
}

export type PiecePickTarget = 'selected_first' | 'by_index'

export type AddNotchAction = {
  type: 'add_notch'
  piecePick: PiecePickTarget
  /** Nur bei by_index: 0-basierter Index in workspace.pieces */
  pieceIndex?: number
  positionLocalX: number
  positionLocalY: number
  notchType: 'single' | 'double' | 'v'
  depthMm: number
  widthMm: number
  angleDeg?: number
}

export type AddDrillAction = {
  type: 'add_drill'
  piecePick: PiecePickTarget
  pieceIndex?: number
  centerLocalX: number
  centerLocalY: number
  radiusMm: number
}

export type WorkspaceCreateAction = CreateRectangleAction | CreateCircleAction | AddEmptyPieceAction

export type WorkspaceChatAction =
  | WorkspacePieceAction
  | WorkspaceGlobalAction
  | WorkspaceCreateAction
  | AddNotchAction
  | AddDrillAction

export type WorkspaceChatProposal = {
  rationale: string
  actions: WorkspaceChatAction[]
}

export type WorkspaceProposalValidation =
  | { ok: true; value: WorkspaceChatProposal }
  | { ok: false; error: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function parseFinite(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

const PIECE_TYPES: WorkspacePieceActionType[] = [
  'remove_seam_allowance',
  'clear_notches',
  'clear_drills',
  'delete_pieces',
]

function isPieceAction(a: unknown): a is WorkspacePieceAction {
  if (!isRecord(a)) return false
  const t = a.type
  const target = a.target
  return (
    PIECE_TYPES.includes(t as WorkspacePieceActionType) &&
    (target === 'all_pieces' || target === 'selected_pieces')
  )
}

function isGlobalAction(a: unknown): a is WorkspaceGlobalAction {
  return isRecord(a) && a.type === 'clear_all_seam_assignments'
}

function parseCreateRectangle(a: Record<string, unknown>): CreateRectangleAction | null {
  if (a.type !== 'create_rectangle') return null
  const w = parseFinite(a.widthMm)
  const h = parseFinite(a.heightMm)
  const ox = parseFinite(a.originWorldX)
  const oy = parseFinite(a.originWorldY)
  if (w == null || h == null || ox == null || oy == null) return null
  const name = typeof a.name === 'string' && a.name.trim() ? a.name.trim() : undefined
  return {
    type: 'create_rectangle',
    widthMm: clamp(w, 1, 10000),
    heightMm: clamp(h, 1, 10000),
    originWorldX: clamp(ox, -50000, 50000),
    originWorldY: clamp(oy, -50000, 50000),
    name,
  }
}

function parseCreateCircle(a: Record<string, unknown>): CreateCircleAction | null {
  if (a.type !== 'create_circle') return null
  const r = parseFinite(a.radiusMm)
  const cx = parseFinite(a.centerWorldX)
  const cy = parseFinite(a.centerWorldY)
  if (r == null || cx == null || cy == null) return null
  let segments = 32
  if (a.segments != null) {
    const s = parseFinite(a.segments)
    if (s == null) return null
    segments = Math.min(128, Math.max(8, Math.floor(s)))
  }
  const name = typeof a.name === 'string' && a.name.trim() ? a.name.trim() : undefined
  return {
    type: 'create_circle',
    radiusMm: clamp(r, 0.5, 5000),
    centerWorldX: clamp(cx, -50000, 50000),
    centerWorldY: clamp(cy, -50000, 50000),
    segments,
    name,
  }
}

function parseAddEmptyPiece(a: Record<string, unknown>): AddEmptyPieceAction | null {
  if (a.type !== 'add_empty_piece') return null
  const name = typeof a.name === 'string' && a.name.trim() ? a.name.trim() : undefined
  return { type: 'add_empty_piece', name }
}

function parsePiecePick(a: Record<string, unknown>): PiecePickTarget | null {
  const p = a.piecePick
  if (p === 'selected_first' || p === 'by_index') return p
  return null
}

function parseAddNotch(a: Record<string, unknown>): AddNotchAction | null {
  if (a.type !== 'add_notch') return null
  const piecePick = parsePiecePick(a)
  if (!piecePick) return null
  const px = parseFinite(a.positionLocalX)
  const py = parseFinite(a.positionLocalY)
  if (px == null || py == null) return null
  const nt = a.notchType
  if (nt !== 'single' && nt !== 'double' && nt !== 'v') return null
  let pieceIndex: number | undefined
  if (piecePick === 'by_index') {
    const pi = parseFinite(a.pieceIndex)
    if (pi == null) return null
    pieceIndex = Math.max(0, Math.floor(pi))
  }
  const dRaw = parseFinite(a.depthMm)
  const wRaw = parseFinite(a.widthMm)
  const depthMm = dRaw != null ? clamp(dRaw, 0.5, 80) : 4
  const widthMm = wRaw != null ? clamp(wRaw, 0.5, 80) : 6
  const angleRaw = parseFinite(a.angleDeg)
  const angleDeg = angleRaw != null && Number.isFinite(angleRaw) ? angleRaw : undefined
  return {
    type: 'add_notch',
    piecePick,
    pieceIndex,
    positionLocalX: clamp(px, -100000, 100000),
    positionLocalY: clamp(py, -100000, 100000),
    notchType: nt,
    depthMm,
    widthMm,
    angleDeg,
  }
}

function parseAddDrill(a: Record<string, unknown>): AddDrillAction | null {
  if (a.type !== 'add_drill') return null
  const piecePick = parsePiecePick(a)
  if (!piecePick) return null
  const cx = parseFinite(a.centerLocalX)
  const cy = parseFinite(a.centerLocalY)
  const r = parseFinite(a.radiusMm)
  if (cx == null || cy == null || r == null) return null
  let pieceIndex: number | undefined
  if (piecePick === 'by_index') {
    const pi = parseFinite(a.pieceIndex)
    if (pi == null) return null
    pieceIndex = Math.max(0, Math.floor(pi))
  }
  return {
    type: 'add_drill',
    piecePick,
    pieceIndex,
    centerLocalX: clamp(cx, -100000, 100000),
    centerLocalY: clamp(cy, -100000, 100000),
    radiusMm: clamp(r, 0.5, 500),
  }
}

function parseOneAction(a: unknown): WorkspaceChatAction | null {
  if (!isRecord(a)) return null
  return (
    parseCreateRectangle(a) ??
    parseCreateCircle(a) ??
    parseAddEmptyPiece(a) ??
    parseAddNotch(a) ??
    parseAddDrill(a) ??
    (isGlobalAction(a) ? a : null) ??
    (isPieceAction(a) ? a : null)
  )
}

export function validateWorkspaceProposal(input: unknown): WorkspaceProposalValidation {
  if (!isRecord(input)) return { ok: false, error: 'Antwort ist kein Objekt.' }
  const { rationale, actions } = input
  if (typeof rationale !== 'string' || rationale.trim().length === 0) {
    return { ok: false, error: 'Begruendung fehlt.' }
  }
  if (!Array.isArray(actions) || actions.length === 0) {
    return { ok: false, error: 'actions fehlt oder ist leer.' }
  }
  const cleaned: WorkspaceChatAction[] = []
  for (const a of actions) {
    const parsed = parseOneAction(a)
    if (!parsed) return { ok: false, error: 'Unbekannte oder ungueltige Aktion.' }
    cleaned.push(parsed)
  }
  return {
    ok: true,
    value: { rationale: rationale.trim(), actions: cleaned },
  }
}
