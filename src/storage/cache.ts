import { createStore, get, set, clear } from 'idb-keyval';
import { ANALYSIS_VERSION, type Color, type GameAnalysis } from '../types';

let store: ReturnType<typeof createStore> | null = null;
function getStore() {
  return (store ??= createStore('chess-trainer', 'analyses'));
}

/** Keyed by game and the side analysed as the user: the same game seen from the other side is a different analysis. */
const key = (gameId: string, userColor: Color) => `analysis:${gameId}:${userColor}`;

export async function getCached(gameId: string, userColor: Color): Promise<GameAnalysis | null> {
  try {
    const a = await get<GameAnalysis>(key(gameId, userColor), getStore());
    return a && a.analysisVersion === ANALYSIS_VERSION ? a : null;
  } catch {
    return null;
  }
}

export async function putCached(a: GameAnalysis, userColor: Color): Promise<void> {
  try {
    await set(key(a.gameId, userColor), a, getStore());
  } catch {
    // cache unavailable (e.g. private mode): skip the write
  }
}

export async function clearCache(): Promise<void> {
  try {
    await clear(getStore());
  } catch {
    // ignore
  }
}
