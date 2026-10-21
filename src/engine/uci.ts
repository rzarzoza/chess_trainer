import type { EngineLine, Score } from '../types'

function parseScore(t: string[]): { score: Score; bound: boolean } | null {
  const i = t.indexOf('score')
  if (i < 0) return null
  const kind = t[i + 1]
  const val = Number(t[i + 2])
  if (!Number.isFinite(val)) return null
  const bound = t[i + 3] === 'lowerbound' || t[i + 3] === 'upperbound'
  if (kind === 'cp') return { score: { cp: val }, bound }
  if (kind === 'mate') return { score: { mate: val }, bound }
  return null
}

function num(t: string[], key: string): number | null {
  const i = t.indexOf(key)
  if (i < 0) return null
  const v = Number(t[i + 1])
  return Number.isFinite(v) ? v : null
}

/** Parse a UCI `info` line into an EngineLine. Null for non-info, pv-less, or bound lines. */
export function parseInfo(line: string): EngineLine | null {
  const t = line.trim().split(/\s+/)
  if (t[0] !== 'info') return null
  const pvAt = t.indexOf('pv')
  if (pvAt < 0 || pvAt === t.length - 1) return null
  const s = parseScore(t.slice(0, pvAt))
  const depth = num(t.slice(0, pvAt), 'depth')
  if (!s || s.bound || depth === null) return null
  return { multipv: num(t.slice(0, pvAt), 'multipv') ?? 1, score: s.score, pv: t.slice(pvAt + 1), depth }
}

/** Stockfish's reply for checkmate/stalemate: `info depth 0 score mate 0` / `cp 0` (no pv). */
export function parseTerminalInfo(line: string): EngineLine | null {
  const t = line.trim().split(/\s+/)
  if (t[0] !== 'info' || t.includes('pv') || num(t, 'depth') !== 0) return null
  const s = parseScore(t)
  return s && !s.bound ? { multipv: 1, score: s.score, pv: [], depth: 0 } : null
}
