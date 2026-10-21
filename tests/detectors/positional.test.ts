import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { detectMotif } from '../../src/detectors';
import { detectPositional, detectStopsThreat } from '../../src/detectors/positional';
import { nullMoveFen, replayLine } from '../../src/chess/board';
import type { Color, EngineLine, LineContext, Score } from '../../src/types';

// Positions set up by hand; `ctx` re-checks that the FEN is valid and the pv replays legally.
function ctx(fen: string, pv: string[], score: Score = { cp: 200 }): LineContext {
  const mover = new Chess(fen).turn() as Color;
  expect(replayLine(fen, pv).sans).toHaveLength(pv.length);
  return { fen, pv, mover, score };
}

const OPEN_D = '6k1/ppp2ppp/8/8/8/8/PPP2PPP/5RK1 w - - 0 1'; // d- and e-files have no pawns

describe('detectPositional', () => {
  it('rook to open file', () => {
    const m = detectPositional(ctx(OPEN_D, ['f1d1', 'g8f8']), 70);
    expect(m).toMatchObject({ type: 'open-file', piece: 'r@f1' });
    expect(m!.keySquares[0]).toBe('d1');
  });

  it('rook to file with own pawn', () => {
    const fen = '6k1/ppp2ppp/8/8/8/4P3/PPP2PPP/5RK1 w - - 0 1';
    expect(detectPositional(ctx(fen, ['f1e1', 'g8f8']), 70)).toBeNull();
  });

  it('rook that moves along the file it is already on is not "put on" it', () => {
    expect(detectPositional(ctx('6k1/ppp2ppp/8/8/8/8/PPP2PPP/3R2K1 w - - 0 1', ['d1d4']), 70)).toBeNull();
  });

  it('rook to an open file where it can just be taken', () => {
    // Rd1?? — the d8 rook takes it (d1 rook undefended).
    const fen = '3r2k1/ppp2ppp/8/8/8/8/PPP2PPP/5R1K w - - 0 1';
    expect(detectPositional(ctx(fen, ['f1d1']), 70)).toBeNull();
  });

  it('half-open file aimed at the enemy king', () => {
    // Rg1: no white g-pawn; the black g6 pawn is defended by f7/h7, but it is the black king's file.
    const fen = '6k1/pp3p1p/6p1/8/8/8/PP3P1P/5R1K w - - 0 1';
    expect(detectPositional(ctx(fen, ['f1g1']), 70)).toMatchObject({ type: 'open-file', keySquares: ['g1', 'g6'], targets: [] });
  });

  it('half-open file next to the king with only defended pawns names no weak pawn (real game: Qd1)', () => {
    // d5 is defended by e6; the d-file counts only because it is next to the e8 king.
    const fen = 'r2qkbnr/5ppp/p3p3/1p1pP3/3n4/5Q1P/PPB2PP1/RNB1K2R w KQkq - 0 12';
    const m = detectPositional(ctx(fen, ['f3d1']), 30);
    expect(m).toMatchObject({ type: 'open-file', keySquares: ['d1', 'd5'], targets: [] });
  });

  it('half-open file with a weak enemy pawn counts, a pawn-defended one far from the king does not', () => {
    // b-file: no white b-pawn, a lone black b-pawn. Black king on g8.
    const weak = '6k1/p4ppp/8/1p6/8/8/P4PPP/5RK1 w - - 0 1'; // b5 not defended by a pawn
    expect(detectPositional(ctx(weak, ['f1b1']), 70)).toMatchObject({ type: 'open-file', keySquares: ['b1', 'b5'] });
    const solid = '6k1/p1p2ppp/1p6/8/8/8/P4PPP/5RK1 w - - 0 1'; // b6 defended by a7 and c7
    expect(detectPositional(ctx(solid, ['f1b1']), 70)).toBeNull();
  });

  it('half-open file whose enemy pawn is defended by a piece is not credited', () => {
    // QGD-style Rc1 vs c7, defended by the d8 queen; Sicilian-style ...Rc8 vs c2, defended by the d1 queen.
    const qgd = '3q2k1/ppp2ppp/8/3p4/3P4/4P3/PP3PPP/5RK1 w - - 0 1';
    expect(detectPositional(ctx(qgd, ['f1c1']), 70)).toBeNull();
    const sicilian = '5rk1/pp3ppp/3pp3/8/4P3/8/PPP2PPP/3Q2K1 b - - 0 1';
    expect(detectPositional(ctx(sicilian, ['f8c8']), 70)).toBeNull();
  });

  it('rook to open file for Black', () => {
    const fen = '5rk1/ppp2ppp/8/8/8/8/PPP2PPP/6K1 b - - 0 1';
    expect(detectPositional(ctx(fen, ['f8d8', 'g1f1']), 70)).toMatchObject({ type: 'open-file', keySquares: ['d8'], piece: 'r@f8' });
  });

  it('g-pawn break vs castled king', () => {
    // g4-g5 hits the h6 pawn in front of the castled g8 king; g5 is covered by h4.
    const fen = '5rk1/ppp2pp1/7p/8/6PP/8/PPP5/2KR4 w - - 0 1';
    const m = detectPositional(ctx(fen, ['g4g5', 'h6g5', 'h4g5']), 70);
    expect(m).toMatchObject({ type: 'pawn-break', subtype: 'king-attack', piece: 'p@g4' });
    expect(m!.keySquares).toEqual(['g5', 'h6']);
  });

  it('pawn push hitting a pawn far from the king with no rook behind it is not a break', () => {
    const fen = '6k1/p4ppp/1p6/8/P7/8/5PPP/6K1 w - - 0 1';
    expect(detectPositional(ctx(fen, ['a4a5']), 70)).toBeNull();
  });

  it('pawn push that opens a file for the rook behind it is a break', () => {
    const fen = '6k1/p4ppp/1p6/8/P7/8/5PPP/R5K1 w - - 0 1';
    expect(detectPositional(ctx(fen, ['a4a5']), 70)).toMatchObject({ type: 'pawn-break', subtype: 'opens-file', keySquares: ['a5', 'b6'] });
  });

  it.each([
    ['1.e4 d5', 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', 'd7d5'],
    ['French 2...d5', 'rnbqkbnr/pppp1ppp/4p3/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq - 0 2', 'd7d5'],
    ['Caro-Kann 2...d5', 'rnbqkbnr/pp1ppppp/2p5/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq - 0 2', 'd7d5'],
    ['Scotch 3.d4', 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', 'd2d4'],
    ['h2-h3 kicking the g4 pawn', '6k1/5p1p/8/8/6p1/8/5PPP/6K1 w - - 0 1', 'h2h3'],
    ['...h6 kicking the g5 pawn, both castled', '6k1/5ppp/8/6P1/8/8/5P1P/6K1 b - - 0 1', 'h7h6'],
  ])('routine pawn move is not a pawn break: %s', (_name, fen, move) => {
    expect(detectPositional(ctx(fen, [move]), 70)?.type).not.toBe('pawn-break');
  });

  it('pawn break where the pawn is simply lost is not credited', () => {
    // g5 is hit by h6 and nothing covers it.
    const fen = '5rk1/ppp2pp1/7p/8/6P1/8/PPP5/2KR4 w - - 0 1';
    expect(detectPositional(ctx(fen, ['g4g5']), 70)).toBeNull();
  });

  it('trade into won endgame, rootWin 85 / rootWin 60', () => {
    // Qxd8+ Rxd8 trades queens into a rook ending with White a pawn up.
    const fen = 'r2q2k1/p4ppp/8/8/8/8/PP3PPP/R2Q2K1 w - - 0 1';
    const line = ctx(fen, ['d1d8', 'a8d8', 'g1f1']);
    expect(detectPositional(line, 85)).toMatchObject({ type: 'winning-trade', keySquares: ['d8'], targets: ['q@d8'] });
    expect(detectPositional(line, 60)).toBeNull();
  });

  it('trade that leaves the mover behind is not a winning trade', () => {
    // Same queen trade, but Black has two extra pawns.
    const fen = 'r2q2k1/pp3ppp/8/8/8/8/P5PP/R2Q2K1 w - - 0 1';
    expect(detectPositional(ctx(fen, ['d1d8', 'a8d8']), 85)).toBeNull();
  });

  it('quiet move in a position that is already an endgame is not a winning trade', () => {
    const fen = '8/8/3k4/3p4/2P5/2K5/1P6/8 w - - 0 1';
    expect(detectPositional(ctx(fen, ['c3d3', 'd6e6', 'd3e3', 'e6d6', 'e3d3', 'd5c4', 'd3c4']), 85)).toBeNull();
  });

  it('a trade that happens later in the line is not credited to pv[0]', () => {
    // Quiet g3 first; the queen trade only comes on plies 2-3.
    const fen = 'r2q2k1/p4ppp/8/8/8/8/PP3PPP/R2Q2K1 w - - 0 1';
    expect(detectPositional(ctx(fen, ['g2g3', 'h7h6', 'd1d8', 'a8d8']), 85)).toBeNull();
  });
});

describe('detectStopsThreat', () => {
  // Black's d4 knight threatens Nc2+ forking the e1 king and a1 rook.
  const FEN = '6k1/5ppp/8/4p3/3n4/8/PP3PPP/R3KB2 w - - 0 1';
  const THREAT: EngineLine = { multipv: 1, score: { cp: 400 }, pv: ['d4c2', 'e1d1', 'c2a1'], depth: 12 };

  it('the threat line really is a fork for the opponent', () => {
    const nf = nullMoveFen(FEN)!;
    const m = detectMotif({ fen: nf, pv: THREAT.pv, mover: 'b', score: THREAT.score });
    expect(m?.type).toBe('fork');
  });

  it('a move that covers the fork square stops the threat', () => {
    const m = detectStopsThreat(ctx(FEN, ['f1d3']), THREAT);
    expect(m).toMatchObject({ type: 'stops-threat', piece: 'b@f1' });
    expect([...m!.targets].sort()).toEqual(['k@e1', 'r@a1']);
    expect(m!.keySquares).toEqual(expect.arrayContaining(['c2', 'e1', 'a1']));
  });

  it('a move that does nothing about it does not', () => {
    expect(detectStopsThreat(ctx(FEN, ['h2h3']), THREAT)).toBeNull();
  });

  it('threat line that breaks at the mover\'s own reply is not claimed', () => {
    // After Kd1 the threat's reply e1d1 no longer exists, so we can't tell what the threat would be.
    expect(detectStopsThreat(ctx(FEN, ['e1d1']), THREAT)).toBeNull();
  });

  it('no threat line, or a threat line with no tactic, gives null', () => {
    expect(detectStopsThreat(ctx(FEN, ['f1d3']), null)).toBeNull();
    const quiet: EngineLine = { multipv: 1, score: { cp: 0 }, pv: ['g8f8'], depth: 12 };
    expect(detectStopsThreat(ctx(FEN, ['f1d3']), quiet)).toBeNull();
  });
});

describe('detectMotif with rootWin', () => {
  it('runs the positional detectors', () => {
    expect(detectMotif(ctx(OPEN_D, ['f1d1', 'g8f8']), { rootWin: 70 })?.type).toBe('open-file');
    expect(detectMotif(ctx(OPEN_D, ['f1d1', 'g8f8']))).toBeNull();
  });

  it('a tactical motif still takes priority over positional', () => {
    // Rd1+ goes to the open d-file AND skewers the d5 king to the d8 queen.
    const line = ctx('3q4/p5p1/8/3k4/8/7P/6PK/R7 w - - 0 1', ['a1d1', 'd5e6', 'd1d8']);
    expect(detectPositional(line, 90)?.type).toBe('open-file');
    expect(detectMotif(line, { rootWin: 90 })?.type).toBe('skewer');
  });
});
