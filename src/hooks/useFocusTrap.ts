import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(active = true) {
  const ref = useRef<T>(null)

  useEffect(() => {
    if (!active) return
    const el = ref.current
    if (!el) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    const focusables = () => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
    const first = focusables()[0]
    first?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const list = focusables()
      if (list.length === 0) return
      const firstEl = list[0]
      const lastEl = list[list.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    el.addEventListener('keydown', onKeyDown)
    return () => {
      el.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus()
    }
  }, [active])

  return ref
}
