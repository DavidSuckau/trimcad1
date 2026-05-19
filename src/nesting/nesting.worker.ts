/// <reference lib="webworker" />
import type { NestingJobRequest, NestingJobResponse } from './nestingTypes'
import { runNesting } from './nestingEngine'

self.onmessage = (ev: MessageEvent<NestingJobRequest>) => {
  const result: NestingJobResponse = runNesting(ev.data)
  self.postMessage(result)
}
