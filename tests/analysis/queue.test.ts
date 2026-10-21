import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runQueue } from '../../src/analysis/queue';
import { clearCache, getCached, putCached } from '../../src/storage/cache';
import { ANALYSIS_VERSION, type Engine, type GameAnalysis, type GameRecord } from '../../src/types';

const engine: Engine = { analyse: async () => [], dispose() {} };
const game = (id: string, userColor: 'w' | 'b' | null = 'w'): GameRecord => ({ id, userColor } as GameRecord);
const fake = (version = ANALYSIS_VERSION) =>
  vi.fn(async (g: GameRecord): Promise<GameAnalysis> => ({ gameId: g.id, analysisVersion: version, moves: [], moments: [] }));

beforeEach(async () => { await clearCache(); });

describe('runQueue', () => {
  it('analyses uncached games and caches them', async () => {
    const games = [game('a'), game('b')];
    const an = fake();
    const out = await runQueue(games, engine, () => {}, undefined, an);
    expect(out).toHaveLength(2);
    expect(an).toHaveBeenCalledTimes(2);
    const an2 = fake();
    const out2 = await runQueue(games, engine, () => {}, undefined, an2);
    expect(an2).toHaveBeenCalledTimes(0);
    expect(out2).toHaveLength(2);
  });

  it('old version is re-analysed', async () => {
    await putCached({ gameId: 'a', analysisVersion: ANALYSIS_VERSION - 1, moves: [], moments: [] }, 'w');
    expect(await getCached('a', 'w')).toBeNull();
    const an = fake();
    await runQueue([game('a')], engine, () => {}, undefined, an);
    expect(an).toHaveBeenCalledTimes(1);
    expect((await getCached('a', 'w'))?.analysisVersion).toBe(ANALYSIS_VERSION);
  });

  it('abort mid-run keeps finished games cached', async () => {
    const games = [game('a'), game('b'), game('c')];
    const ctl = new AbortController();
    const an = fake();
    const out = await runQueue(games, engine, p => { if (p.finished) ctl.abort(); }, ctl.signal, an);
    expect(out).toHaveLength(1);
    expect(an).toHaveBeenCalledTimes(1);
    const an2 = fake();
    const out2 = await runQueue(games, engine, () => {}, undefined, an2);
    expect(an2).toHaveBeenCalledTimes(2);
    expect(out2).toHaveLength(3);
  });

  it('done counts up to total, skipping null-color games; cached first', async () => {
    await putCached({ gameId: 'b', analysisVersion: ANALYSIS_VERSION, moves: [], moments: [] }, 'w');
    const events: { done: number; total: number; finished: string | null }[] = [];
    await runQueue([game('a'), game('b'), game('x', null)], engine,
      p => events.push({ done: p.done, total: p.total, finished: p.finished?.gameId ?? null }), undefined, fake());
    const fin = events.filter(e => e.finished);
    expect(fin.map(e => e.finished)).toEqual(['b', 'a']);
    expect(fin.map(e => e.done)).toEqual([1, 2]);
    expect(events.every(e => e.total === 2)).toBe(true);
  });

  it('a failing game is skipped and counted as done', async () => {
    const an = vi.fn(async (g: GameRecord) => {
      if (g.id === 'a') throw new Error('boom');
      return { gameId: g.id, analysisVersion: ANALYSIS_VERSION, moves: [], moments: [] } as GameAnalysis;
    });
    let last = 0;
    const out = await runQueue([game('a'), game('b')], engine, p => { last = p.done; }, undefined, an);
    expect(out.map(a => a.gameId)).toEqual(['b']);
    expect(last).toBe(2);
  });

  it('the cache is per user side: the same game analysed as White, then as Black, is a miss', async () => {
    const an = fake();
    await runQueue([game('a', 'w')], engine, () => {}, undefined, an);
    expect(an).toHaveBeenCalledTimes(1);
    expect(await getCached('a', 'w')).not.toBeNull();
    expect(await getCached('a', 'b')).toBeNull();
    const an2 = fake();
    await runQueue([game('a', 'b')], engine, () => {}, undefined, an2);
    expect(an2).toHaveBeenCalledTimes(1); // not served White's analysis
    const an3 = fake();
    await runQueue([game('a', 'w'), game('a', 'b')], engine, () => {}, undefined, an3);
    expect(an3).toHaveBeenCalledTimes(0); // both sides now cached separately
  });
});
