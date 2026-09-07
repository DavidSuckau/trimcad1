import type { Notch } from '../types/model'

export function isEaseNotch(n: Pick<Notch, 'purpose'> | null | undefined): boolean {
  return n?.purpose === 'ease'
}

export function isPassNotch(n: Pick<Notch, 'purpose'> | null | undefined): boolean {
  return !isEaseNotch(n)
}
