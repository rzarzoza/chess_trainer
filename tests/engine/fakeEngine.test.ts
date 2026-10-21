import { describe, expect, it } from 'vitest'
import { createFakeEngine } from '../../src/engine/fakeEngine'
import type { EngineLine } from '../../src/types'

const lines: EngineLine[] = [{ multipv: 1, score: { cp: 10 }, pv: ['e2e4'], depth: 10 }]

describe('fake engine', () => {
  it('returns scripted lines', async () => {
    const e = createFakeEngine({ fenA: lines })
    expect(await e.analyse('fenA', { depth: 10 })).toEqual(lines)
  })
  it('throws on unknown FEN', async () => {
    const e = createFakeEngine({})
    await expect(e.analyse('zzz', { depth: 10 })).rejects.toThrow('Unscripted FEN: zzz')
  })
})
