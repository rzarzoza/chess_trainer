import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runQueue } from '../../src/analysis/queue';
import { clearCache, getCached } from '../../src/storage/cache';
import { ANALYSIS_VERSION, type Engine, type EngineLine, type GameAnalysis, type GameRecord } from '../../src/types';
import { abortableEngine, isAbortError } from '../../src/ui/appHelpers';

beforeEach(async () => { await clearCache(); });

function deferredEngine() {
  const pending: { resolve: (l: EngineLine[]) => void; reject: (e: Error) => void }[] = [];
  const engine: Engine = {
    analyse: vi.fn(() => new Promise<EngineLine[]>((resolve, reject) => { pending.push({ resolve, reject }); })),
    dispose: vi.fn(),
  };
  return { engine, pending };
}

describe('abortableEngine', () => {
  it('rejects an in-flight call with an AbortError as soon as the signal aborts', async () => {
    const { engine } = deferredEngine();
    const ctrl = new AbortController();
    const onFailure = vi.fn();
    const p = abortableEngine(engine, ctrl.signal, onFailure).analyse('fen', { depth: 10 });
    ctrl.abort();
    const err = await p.catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('rejects immediately without calling the engine once aborted', async () => {
    const { engine } = deferredEngine();
    const ctrl = new AbortController();
    ctrl.abort();
    const err = await abortableEngine(engine, ctrl.signal, vi.fn()).analyse('fen', { depth: 10 }).catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
    expect(engine.analyse).not.toHaveBeenCalled();
  });

  it('reports a real engine failure even after the user aborted', async () => {
    const { engine, pending } = deferredEngine();
    const ctrl = new AbortController();
    const onFailure = vi.fn();
    const p = abortableEngine(engine, ctrl.signal, onFailure).analyse('fen', { depth: 10 }).catch(() => {});
    ctrl.abort();
    await p;
    pending[0].reject(new Error('worker died'));
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledTimes(1));
  });

  it('reports engine failure and passes results through', async () => {
    const { engine, pending } = deferredEngine();
    const onFailure = vi.fn();
    const wrapped = abortableEngine(engine, new AbortController().signal, onFailure);
    const ok = wrapped.analyse('a', { depth: 1 });
    pending[0].resolve([]);
    expect(await ok).toEqual([]);
    const bad = wrapped.analyse('b', { depth: 1 }).catch((e: unknown) => e);
    pending[1].reject(new Error('boom'));
    expect(isAbortError(await bad)).toBe(false);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('a game stopped mid-analysis is neither returned nor cached', async () => {
    const { engine } = deferredEngine();
    const ctrl = new AbortController();
    const wrapped = abortableEngine(engine, ctrl.signal, vi.fn());
    const analyze = async (g: GameRecord, e: Engine): Promise<GameAnalysis> => {
      await e.analyse('one', { depth: 10 });
      await e.analyse('two', { depth: 10 });
      return { gameId: g.id, analysisVersion: ANALYSIS_VERSION, moves: [], moments: [] };
    };
    const run = runQueue([{ id: 'g1', userColor: 'w' } as GameRecord], wrapped, () => {}, ctrl.signal, analyze);
    await vi.waitFor(() => expect(engine.analyse).toHaveBeenCalledTimes(1));
    ctrl.abort();
    expect(await run).toEqual([]);
    expect(engine.analyse).toHaveBeenCalledTimes(1);
    expect(await getCached('g1', 'w')).toBeNull();
  });
});
