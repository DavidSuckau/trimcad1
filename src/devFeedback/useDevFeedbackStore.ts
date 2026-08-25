import { create } from 'zustand'

type DevFeedbackState = {
  open: boolean
  setOpen: (v: boolean) => void
}

export const useDevFeedbackStore = create<DevFeedbackState>((set) => ({
  open: false,
  setOpen: (v) => set({ open: v }),
}))
