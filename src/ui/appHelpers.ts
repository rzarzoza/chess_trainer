import { withUserColor } from '../pgn/parseGames';
import type { Engine, ExampleRef, GameAnalysis, GameRecord } from '../types';
import type { BoardInfo } from './WeaknessCard';

/** The most frequent player names across games, case-insensitive (first spelling seen is shown). */
export function frequentNames(games: GameRecord[], limit = 6): string[] {
  const counts = new Map<string, { name: string; n: number }>();
  for (const g of games) {
    for (const raw of [g.white, g.black]) {
      const name = raw.trim();
      if (!name) continue;
      const k = name.toLowerCase();
      const c = counts.get(k);
      if (c) c.n += 1;
      else counts.set(k, { name, n: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, limit).map((c) => c.name);
}

/** Set userColor on every game where `name` plays (case-insensitive); other games are returned unchanged. */
export function applyUserName(games: GameRecord[], name: string): GameRecord[] {
  const k = name.trim().toLowerCase();
  return games.map((g) => {
    if (g.userColor) return g;
    if (g.white.trim().toLowerCase() === k) return withUserColor(g, 'w');
    if (g.black.trim().toLowerCase() === k) return withUserColor(g, 'b');
    return g;
  });
}

/** Look up the position and key squares of an example from the loaded games and analyses. */
export function makeBoardLookup(games: GameRecord[], analyses: Map<string, GameAnalysis>) {
  const byId = new Map(games.map((g) => [g.id, g]));
  return (ref: ExampleRef): BoardInfo | null => {
    const game = byId.get(ref.gameId);
    const moment = analyses.get(ref.gameId)?.moments.find((m) => m.ply === ref.ply);
    if (!game || !moment) return null;
    return {
      fen: moment.fenBefore,
      orientation: game.userColor === 'b' ? 'black' : 'white',
      highlight: moment.punishment?.motif?.keySquares ?? [],
      good: moment.better?.motif?.keySquares ?? [],
    };
  };
}

const abortError = () => new DOMException('Analysis stopped', 'AbortError');

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * Wrap an engine for one analysis run. Once `signal` aborts, every pending and future call rejects at once with an
 * AbortError, so the stopped game fails fast (runQueue then neither returns nor caches it). A real engine rejection
 * calls `onFailure`, even if the run was already aborted.
 */
export function abortableEngine(engine: Engine, signal: AbortSignal, onFailure: (err: unknown) => void): Engine {
  return {
    analyse(fen, opts) {
      if (signal.aborted) return Promise.reject(abortError());
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
        engine.analyse(fen, opts).then(
          (lines) => { signal.removeEventListener('abort', onAbort); resolve(lines); },
          (err: unknown) => { signal.removeEventListener('abort', onAbort); onFailure(err); reject(err); },
        );
      });
    },
    dispose: () => engine.dispose(),
  };
}

const TIME_CLASS_LABEL: Partial<Record<GameRecord['timeClass'], string>> = { rapid: 'Rapid', blitz: 'Blitz', bullet: 'Bullet', daily: 'Daily' };
const RESULT_WORD: Record<NonNullable<GameRecord['userResult']>, string> = { win: 'won', loss: 'lost', draw: 'drew' };

/** "Rapid" / "Blitz" / "Bullet"; null when the time control is unknown. */
export const timeClassLabel = (g: GameRecord): string | null => TIME_CLASS_LABEL[g.timeClass] ?? null;
/** "won" / "lost" / "drew" from the user's side; null when unknown. */
export const resultWord = (g: GameRecord): string | null => (g.userResult ? RESULT_WORD[g.userResult] : null);
/** The other player's name. */
export const opponentOf = (g: GameRecord): string => ((g.userColor === 'b' ? g.white : g.black).trim() || 'Unknown');
/** Full-move number of a 1-based ply. */
export const moveNumber = (ply: number): number => Math.max(1, Math.ceil(ply / 2));
/** "17. Nd5" for White's ply, "17… Ke8" for Black's (1-based plies from the starting position). */
export const plyLabel = (ply: number, san: string): string => `${moveNumber(ply)}${ply % 2 === 1 ? '.' : '…'} ${san}`;
