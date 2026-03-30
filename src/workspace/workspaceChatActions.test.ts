import { describe, expect, it } from 'vitest'
import { validateWorkspaceProposal } from './workspaceChatActions'

describe('validateWorkspaceProposal', () => {
  it('akzeptiert gemischte Aktionen', () => {
    const r = validateWorkspaceProposal({
      rationale: 'Nutzer wuenscht Bereinigung',
      actions: [
        { type: 'remove_seam_allowance', target: 'all_pieces' },
        { type: 'clear_notches', target: 'selected_pieces' },
        { type: 'clear_all_seam_assignments' },
      ],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.actions.length).toBe(3)
  })

  it('akzeptiert delete_pieces', () => {
    const r = validateWorkspaceProposal({
      rationale: 'Auswahl entfernen',
      actions: [{ type: 'delete_pieces', target: 'selected_pieces' }],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.actions[0].type).toBe('delete_pieces')
  })

  it('lehnt unbekannte Typen ab', () => {
    const r = validateWorkspaceProposal({
      rationale: 'x',
      actions: [{ type: 'delete_everything', target: 'all_pieces' }],
    })
    expect(r.ok).toBe(false)
  })

  it('akzeptiert add_notch und add_drill', () => {
    const r = validateWorkspaceProposal({
      rationale: 'Kerbe und Bohrung',
      actions: [
        {
          type: 'add_notch',
          piecePick: 'selected_first',
          positionLocalX: 10,
          positionLocalY: 20,
          notchType: 'single',
          depthMm: 4,
          widthMm: 6,
        },
        {
          type: 'add_drill',
          piecePick: 'by_index',
          pieceIndex: 0,
          centerLocalX: 50,
          centerLocalY: 50,
          radiusMm: 2,
        },
      ],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.actions[0].type).toBe('add_notch')
    expect(r.value.actions[1].type).toBe('add_drill')
  })

  it('akzeptiert create_rectangle und create_circle', () => {
    const r = validateWorkspaceProposal({
      rationale: 'Neue Grundformen',
      actions: [
        { type: 'create_rectangle', widthMm: 100, heightMm: 50, originWorldX: 0, originWorldY: 0 },
        { type: 'create_circle', radiusMm: 25, centerWorldX: 200, centerWorldY: 100, segments: 16 },
      ],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.actions[0].type).toBe('create_rectangle')
    expect(r.value.actions[1].type).toBe('create_circle')
    if (r.value.actions[1].type === 'create_circle') {
      expect(r.value.actions[1].segments).toBe(16)
    }
  })
})
