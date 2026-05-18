import { useEffect } from 'react'
import { useStore } from '../store/useStore'
import { applyUiTextScaleToDocument } from '../ui/uiTextScale'

/** Synchronisiert uiTextScale aus dem Store mit der CSS-Variable auf :root. */
export function UiTextScaleSync() {
  const uiTextScale = useStore((s) => s.uiTextScale)
  useEffect(() => {
    applyUiTextScaleToDocument(uiTextScale)
  }, [uiTextScale])
  return null
}
