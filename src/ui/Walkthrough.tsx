import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Chessboard } from 'react-chessboard';
import { calmSummary } from '../analysis/explain';
import { replayLine } from '../chess/board';
import { decidingMoment } from '../patterns/buildReport';
import type { ExplainedLine, GameAnalysis, GameRecord, Moment, MoveEval } from '../types';
import { moveNumber, opponentOf, plyLabel, resultWord, timeClassLabel } from './appHelpers';

export interface WalkthroughProps {
  game: GameRecord;
  analysis: GameAnalysis;
  startPly: number;
  onBack(): void;
  backLabel?: string;
}

type Mode = 'game' | 'better' | 'punish';

interface Step { label: string; note: string; fen: string; squares: string[] }

const BAD: CSSProperties = { boxShadow: 'inset 0 0 0 4px var(--bad)' };
const GOOD: CSSProperties = { boxShadow: 'inset 0 0 0 4px var(--good)' };
const LAST: CSSProperties = { backgroundColor: 'rgba(255, 214, 0, 0.4)' };

const squaresOf = (uci: string | undefined) => (uci && uci.length >= 4 ? [uci.slice(0, 2), uci.slice(2, 4)] : []);

/** The steps of a line from `root`, each labelled with its move number ("18. Nc7+", "18… Kd7"). */
function lineSteps(root: string, line: ExplainedLine): Step[] {
  const { fens } = replayLine(root, line.uci);
  const [, turn, , , , full] = root.split(' ');
  const first = Number(full) > 0 ? Number(full) : 1;
  const steps: Step[] = [];
  for (let i = 0; i < line.uci.length && i + 1 < fens.length; i++) {
    const offset = i + (turn === 'b' ? 1 : 0);
    const n = first + Math.floor(offset / 2);
    const san = line.san[i] ?? line.uci[i];
    steps.push({
      label: offset % 2 === 0 ? `${n}. ${san}` : `${n}… ${san}`,
      note: line.stepNotes[i] ?? '',
      fen: fens[i + 1],
      squares: squaresOf(line.uci[i]),
    });
  }
  return steps;
}

const SUFFIX: Partial<Record<MoveEval['label'], string>> = { inaccuracy: '?!', blunder: '??' };
const isRough = (e: MoveEval | undefined) => e?.label === 'inaccuracy' || e?.label === 'blunder';

type Token =
  | { kind: 'move'; ply: number }
  | { kind: 'calm'; from: number; to: number };

/**
 * The move list as tokens. Before the moment, each run of plies with nothing flagged collapses into one calm token,
 * except the full move leading into the next flagged move (so the build-up stays visible). Runs under 4 plies stay open.
 */
function moveTokens(plyCount: number, momentPly: number, evals: Map<number, MoveEval>): Token[] {
  const out: Token[] = [];
  let ply = 1;
  while (ply <= plyCount) {
    if (ply >= momentPly || isRough(evals.get(ply))) {
      out.push({ kind: 'move', ply });
      ply += 1;
      continue;
    }
    let end = ply;
    while (end + 1 < momentPly && !isRough(evals.get(end + 1))) end += 1;
    const tail = (end - 1) % 2 === 1 ? end - 1 : end - 2; // White's ply of the full move before the next flagged one
    if (tail - ply >= 4) {
      out.push({ kind: 'calm', from: ply, to: tail - 1 });
      ply = tail;
    }
    for (; ply <= end; ply++) out.push({ kind: 'move', ply });
  }
  return out;
}

export function Walkthrough(props: WalkthroughProps) {
  const moment = props.analysis.moments.find((m) => m.ply === props.startPly);
  if (!moment || props.game.plies.length < moment.ply) {
    return <WalkthroughMissing onBack={props.onBack} backLabel={props.backLabel} />;
  }
  return <WalkthroughView {...props} moment={moment} />;
}

export function WalkthroughMissing({ onBack, backLabel = '← Back' }: { onBack(): void; backLabel?: string }) {
  return (
    <section className="panel">
      <button type="button" className="secondary-btn" onClick={onBack}>{backLabel}</button>
      <p>Sorry, we couldn't find that moment in your games. It may have been left out by the current filter.</p>
    </section>
  );
}

