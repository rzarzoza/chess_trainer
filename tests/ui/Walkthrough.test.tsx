// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Chess } from 'chess.js';
import type { CSSProperties } from 'react';
import type { Color, ExplainedLine, GameAnalysis, GameRecord, Moment, MoveEval, Weakness } from '../../src/types';

vi.mock('react-chessboard', () => ({
  Chessboard: ({ options }: { options: { id: string; position: string; boardOrientation: string; squareStyles?: Record<string, CSSProperties> } }) => (
    <div
      data-testid={options.id === 'walkthrough-board' ? 'board' : 'mini'}
      data-fen={options.position}
      data-orientation={options.boardOrientation}
      data-squares={Object.keys(options.squareStyles ?? {}).sort().join(',')}
      data-bad={Object.entries(options.squareStyles ?? {})
        .filter(([, s]) => String(s.boxShadow ?? '').includes('--bad')).map(([k]) => k).sort().join(',')}
      data-good={Object.entries(options.squareStyles ?? {})
        .filter(([, s]) => String(s.boxShadow ?? '').includes('--good')).map(([k]) => k).sort().join(',')}
    />
  ),
}));

import { Walkthrough } from '../../src/ui/Walkthrough';
import { ExampleList } from '../../src/ui/ExampleList';

afterEach(cleanup);

// 1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5?? (Black's 5th move is the moment)
const SANS = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Nxd5', 'Nxf7', 'Kxf7'];
const MOMENT_PLY = 10;

function makeGame(userColor: Color, over: Partial<GameRecord> = {}): GameRecord {
  const chess = new Chess();
  const plies = SANS.map((san, i) => {
    const before = chess.fen();
    const mv = chess.move(san);
    return { ply: i + 1, san: mv.san, uci: mv.from + mv.to, fenBefore: before, fenAfter: chess.fen(), color: mv.color as Color, clockSec: null };
  });
  return {
    id: 'g1', headers: {}, white: userColor === 'w' ? 'me' : 'rival99', black: userColor === 'b' ? 'me' : 'rival99',
    userColor, result: '1-0', userResult: userColor === 'w' ? 'win' : 'loss', timeClass: 'rapid', baseTimeSec: 600,
    opening: { eco: null, name: 'Two Knights', family: 'Italian Game' }, plies, date: null,
    url: 'https://www.chess.com/game/live/1', ...over,
  };
}

function line(fen: string, uci: string[], notes: string[], keySquares: string[], summary: string): ExplainedLine {
  const chess = new Chess(fen);
  const san = uci.map((u) => chess.move({ from: u.slice(0, 2), to: u.slice(2, 4) }).san);
  return { uci, san, stepNotes: notes, motif: { type: 'fork', keySquares, targets: [], piece: 'n@a5' }, summary, userMoves: 2 };
}

function makeAnalysis(game: GameRecord, withPunishment = true): GameAnalysis {
  const p = game.plies[MOMENT_PLY - 1];
  const moves: MoveEval[] = game.plies.map((pl) => {
    const byUser = pl.color === game.userColor;
    const label = !byUser ? 'opponent' : pl.ply === MOMENT_PLY ? 'blunder' : 'good';
    return { ply: pl.ply, san: pl.san, byUser, winBefore: 50, winAfter: 50, drop: 0, label };
  });
  const moment: Moment = {
    ply: MOMENT_PLY, playedSan: p.san, fenBefore: p.fenBefore, winBefore: 50, winAfter: 20, drop: 30,
    mistakeType: 'walked-into-tactic',
    better: line(p.fenBefore, ['c6a5', 'c4b5', 'c7c6'], ['attacks the bishop', 'check', 'blocks the check'], ['a5'], 'Saves the pawn.'),
    punishment: withPunishment
      ? line(p.fenAfter, ['g5f7', 'e8f7', 'd1f3'], ['takes your pawn', 'takes the knight', 'check, and it hits the knight'], ['d5'], 'He wins back more.')
      : null,
    punished: true, explanation: 'You played Nxd5. He answered with Nxf7.', phase: 'opening', lowClock: false, pieceInvolved: null, trigger: 'swing', materialLost: 0,
  };
  return { gameId: game.id, analysisVersion: 1, moves, moments: [moment] };
}

const board = () => screen.getByTestId('board');

