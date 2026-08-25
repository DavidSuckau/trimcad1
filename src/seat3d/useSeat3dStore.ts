import { create } from 'zustand'
import type { SeatPiecePlacement, SeatRegion } from './types'

type Seat3dState = {
  open: boolean
  placements: SeatPiecePlacement[]
  setOpen: (v: boolean) => void
  togglePiece: (pieceId: string, region?: SeatRegion) => void
  setRegion: (pieceId: string, region: SeatRegion) => void
  setOffset: (pieceId: string, offsetU: number, offsetV: number) => void
  clear: () => void
}

export const useSeat3dStore = create<Seat3dState>((set, get) => ({
  open: false,
  placements: [],
  setOpen: (v) => set({ open: v }),
  togglePiece: (pieceId, region = 'cushion') => {
    const cur = get().placements
    const exists = cur.find((p) => p.pieceId === pieceId)
    if (exists) {
      set({ placements: cur.filter((p) => p.pieceId !== pieceId) })
      return
    }
    set({
      placements: [...cur, { pieceId, region, offsetU: 0, offsetV: 0 }],
    })
  },
  setRegion: (pieceId, region) => {
    set({
      placements: get().placements.map((p) => (p.pieceId === pieceId ? { ...p, region } : p)),
    })
  },
  setOffset: (pieceId, offsetU, offsetV) => {
    set({
      placements: get().placements.map((p) =>
        p.pieceId === pieceId ? { ...p, offsetU, offsetV } : p,
      ),
    })
  },
  clear: () => set({ placements: [] }),
}))
