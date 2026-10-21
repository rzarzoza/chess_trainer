import type { Engine, EngineLine } from '../types'
import { parseInfo, parseTerminalInfo } from './uci'

export interface WorkerLike {
  onmessage: ((e: { data: string }) => void) | null
  onerror: ((e: unknown) => void) | null
  postMessage(msg: string): void
  terminate(): void
}

type Job = {
  fen: string; depth: number; multiPv: number
  resolve: (l: EngineLine[]) => void; reject: (e: Error) => void
}

export interface EngineTimeouts {
  /** No bestmove this long after "go": send "stop". */
  searchMs: number
  /** Still no bestmove this long after "stop": the engine is stuck, so fail. */
  stopMs: number
}
export const DEFAULT_TIMEOUTS: EngineTimeouts = { searchMs: 60_000, stopMs: 5_000 }

export async function createStockfishEngine(
  url = '/engine/stockfish.js',
  workerFactory: (url: string) => WorkerLike = (u) => new Worker(u) as unknown as WorkerLike,
  timeouts: EngineTimeouts = DEFAULT_TIMEOUTS,
): Promise<Engine> {
  const worker = workerFactory(url)
  let listener: ((line: string) => void) | null = null
  let initReject: ((e: Error) => void) | null = null
  let failure: Error | null = null
  const queue: Job[] = []
  let current: Job | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const clearTimer = () => { if (timer !== null) { clearTimeout(timer); timer = null } }

  function fail(err: Error) {
    if (failure) return
    failure = err
    clearTimer()
    listener = null
    initReject?.(err)
    initReject = null
    current?.reject(err)
    current = null
    for (const j of queue.splice(0)) j.reject(err)
  }

  worker.onmessage = (e) => {
    for (const line of String(e.data).split(/\r?\n/)) {
      if (line) listener?.(line)
    }
  }
  worker.onerror = (e) => {
    const msg = (e as { message?: string } | undefined)?.message
    fail(new Error(`Engine worker error${msg ? `: ${msg}` : ''}`))
  }

  const waitFor = (token: string) =>
    new Promise<void>((resolve, reject) => {
      initReject = reject
      listener = (line) => {
        if (line.trim() === token) { listener = null; initReject = null; resolve() }
      }
    })

  try {
    const uciok = waitFor('uciok')
    worker.postMessage('uci')
    await uciok
    const ready = waitFor('readyok')
    worker.postMessage('isready')
    await ready
  } catch (err) {
    worker.terminate()
    throw err
  }

  let disposed = false

  function pump() {
    if (current || disposed) return
    const job = queue.shift()
    if (!job) return
    current = job
    const best = new Map<number, EngineLine>()
    let terminal: EngineLine | null = null
    listener = (line) => {
      if (line.startsWith('bestmove')) {
        clearTimer()
        listener = null
        current = null
        const out = best.size ? [...best.values()].sort((a, b) => a.multipv - b.multipv)
          : [terminal ?? { multipv: 1, score: { cp: 0 }, pv: [], depth: 0 }]
        job.resolve(out)
        pump()
        return
      }
      const info = parseInfo(line)
      if (info) {
        const prev = best.get(info.multipv)
        if (!prev || info.depth >= prev.depth) best.set(info.multipv, info)
      } else {
        terminal = parseTerminalInfo(line) ?? terminal
      }
    }
    worker.postMessage(`setoption name MultiPV value ${job.multiPv}`)
    worker.postMessage(`position fen ${job.fen}`)
    worker.postMessage(`go depth ${job.depth}`)
    // A search that never ends would hang the whole queue: ask it to stop, then give up on the engine.
    timer = setTimeout(() => {
      worker.postMessage('stop')
      timer = setTimeout(() => {
        timer = null
        worker.terminate()
        fail(new Error('Engine stopped responding'))
      }, timeouts.stopMs)
    }, timeouts.searchMs)
  }

  return {
    analyse(fen, opts) {
      if (failure) return Promise.reject(failure)
      if (disposed) return Promise.reject(new Error('Engine disposed'))
      return new Promise((resolve, reject) => {
        queue.push({ fen, depth: opts.depth, multiPv: opts.multiPv ?? 1, resolve, reject })
        pump()
      })
    },
    dispose() {
      if (disposed) return
      disposed = true
      clearTimer()
      worker.terminate()
      fail(new Error('Engine disposed'))
    },
  }
}
