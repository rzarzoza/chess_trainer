import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStockfishEngine, type WorkerLike } from '../../src/engine/stockfishEngine'

function fakeWorker(onSearch: (w: FW, cmds: string[]) => void) {
  const w = new FW(onSearch)
  return w
}
class FW implements WorkerLike {
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  multi = false
  sent: string[] = []
  terminated = false
  private onSearch: (w: FW, cmds: string[]) => void
  constructor(onSearch: (w: FW, cmds: string[]) => void) { this.onSearch = onSearch }
  emit(line: string) { queueMicrotask(() => this.onmessage?.({ data: line })) }
  postMessage(cmd: string) {
    this.sent.push(cmd)
    if (cmd === 'uci') this.emit(this.multi ? 'id name SF\nuciok' : 'uciok')
    else if (cmd === 'isready') this.emit('readyok')
    else if (cmd.startsWith('go')) this.onSearch(this, this.sent)
  }
  terminate() { this.terminated = true }
}

describe('stockfishEngine', () => {
  it('keeps the deepest line per multipv, sorted', async () => {
    const w = fakeWorker((w) => {
      w.emit('info depth 5 multipv 1 score cp 10 pv e2e4')
      w.emit('info depth 6 multipv 2 score cp -5 pv d2d4')
      w.emit('info depth 6 multipv 1 score cp 20 pv e2e4 e7e5')
      w.emit('info depth 6 multipv 1 score cp 99 lowerbound pv a2a3')
      w.emit('info depth 5 multipv 2 score cp 0 pv c2c4')
      w.emit('bestmove e2e4')
    })
    const e = await createStockfishEngine('x', () => w)
    const r = await e.analyse('fen1', { depth: 6, multiPv: 2 })
    expect(r.map((l) => [l.multipv, l.depth])).toEqual([[1, 6], [2, 6]])
    expect(r[0].score).toEqual({ cp: 20 })
    expect(w.sent).toContain('setoption name MultiPV value 2')
    expect(w.sent).toContain('position fen fen1')
    expect(w.sent).toContain('go depth 6')
  })
  it('handles terminal positions', async () => {
    const w = fakeWorker((w) => { w.emit('info depth 0 score mate 0'); w.emit('bestmove (none)') })
    const e = await createStockfishEngine('x', () => w)
    expect(await e.analyse('f', { depth: 5 })).toEqual([{ multipv: 1, score: { mate: 0 }, pv: [], depth: 0 }])
  })
  it('queues calls and rejects pending on dispose', async () => {
    let n = 0
    const w = fakeWorker((w) => { if (n++ === 0) { w.emit('info depth 1 score cp 1 pv e2e4'); w.emit('bestmove e2e4') } })
    const e = await createStockfishEngine('x', () => w)
    const a = e.analyse('a', { depth: 1 })
    const b = e.analyse('b', { depth: 1 })
    expect((await a)[0].pv).toEqual(['e2e4'])
    await new Promise((r) => setTimeout(r, 5))
    e.dispose()
    await expect(b).rejects.toThrow()
    expect(w.terminated).toBe(true)
    await expect(e.analyse('c', { depth: 1 })).rejects.toThrow()
  })

  it('handles multi-line messages', async () => {
    const w = fakeWorker((w) => w.emit('info depth 1 score cp 1 pv e2e4\nbestmove e2e4'))
    w.multi = true
    const e = await createStockfishEngine('x', () => w)
    expect((await e.analyse('f', { depth: 1 }))[0].pv).toEqual(['e2e4'])
  })
  it('rejects init on worker error', async () => {
    const w = fakeWorker(() => {})
    w.postMessage = () => { queueMicrotask(() => w.onerror?.({ message: 'boom' })) }
    await expect(createStockfishEngine('x', () => w)).rejects.toThrow('boom')
    expect(w.terminated).toBe(true)
  })
  it('rejects current and queued jobs on worker error', async () => {
    const w = fakeWorker(() => {})
    const e = await createStockfishEngine('x', () => w)
    const a = e.analyse('a', { depth: 1 })
    const b = e.analyse('b', { depth: 1 })
    w.onerror?.({ message: 'crash' })
    await expect(a).rejects.toThrow('crash')
    await expect(b).rejects.toThrow('crash')
    await expect(e.analyse('c', { depth: 1 })).rejects.toThrow('crash')
  })

  describe('search timeout', () => {
    afterEach(() => { vi.useRealTimers() })
    const fake = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    it('sends "stop" after 60 s without bestmove and returns what the search found', async () => {
      const w = fakeWorker((w) => w.emit('info depth 9 score cp 30 pv e2e4'))
      const e = await createStockfishEngine('x', () => w)
      fake()
      const p = e.analyse('f', { depth: 30 })
      await vi.advanceTimersByTimeAsync(59_999)
      expect(w.sent).not.toContain('stop')
      const post = w.postMessage.bind(w)
      w.postMessage = (cmd) => { post(cmd); if (cmd === 'stop') w.emit('bestmove e2e4') }
      await vi.advanceTimersByTimeAsync(1)
      expect(w.sent).toContain('stop')
      expect((await p)[0]).toMatchObject({ pv: ['e2e4'], depth: 9 })
      expect(w.terminated).toBe(false)
    })

    it('fails the call (and the engine) when "stop" gets no bestmove within 5 s', async () => {
      const w = fakeWorker(() => {})
      const e = await createStockfishEngine('x', () => w)
      fake()
      const p = e.analyse('f', { depth: 30 })
      const queued = e.analyse('g', { depth: 30 })
      const failed = expect(p).rejects.toThrow('Engine stopped responding')
      const failedQueued = expect(queued).rejects.toThrow('Engine stopped responding')
      await vi.advanceTimersByTimeAsync(60_000)
      expect(w.sent.filter((c) => c === 'stop')).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(5_000)
      await failed
      await failedQueued
      expect(w.terminated).toBe(true)
      await expect(e.analyse('h', { depth: 1 })).rejects.toThrow('Engine stopped responding')
    })

    it('a search that finishes in time never gets "stop"', async () => {
      const w = fakeWorker((w) => { w.emit('info depth 1 score cp 1 pv e2e4'); w.emit('bestmove e2e4') })
      const e = await createStockfishEngine('x', () => w)
      fake()
      await e.analyse('f', { depth: 1 })
      await vi.advanceTimersByTimeAsync(120_000)
      expect(w.sent).not.toContain('stop')
    })
  })
})