describe('Walkthrough', () => {
  it('board oriented black for black user', () => {
    const game = makeGame('b');
    render(<Walkthrough game={game} analysis={makeAnalysis(game)} startPly={MOMENT_PLY} onBack={vi.fn()} />);
    expect(board()).toHaveAttribute('data-orientation', 'black');
    // opens on the turning point: the position after the played move, its squares in red
    expect(board()).toHaveAttribute('data-fen', game.plies[MOMENT_PLY - 1].fenAfter);
    expect(board()).toHaveAttribute('data-bad', 'd5,f6');
    expect(screen.getByText(/You \(Black\) vs\. rival99 · Rapid · lost/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Chess\.com/ })).toHaveAttribute('href', 'https://www.chess.com/game/live/1');
    expect(screen.getByText('You played Nxd5. He answered with Nxf7.')).toBeInTheDocument();
  });

  it('board oriented white for white user', () => {
    const game = makeGame('w');
    render(<Walkthrough game={game} analysis={makeAnalysis(game)} startPly={MOMENT_PLY} onBack={vi.fn()} />);
    expect(board()).toHaveAttribute('data-orientation', 'white');
  });

  it('calm moves collapsed into summary text', () => {
    const game = makeGame('b');
    render(<Walkthrough game={game} analysis={makeAnalysis(game)} startPly={MOMENT_PLY} onBack={vi.fn()} />);
    const moves = screen.getByRole('list', { name: 'Moves' });
    const calm = screen.getByRole('button', { name: /Moves 1–3: solid\./ });
    expect(calm).toHaveAttribute('aria-expanded', 'false');
    expect(moves).not.toHaveTextContent('e4');
    // the lead-in pair and the moment stay visible
    expect(screen.getByRole('button', { name: '4. Ng5' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5… Nxd5??' })).toHaveClass('mv-blunder');
    expect(screen.getByRole('button', { name: '4… d5' })).toHaveClass('mv-good');
    expect(screen.getByRole('button', { name: '5. exd5' })).not.toHaveClass('mv-good');
    fireEvent.click(calm);
    expect(screen.getByRole('button', { name: '1. e4' })).toBeInTheDocument();
    // clicking a move jumps the board to the position after it
    fireEvent.click(screen.getByRole('button', { name: '1. e4' }));
    expect(board()).toHaveAttribute('data-fen', game.plies[0].fenAfter);
  });

  it('stepping better line advances board fen and shows step note', () => {
    const game = makeGame('b');
    const analysis = makeAnalysis(game);
    const better = analysis.moments[0].better!;
    render(<Walkthrough game={game} analysis={analysis} startPly={MOMENT_PLY} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Better line' }));
    const fens = (() => {
      const c = new Chess(analysis.moments[0].fenBefore);
      return better.uci.map((u) => { c.move({ from: u.slice(0, 2), to: u.slice(2, 4) }); return c.fen(); });
    })();
    expect(board()).toHaveAttribute('data-fen', fens[0]);
    expect(board()).toHaveAttribute('data-good', 'a5,c6');
    expect(screen.getByText('attacks the bishop').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Saves the pawn.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next move' }));
    expect(board()).toHaveAttribute('data-fen', fens[1]);
    expect(board()).toHaveAttribute('data-good', 'a5,b5,c4');
    expect(screen.getByText('check').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('6. Bb5+')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(board()).toHaveAttribute('data-fen', fens[2]);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(board()).toHaveAttribute('data-fen', fens[0]);
  });

  it('arrow keys are ignored while typing in an input', () => {
    const game = makeGame('b');
    render(<><input aria-label="typing" /><Walkthrough game={game} analysis={makeAnalysis(game)} startPly={MOMENT_PLY} onBack={vi.fn()} /></>);
    const before = board().getAttribute('data-fen');
    fireEvent.keyDown(screen.getByLabelText('typing'), { key: 'ArrowRight' });
    expect(board()).toHaveAttribute('data-fen', before!);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(board()).toHaveAttribute('data-fen', game.plies[MOMENT_PLY].fenAfter);
  });

  it('punishment stepper hidden when null', () => {
    const game = makeGame('b');
    const { unmount } = render(<Walkthrough game={game} analysis={makeAnalysis(game, false)} startPly={MOMENT_PLY} onBack={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'What he could do to you' })).not.toBeInTheDocument();
    unmount();
    render(<Walkthrough game={game} analysis={makeAnalysis(game, true)} startPly={MOMENT_PLY} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'What he could do to you' }));
    expect(board()).toHaveAttribute('data-bad', 'd5,f7,g5');
    expect(screen.getByText('He wins back more.')).toBeInTheDocument();
  });

  it('opening summary stops before a Black moment\'s move number', () => {
    const game = makeGame('b');
    render(<Walkthrough game={game} analysis={makeAnalysis(game)} startPly={MOMENT_PLY} onBack={vi.fn()} />);
    const expl = document.querySelector('.expl')!;
    expect(expl).toHaveTextContent('Moves 1–4: solid.');
    expect(expl).not.toHaveTextContent('Moves 1–5');
    expect(expl).toHaveTextContent('Move 5… Nxd5 was the turning point.');
  });

  it('says "the mistake", not "the turning point", for a moment that did not decide the game', () => {
    const game = makeGame('b', { userResult: 'win', result: '0-1' });
    render(<Walkthrough game={game} analysis={makeAnalysis(game)} startPly={MOMENT_PLY} onBack={vi.fn()} />);
    const expl = document.querySelector('.expl')!;
    expect(expl).toHaveTextContent('Move 5… Nxd5 was the mistake.');
    expect(expl).not.toHaveTextContent('turning point');
  });

  it('in a lost game, only the deciding moment is the turning point', () => {
    const game = makeGame('b');
    const analysis = makeAnalysis(game);
    // A bigger swing later decides the game, so the ply-10 moment is just a mistake.
    const later = { ...analysis.moments[0], ply: 12, playedSan: 'Kxf7', drop: 60 };
    analysis.moments.push(later);
    const { unmount } = render(<Walkthrough game={game} analysis={analysis} startPly={MOMENT_PLY} onBack={vi.fn()} />);
    expect(document.querySelector('.expl')!).toHaveTextContent('Move 5… Nxd5 was the mistake.');
    unmount();
    render(<Walkthrough game={game} analysis={analysis} startPly={12} onBack={vi.fn()} />);
    expect(document.querySelector('.expl')!).toHaveTextContent('Move 6… Kxf7 was the turning point.');
  });

  it('earlier Black-flagged move keeps its lead-in visible', () => {
    const game = makeGame('b');
    const analysis = makeAnalysis(game);
    analysis.moves[7] = { ...analysis.moves[7], label: 'inaccuracy' }; // 4… d5?!
    render(<Walkthrough game={game} analysis={analysis} startPly={MOMENT_PLY} onBack={vi.fn()} />);
    const moves = screen.getByRole('list', { name: 'Moves' });
    // plies 1–4 collapse; the full move before the flagged Black move (3. Bc4 Nf6) and 4. Ng5 stay visible
    expect(screen.getByRole('button', { name: /Moves 1–2: solid\./ })).toBeInTheDocument();
    expect(moves).not.toHaveTextContent('Nc6');
    expect(screen.getByRole('button', { name: '3. Bc4' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3… Nf6' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '4. Ng5' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '4… d5?!' })).toHaveClass('mv-inaccuracy');
    // the single calm ply between the two flagged moves is not collapsed
    expect(screen.getByRole('button', { name: '5. exd5' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /solid/ })).toHaveLength(1);
  });

  it('shows a friendly message when the moment is missing', () => {
    const game = makeGame('b');
    const onBack = vi.fn();
    render(<Walkthrough game={game} analysis={makeAnalysis(game)} startPly={3} onBack={onBack} />);
    expect(screen.getByText(/couldn't find that moment/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe('ExampleList', () => {
  it('lists one row per example and opens it', () => {
    const game = makeGame('b');
    const analyses = new Map([[game.id, makeAnalysis(game)]]);
    const weakness: Weakness = {
      key: 'type:walked-into-tactic', kind: 'mistake-type', title: 'Walking into tactics', summary: 'Happened 1 time',
      count: 1, gamesDecided: 0, cost: 1, examples: [{ gameId: 'g1', ply: MOMENT_PLY }], typical: { gameId: 'g1', ply: MOMENT_PLY },
    };
    const onOpen = vi.fn();
    const onBack = vi.fn();
    render(<ExampleList weakness={weakness} games={[game]} analyses={analyses} onOpen={onOpen} onBack={onBack} />);
    expect(screen.getByRole('heading', { name: 'Walking into tactics' })).toBeInTheDocument();
    expect(screen.getByText('Happened 1 time')).toBeInTheDocument();
    const row = screen.getByRole('button', { name: /rival99/ });
    expect(row).toHaveTextContent('Rapid');
    expect(row).toHaveTextContent('move 5');
    expect(row).toHaveTextContent('lost');
    expect(screen.getByTestId('mini')).toHaveAttribute('data-orientation', 'black');
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith({ gameId: 'g1', ply: MOMENT_PLY });
    fireEvent.click(screen.getByRole('button', { name: /Back to report/ }));
    expect(onBack).toHaveBeenCalled();
  });
});
