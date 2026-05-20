/// <reference lib="webworker" />
import type { NestingJobRequest, NestingWorkerOutMessage } from './nestingTypes'
import { runNesting } from './nestingEngine'

self.onmessage = (ev: MessageEvent<NestingJobRequest>) => {
  try {
    const result = runNesting(ev.data, (pct, phase) => {
      const msg: NestingWorkerOutMessage = { type: 'progress', pct, phase }
      self.postMessage(msg)
    })
    const done: NestingWorkerOutMessage = { type: 'result', result }
    self.postMessage(done)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Nesting-Berechnung fehlgeschlagen.'
    const done: NestingWorkerOutMessage = {
      type: 'result',
      result: { ok: false, error: message },
    }
    self.postMessage(done)
  }
}
