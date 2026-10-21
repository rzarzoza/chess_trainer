import type { Engine, EngineLine } from '../types'

export function createFakeEngine(table: Record<string, EngineLine[]>): Engine {
  return {
    async analyse(fen) {
      const lines = table[fen]
      if (!lines) throw new Error(`Unscripted FEN: ${fen}`)
      return lines
    },
    dispose() {},
  }
}
