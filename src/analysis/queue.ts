import type { Color, Engine, GameAnalysis, GameRecord } from '../types';
import { analyzeGame } from './analyzeGame';
import { getCached, putCached } from '../storage/cache';

export interface QueueProgress { done: number; total: number; current: string | null; finished: GameAnalysis | null }

export async function runQueue(
  games: GameRecord[],
  engine: Engine,
  onProgress: (p: QueueProgress) => void,
  signal?: AbortSignal,
  analyze: (g: GameRecord, e: Engine) => Promise<GameAnalysis> = analyzeGame,
): Promise<GameAnalysis[]> {
  const eligible = games.filter((g): g is GameRecord & { userColor: Color } => g.userColor !== null);
  const total = eligible.length;
  const results: GameAnalysis[] = [];
  let done = 0;
  const uncached: typeof eligible = [];

  for (const g of eligible) {
    if (signal?.aborted) return results;
    const hit = await getCached(g.id, g.userColor);
    if (hit) {
      results.push(hit);
      done++;
      onProgress({ done, total, current: null, finished: hit });
    } else {
      uncached.push(g);
    }
  }

  for (const g of uncached) {
    if (signal?.aborted) return results;
    onProgress({ done, total, current: g.id, finished: null });
    let a: GameAnalysis | null = null;
    try {
      a = await analyze(g, engine);
      await putCached(a, g.userColor);
      results.push(a);
    } catch {
      a = null;
    }
    done++;
    onProgress({ done, total, current: null, finished: a });
  }
  return results;
}
