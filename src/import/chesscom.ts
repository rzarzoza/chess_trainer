export type ImportErrorCode = 'not-found' | 'no-games' | 'rate-limited' | 'network'

export class ImportError extends Error {
  readonly code: ImportErrorCode
  constructor(code: ImportErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'ImportError'
    this.code = code
  }
}

const API = 'https://api.chess.com/pub/player'

async function get(fetchImpl: typeof fetch, url: string): Promise<Response> {
  let res: Response
  try {
    res = await fetchImpl(url)
  } catch {
    throw new ImportError('network', 'Could not reach Chess.com')
  }
  if (res.status === 429) throw new ImportError('rate-limited', 'Chess.com is rate limiting requests')
  return res
}

/**
 * Fetch up to `maxGames` of the user's most recent games as PGN text,
 * newest first, games separated by a blank line.
 */
export async function fetchRecentPgn(
  username: string,
  opts: { maxGames?: number; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const maxGames = opts.maxGames ?? 100
  const fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args))
  const user = encodeURIComponent(username.trim().toLowerCase())

  const archivesRes = await get(fetchImpl, `${API}/${user}/games/archives`)
  // Only a 404 on the archives list means the player doesn't exist.
  if (archivesRes.status === 404) throw new ImportError('not-found', 'Player not found')
  if (!archivesRes.ok) throw new ImportError('network', `Chess.com returned ${archivesRes.status}`)
  let archives: string[]
  try {
    archives = ((await archivesRes.json()) as { archives?: string[] }).archives ?? []
  } catch {
    throw new ImportError('network', 'Unexpected response from Chess.com')
  }
  if (archives.length === 0) throw new ImportError('no-games', 'No games found')

  const games: string[] = []
  let failed = false
  for (let i = archives.length - 1; i >= 0 && games.length < maxGames; i--) {
    try {
      const res = await get(fetchImpl, archives[i])
      if (!res.ok) {
        failed = true // e.g. the current month's archive can 404; keep walking
        continue
      }
      const body = (await res.json()) as { games?: { pgn?: unknown }[] }
      const pgns = (body.games ?? [])
        .map((g) => g.pgn)
        .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
        .map((p) => p.trim())
        .reverse() // oldest-first -> newest-first
      games.push(...pgns.slice(0, maxGames - games.length))
    } catch (e) {
      if (e instanceof ImportError && e.code === 'rate-limited') {
        if (games.length > 0) break
        throw e
      }
      failed = true // network error or bad JSON: skip this archive
    }
  }
  if (games.length === 0) {
    throw failed
      ? new ImportError('network', 'Could not load games from Chess.com')
      : new ImportError('no-games', 'No games found')
  }
  return games.join('\n\n') + '\n'
}
