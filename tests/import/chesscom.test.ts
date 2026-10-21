import { describe, expect, it, vi } from 'vitest'
import { fetchRecentPgn, ImportError } from '../../src/import/chesscom'

const A1 = 'https://api.chess.com/pub/player/magnus/games/2024/01'
const A2 = 'https://api.chess.com/pub/player/magnus/games/2024/02'

function archive(prefix: string, n: number): { games: { pgn: string }[] } {
  return {
    games: Array.from({ length: n }, (_, i) => ({
      pgn: `[Event "${prefix}${i + 1}"]\n[Result "1-0"]\n\n1. e4 e5 1-0\n`,
    })),
  }
}

function res(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => body as string,
  } as unknown as Response
}

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p
  } catch (e) {
    return e instanceof ImportError ? e.code : 'other'
  }
  return undefined
}

describe('fetchRecentPgn', () => {
  it('fetches newest archives first until maxGames', async () => {
    const urls: string[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      urls.push(url)
      if (url.endsWith('/games/archives')) return res(200, { archives: [A1, A2] })
      if (url === A2) return res(200, archive('new', 3))
      if (url === A1) return res(200, archive('old', 3))
      return res(404, {})
    }) as unknown as typeof fetch
    const out = await fetchRecentPgn('Magnus', { maxGames: 4, fetchImpl })
    expect(urls[0]).toBe('https://api.chess.com/pub/player/magnus/games/archives')
    expect(urls[1]).toBe(A2)
    expect(urls[2]).toBe(A1)
    expect(out.match(/\[Event /g)).toHaveLength(4)
    expect(out).toContain('[Event "old3"]')
    expect(out).not.toContain('[Event "old1"]')
    expect(out).toMatch(/\n\n\[Event/)
  })

  it('does not fetch older archives once maxGames is reached', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/games/archives')) return res(200, { archives: [A1, A2] })
      return res(200, archive('new', 3))
    }) as unknown as typeof fetch
    await fetchRecentPgn('magnus', { maxGames: 3, fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('404 -> not-found', async () => {
    const fetchImpl = (async () => res(404, {})) as unknown as typeof fetch
    expect(await code(fetchRecentPgn('nobody', { fetchImpl }))).toBe('not-found')
  })

  it('empty archives -> no-games', async () => {
    const fetchImpl = (async () => res(200, { archives: [] })) as unknown as typeof fetch
    expect(await code(fetchRecentPgn('magnus', { fetchImpl }))).toBe('no-games')
  })

  it('429 -> rate-limited', async () => {
    const fetchImpl = (async () => res(429, {})) as unknown as typeof fetch
    expect(await code(fetchRecentPgn('magnus', { fetchImpl }))).toBe('rate-limited')
  })

  it('fetch rejects -> network', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    expect(await code(fetchRecentPgn('magnus', { fetchImpl }))).toBe('network')
  })

  it('archive-level 404 (current month) is skipped, older games returned', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/games/archives')) return res(200, { archives: [A1, A2] })
      if (url === A2) return res(404, {})
      return res(200, archive('old', 2))
    }) as unknown as typeof fetch
    const out = await fetchRecentPgn('magnus', { fetchImpl })
    expect(out.match(/\[Event /g)).toHaveLength(2)
    expect(out).toContain('[Event "old2"]')
  })

  it('skips game entries without a pgn field', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/games/archives')) return res(200, { archives: [A1] })
      return res(200, { games: [{ url: 'x' }, ...archive('g', 1).games] })
    }) as unknown as typeof fetch
    const out = await fetchRecentPgn('magnus', { fetchImpl })
    expect(out.match(/\[Event /g)).toHaveLength(1)
  })

  it('429 after some games -> partial result', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/games/archives')) return res(200, { archives: [A1, A2] })
      if (url === A2) return res(200, archive('new', 2))
      return res(429, {})
    }) as unknown as typeof fetch
    const out = await fetchRecentPgn('magnus', { fetchImpl })
    expect(out.match(/\[Event /g)).toHaveLength(2)
    expect(out).toContain('[Event "new2"]')
  })

  it('429 on the first archive with nothing collected -> rate-limited', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/games/archives')) return res(200, { archives: [A1, A2] })
      return res(429, {})
    }) as unknown as typeof fetch
    expect(await code(fetchRecentPgn('magnus', { fetchImpl }))).toBe('rate-limited')
  })

  it('all archives failing -> network', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/games/archives')) return res(200, { archives: [A1, A2] })
      if (url === A2) return res(404, {})
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    expect(await code(fetchRecentPgn('magnus', { fetchImpl }))).toBe('network')
  })

  it('archives that load but hold no games -> no-games', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/games/archives')) return res(200, { archives: [A1] })
      return res(200, { games: [] })
    }) as unknown as typeof fetch
    expect(await code(fetchRecentPgn('magnus', { fetchImpl }))).toBe('no-games')
  })
})
