import { useEffect, useMemo, useRef, useState } from 'react';
import { runQueue } from '../analysis/queue';
import { buildReport } from '../patterns/buildReport';
import { createStockfishEngine } from '../engine/stockfishEngine';
import { parseGames } from '../pgn/parseGames';
import type { Engine, ExampleRef, GameAnalysis, GameRecord, SkippedGame, TimeClass } from '../types';
import { abortableEngine, isAbortError, makeBoardLookup } from './appHelpers';
import { ExampleList } from './ExampleList';
import { ImportPanel, WhichOneIsYou } from './ImportPanel';
import { ProgressBar } from './ProgressBar';
import { ReportView } from './ReportView';
import { Walkthrough, WalkthroughMissing } from './Walkthrough';

export type View =
  | { name: 'report' }
  | { name: 'examples'; key: string }
  | { name: 'walkthrough'; gameId: string; ply: number; fromExamples?: string };

export interface AppState {
  games: GameRecord[];
  analyses: Map<string, GameAnalysis>;
  filter: TimeClass | 'all';
  view: View;
}

type Stage = 'import' | 'choose-side' | 'analysing' | 'done';

const ENGINE_ERROR = "Couldn't start the chess engine. Try reloading the page.";

export default function App() {
  const [state, setState] = useState<AppState>({ games: [], analyses: new Map(), filter: 'all', view: { name: 'report' } });
  const [skipped, setSkipped] = useState<SkippedGame[]>([]);
  const [stage, setStageState] = useState<Stage>('import');
  const [stopped, setStopped] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const engineRef = useRef<Promise<Engine> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stageRef = useRef<Stage>('import');

  function setStage(next: Stage) {
    stageRef.current = next;
    setStageState(next);
  }

  useEffect(() => () => abortRef.current?.abort(), []);
  // A new screen starts at the top (the report can be long on a phone).
  useEffect(() => { if (typeof window.scrollTo === 'function') window.scrollTo(0, 0); }, [state.view]);

  /** Create the engine once and keep it; a failed engine is dropped so a later run can retry. */
  function getEngine(): Promise<Engine> {
    if (!engineRef.current) {
      const p = createStockfishEngine();
      engineRef.current = p;
      p.catch(() => { if (engineRef.current === p) engineRef.current = null; });
    }
    return engineRef.current;
  }

  async function analyse(games: GameRecord[]) {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState((s) => ({ ...s, games, analyses: new Map(), view: { name: 'report' } }));
    setError(null);
    setStopped(false);
    const eligible = games.filter((g) => g.userColor !== null).length;
    setProgress({ done: 0, total: eligible });
    setStage('analysing');

    const enginePromise = getEngine();
    let engine: Engine;
    try {
      engine = await enginePromise;
    } catch {
      if (abortRef.current !== ctrl) return;
      setError(ENGINE_ERROR);
      setStage('done');
      return;
    }

    // runQueue swallows per-game failures, so watch the engine: a real failure drops the cached engine (even after a
    // user abort) and stops the run; an abort makes the in-flight game fail fast so it's neither shown nor cached.
    let engineFailed = false;
    const watched = abortableEngine(engine, ctrl.signal, (err) => {
      if (isAbortError(err) || engineFailed) return;
      engineFailed = true;
      if (engineRef.current === enginePromise) engineRef.current = null;
      engine.dispose();
      if (abortRef.current === ctrl) setError(ENGINE_ERROR);
      ctrl.abort();
    });

    try {
      await runQueue(games, watched, (p) => {
        if (abortRef.current !== ctrl) return;
        setProgress({ done: p.done, total: p.total });
        const finished = p.finished;
        if (finished) {
          setState((s) => {
            const analyses = new Map(s.analyses);
            analyses.set(finished.gameId, finished);
            return { ...s, analyses };
          });
        }
      }, ctrl.signal);
    } catch {
      if (abortRef.current === ctrl) setError('Something went wrong while analysing your games.');
    }
    if (abortRef.current !== ctrl) return;
    setStage('done');
  }

  function onImport(pgnText: string, username: string | null) {
    if (stageRef.current !== 'import') return; // a late fetch/file result must not replace a running analysis
    const { games, skipped: sk } = parseGames(pgnText, username);
    setSkipped(sk);
    if (games.length === 0) {
      setImportError(sk.length > 0
        ? `We can't analyse any of these games (variants, daily, or too short).`
        : 'No games found in that file.');
      return;
    }
    setImportError(null);
    if (games.some((g) => g.userColor === null)) {
      setState((s) => ({ ...s, games }));
      setStage('choose-side');
    } else {
      void analyse(games);
    }
  }

  function startOver() {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((s) => ({ ...s, games: [], analyses: new Map(), view: { name: 'report' } }));
    setSkipped([]);
    setError(null);
    setStopped(false);
    setStage('import');
  }

  const report = useMemo(
    () => buildReport(state.games, [...state.analyses.values()], state.filter, skipped.length),
    [state.games, state.analyses, state.filter, skipped.length],
  );
  const boardFor = useMemo(() => makeBoardLookup(state.games, state.analyses), [state.games, state.analyses]);
  const unmatched = state.games.filter((g) => g.userColor === null).length;
  const analysedCount = state.analyses.size;
  const showReport = (stage === 'analysing' || stage === 'done') && state.view.name === 'report'
    && (analysedCount > 0 || (stage === 'done' && !error));
  const view = state.view;
  const inResults = stage === 'analysing' || stage === 'done';
  const setView = (next: View) => setState((s) => ({ ...s, view: next }));
  const back = () => setView({ name: 'report' });

  return (
    <div className="app">
      <header className="app-header">
        <h1>Chess Trainer</h1>
        {stage !== 'import' && (
          <button type="button" className="secondary-btn" onClick={startOver}>New import</button>
        )}
      </header>

      <main>
        {stage === 'import' && <ImportPanel onImport={onImport} error={importError} />}

        {stage === 'choose-side' && (
          <WhichOneIsYou games={state.games} onResolve={(games) => void analyse(games)} />
        )}

        {error && <p className="error" role="alert">{error}</p>}

        {stage === 'analysing' && (
          <ProgressBar
            done={progress.done}
            total={progress.total}
            onStop={() => { abortRef.current?.abort(); setStopped(true); setStage('done'); }}
          />
        )}

        {stage === 'analysing' && analysedCount === 0 && !error && (
          <p className="muted" aria-live="polite">Analysing your first game…</p>
        )}

        {stage === 'done' && stopped && (
          <p className="muted">Analysis stopped — showing {analysedCount} {analysedCount === 1 ? 'game' : 'games'}.</p>
        )}

        {showReport && (
          <ReportView
            report={report}
            filter={state.filter}
            onFilter={(filter) => setState((s) => ({ ...s, filter }))}
            onOpenExamples={(key) => setView({ name: 'examples', key })}
            onOpenExample={(ref: ExampleRef) => setView({ name: 'walkthrough', gameId: ref.gameId, ply: ref.ply })}
            boardFor={boardFor}
            leftOutCount={unmatched}
          />
        )}

        {inResults && view.name === 'examples' && (() => {
          const weakness = report.weaknesses.find((w) => w.key === view.key);
          if (!weakness) {
            return (
              <section className="panel">
                <button type="button" className="secondary-btn" onClick={back}>← Back to report</button>
                <p>Those examples aren't in the current results any more.</p>
              </section>
            );
          }
          return (
            <ExampleList
              weakness={weakness}
              games={state.games}
              analyses={state.analyses}
              onOpen={(ref) => setView({ name: 'walkthrough', gameId: ref.gameId, ply: ref.ply, fromExamples: view.key })}
              onBack={back}
            />
          );
        })()}

        {inResults && view.name === 'walkthrough' && (() => {
          const game = state.games.find((g) => g.id === view.gameId);
          const analysis = state.analyses.get(view.gameId);
          const fromExamples = view.fromExamples;
          const onBack = fromExamples ? () => setView({ name: 'examples', key: fromExamples }) : back;
          const backLabel = fromExamples ? '← Back to examples' : '← Back to report';
          if (!game || !analysis) return <WalkthroughMissing onBack={onBack} backLabel={backLabel} />;
          return (
            <Walkthrough
              key={`${view.gameId}:${view.ply}`}
              game={game}
              analysis={analysis}
              startPly={view.ply}
              onBack={onBack}
              backLabel={backLabel}
            />
          );
        })()}
      </main>
    </div>
  );
}
