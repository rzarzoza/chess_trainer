import { describe, expect, it } from 'vitest'
import { parseInfo } from '../../src/engine/uci'

describe('parseInfo', () => {
  it('parses a cp line with multipv 2', () => {
    expect(parseInfo('info depth 12 seldepth 18 multipv 2 score cp -35 nodes 1000 nps 5 pv e2e4 e7e5 g1f3')).toEqual({
      multipv: 2, score: { cp: -35 }, pv: ['e2e4', 'e7e5', 'g1f3'], depth: 12,
    })
  })
  it('defaults multipv to 1 and parses mate', () => {
    expect(parseInfo('info depth 8 score mate -3 nodes 5 pv h7h8')).toEqual({
      multipv: 1, score: { mate: -3 }, pv: ['h7h8'], depth: 8,
    })
  })
  it('returns null without pv', () => {
    expect(parseInfo('info depth 8 score cp 10 nodes 5')).toBeNull()
    expect(parseInfo('info string hello')).toBeNull()
  })
  it('skips bound lines', () => {
    expect(parseInfo('info depth 8 score cp 20 lowerbound nodes 5 pv e2e4')).toBeNull()
    expect(parseInfo('info depth 8 score cp 20 upperbound nodes 5 pv e2e4')).toBeNull()
  })
})