function WalkthroughView({ game, analysis, moment, onBack, backLabel = '← Back' }: WalkthroughProps & { moment: Moment }) {
  const plies = game.plies;
  const orientation = game.userColor === 'b' ? 'black' : 'white';
  const evals = useMemo(() => new Map(analysis.moves.map((e) => [e.ply, e])), [analysis.moves]);
  const tokens = useMemo(() => moveTokens(plies.length, moment.ply, evals), [plies.length, moment.ply, evals]);
  const punishRoot = plies[moment.ply - 1].fenAfter;
  const betterSteps = useMemo(() => (moment.better ? lineSteps(moment.fenBefore, moment.better) : []), [moment]);
  const punishSteps = useMemo(() => (moment.punishment ? lineSteps(punishRoot, moment.punishment) : []), [moment, punishRoot]);

  const [mode, setMode] = useState<Mode>('game');
  const [gamePos, setGamePos] = useState(moment.ply);
  const [betterPos, setBetterPos] = useState(Math.min(1, betterSteps.length));
  const [punishPos, setPunishPos] = useState(Math.min(1, punishSteps.length));
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  const stepBy = (delta: number) => {
    const clamp = (max: number) => (p: number) => Math.min(max, Math.max(0, p + delta));
    if (mode === 'game') setGamePos(clamp(plies.length));
    else if (mode === 'better') setBetterPos(clamp(betterSteps.length));
    else setPunishPos(clamp(punishSteps.length));
  };

  // ←/→ step the active stepper, except while the user is typing somewhere. Re-subscribed each render (cheap).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      e.preventDefault();
      stepBy(e.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // What the board shows for the active stepper.
  let fen: string;
  const squareStyles: Record<string, CSSProperties> = {};
  if (mode === 'game') {
    fen = gamePos === 0 ? plies[0].fenBefore : plies[gamePos - 1].fenAfter;
    const style = gamePos === moment.ply ? BAD : LAST;
    for (const sq of squaresOf(plies[gamePos - 1]?.uci)) squareStyles[sq] = style;
  } else {
    const isBetter = mode === 'better';
    const steps = isBetter ? betterSteps : punishSteps;
    const pos = isBetter ? betterPos : punishPos;
    const line = isBetter ? moment.better : moment.punishment;
    const style = isBetter ? GOOD : BAD;
    fen = pos === 0 ? (isBetter ? moment.fenBefore : punishRoot) : steps[pos - 1].fen;
    if (pos === 0 && !isBetter) for (const sq of squaresOf(plies[moment.ply - 1].uci)) squareStyles[sq] = BAD;
    for (const sq of line?.motif?.keySquares ?? []) squareStyles[sq] = style;
    if (pos > 0) for (const sq of steps[pos - 1].squares) squareStyles[sq] = style;
  }

  const header = [
    `You (${game.userColor === 'b' ? 'Black' : 'White'}) vs. ${opponentOf(game)}`,
    timeClassLabel(game),
    resultWord(game),
  ].filter(Boolean).join(' · ');

  const tabs: { mode: Mode; label: string }[] = [{ mode: 'game', label: 'The game' }];
  if (moment.better) tabs.push({ mode: 'better', label: 'Better line' });
  if (moment.punishment) tabs.push({ mode: 'punish', label: 'What he could do to you' });

  const toggle = (from: number) => setExpanded((s) => {
    const next = new Set(s);
    if (next.has(from)) next.delete(from);
    else next.add(from);
    return next;
  });

  const renderMove = (ply: number, showNumber: boolean) => {
    const p = plies[ply - 1];
    const e = evals.get(ply);
    const label = `${p.san}${e?.byUser ? SUFFIX[e.label] ?? '' : ''}`;
    const cls = ['mv'];
    if (e?.byUser) cls.push(`mv-${e.label}`);
    const current = mode === 'game' && gamePos === ply;
    if (current) cls.push('mv-current');
    return (
      <li key={`m${ply}`}>
        {showNumber && <span className="mv-no">{moveNumber(ply)}{ply % 2 === 1 ? '.' : '…'}</span>}
        <button
          type="button"
          className={cls.join(' ')}
          aria-label={plyLabel(ply, label)}
          aria-current={current ? 'true' : undefined}
          onClick={() => { setMode('game'); setGamePos(ply); }}
        >
          {label}
        </button>
      </li>
    );
  };

  const items: ReactNode[] = [];
  let prevWasMove = false;
  for (const t of tokens) {
    if (t.kind === 'calm' && !expanded.has(t.from)) {
      items.push(
        <li key={`c${t.from}`}>
          <button type="button" className="calm" aria-expanded="false" onClick={() => toggle(t.from)}>
            {calmSummary(analysis.moves, t.from, t.to)} <span className="muted">(show moves)</span>
          </button>
        </li>,
      );
      prevWasMove = false;
      continue;
    }
    if (t.kind === 'calm') {
      items.push(
        <li key={`c${t.from}`}>
          <button type="button" className="calm" aria-expanded="true" onClick={() => toggle(t.from)}>
            <span className="muted">(hide moves {moveNumber(t.from)}–{moveNumber(t.to)})</span>
          </button>
        </li>,
      );
      for (let ply = t.from; ply <= t.to; ply++) {
        items.push(renderMove(ply, ply % 2 === 1 || ply === t.from));
      }
      prevWasMove = true;
      continue;
    }
    items.push(renderMove(t.ply, t.ply % 2 === 1 || !prevWasMove));
    prevWasMove = true;
  }

  // The opening summary covers only full moves before the moment's move (a Black moment's own move number is excluded).
  const calmEnd = moment.ply % 2 === 0 ? moment.ply - 2 : moment.ply - 1;
  // "Turning point" only for the moment that decided the game (same rule as the report).
  const decisive = decidingMoment(game, analysis)?.ply === moment.ply;
  const activeSteps = mode === 'better' ? betterSteps : punishSteps;
  const activePos = mode === 'better' ? betterPos : punishPos;
  const activeLine = mode === 'better' ? moment.better : mode === 'punish' ? moment.punishment : null;
  const setActivePos = mode === 'better' ? setBetterPos : setPunishPos;
  const maxPos = mode === 'game' ? plies.length : activeSteps.length;
  const curPos = mode === 'game' ? gamePos : activePos;

  return (
    <section className="walkthrough">
      <div className="walk-top">
        <button type="button" className="secondary-btn" onClick={onBack}>{backLabel}</button>
        <p className="walk-header muted">
          {header}
          {game.url && (
            <>
              {' · '}
              <a href={game.url} target="_blank" rel="noopener noreferrer">View this game on Chess.com</a>
            </>
          )}
        </p>
      </div>

      <div className="walk">
        <div className="walk-board">
          <Chessboard
            options={{
              id: 'walkthrough-board',
              position: fen,
              boardOrientation: orientation,
              squareStyles,
              allowDragging: false,
              allowDrawingArrows: false,
              showAnimations: true,
            }}
          />
        </div>

        <div className="walk-panels">
          <ol className="moves" aria-label="Moves">{items}</ol>

          <div className="expl">
            {calmEnd >= 2 && <p><b>{calmSummary(analysis.moves, 1, calmEnd)}</b></p>}
            <p><b>Move {plyLabel(moment.ply, moment.playedSan)} was the {decisive ? 'turning point' : 'mistake'}.</b></p>
            <p>{moment.explanation}</p>
          </div>

          <div className="chips" role="group" aria-label="Step through">
            {tabs.map((t) => (
              <button
                key={t.mode}
                type="button"
                className={`chip${mode === t.mode ? ' on' : ''}`}
                aria-pressed={mode === t.mode}
                onClick={() => setMode(t.mode)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className={`line line-${mode}`}>
            {mode === 'game' ? (
              <>
                <h3>The game</h3>
                <p>
                  {gamePos === 0 ? 'Starting position' : `After ${plyLabel(gamePos, plies[gamePos - 1].san)}`}
                </p>
              </>
            ) : (
              <>
                <h3>{mode === 'better' ? 'What you could have played' : 'What he could do to you'}</h3>
                <ol className="steps">
                  {activeSteps.map((s, i) => (
                    <li key={i} aria-current={i === activePos - 1 ? 'step' : undefined}>
                      <button
                        type="button"
                        className={`step${i === activePos - 1 ? ' cur' : ''}`}
                        onClick={() => setActivePos(i + 1)}
                      >
                        {s.label}
                      </button>
                      {s.note && <span className="step-note">{s.note}</span>}
                    </li>
                  ))}
                </ol>
              </>
            )}
            <div className="stepper">
              <button type="button" aria-label="Previous move" disabled={curPos <= 0} onClick={() => stepBy(-1)}>◀</button>
              <button type="button" aria-label="Next move" disabled={curPos >= maxPos} onClick={() => stepBy(1)}>▶</button>
              <span className="muted">or use the ← → keys</span>
            </div>
            {activeLine && <p className="line-summary">{activeLine.summary}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
