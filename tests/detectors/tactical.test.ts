import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { detectMotif } from '../../src/detectors';
import { detectPin, prepareLine } from '../../src/detectors/tactical';
import { replayLine } from '../../src/chess/board';
import type { Color, LineContext, Score } from '../../src/types';

// Every position below was set up by hand; `ctx` re-checks with chess.js that the FEN is
// valid, that the mover is the side to move, and that the whole pv replays legally.
function ctx(fen: string, pv: string[], score: Score = { cp: 300 }, prevMove?: string): LineContext {
  const chess = new Chess(fen); // throws on an invalid FEN
  const mover = chess.turn() as Color;
  expect(replayLine(fen, pv).sans).toHaveLength(pv.length);
  return prevMove ? { fen, pv, mover, score, prevMove } : { fen, pv, mover, score };
}

const MOCKUP = 'r3k2r/pp3ppp/8/3N4/8/8/PPP2PPP/R3K2R w - - 0 1';
// Mirror image of MOCKUP (ranks flipped, colours swapped), Black to move.
const MOCKUP_BLACK = 'r3k2r/ppp2ppp/8/8/3n4/8/PP3PPP/R3K2R b - - 0 1';

describe('detectMotif — tactical', () => {
  it('knight fork', () => {
    const m = detectMotif(ctx(MOCKUP, ['d5c7', 'e8d7', 'c7a8']));
    expect(m?.type).toBe('fork');
    expect([...m!.targets].sort()).toEqual(['k@e8', 'r@a8']);
    expect(m!.piece).toBe('n@d5');
    expect(m!.keySquares).toEqual(expect.arrayContaining(['c7', 'e8', 'a8']));
  });

  it('back-rank mate in 2', () => {
    // Rd8+ Rxd8 Rxd8#: the g8 king is boxed in by its own f7/g7/h7 pawns.
    const fen = '2r3k1/5ppp/8/8/8/8/3R1PPP/3R2K1 w - - 0 1';
    const pv = ['d2d8', 'c8d8', 'd1d8'];
    const final = replayLine(fen, pv).fens.at(-1)!;
    expect(new Chess(final).isCheckmate()).toBe(true);
    const m = detectMotif(ctx(fen, pv, { mate: 2 }));
    expect(m).toMatchObject({ type: 'mate', mateIn: 2 });
    expect(m!.targets).toEqual(['k@g8']);
  });

  it('absolute pin wins piece', () => {
    // Bb5 pins the d7 queen to the e8 king; the a4 pawn guards b5, so Qxb5 axb5 loses the queen.
    const m = detectMotif(ctx('4k2r/pp1q1ppp/8/8/P7/8/1P3PPP/3Q1BK1 w - - 0 1', ['f1b5', 'd7b5', 'a4b5']));
    expect(m?.type).toBe('pin');
    expect(m!.targets).toEqual(['q@d7', 'k@e8']);
  });

  it('skewer king→queen', () => {
    // Re1+ skewers the e4 king to the e8 queen; the king steps off and Rxe8 follows.
    const m = detectMotif(ctx('4q3/pp6/8/8/4k3/8/5PPP/R5K1 w - - 0 1', ['a1e1', 'e4d5', 'e1e8']));
    expect(m?.type).toBe('skewer');
    expect(m!.targets).toEqual(['k@e4', 'q@e8']);
  });

  it('discovered attack on queen', () => {
    // Nc6+ uncovers the b2 bishop onto the g7 queen; after the king moves, Bxg7.
    const m = detectMotif(ctx('3k4/5pqp/8/8/3N4/8/1B3PPP/6K1 w - - 0 1', ['d4c6', 'd8c7', 'b2g7', 'c7c6']));
    expect(m?.type).toBe('discovered-attack');
    expect(m!.targets).toEqual(['q@g7']);
    expect(m!.piece).toBe('n@d4');
  });

  it('discovered check wins the queen the moved piece attacks', () => {
    // Bd5+ uncovers the e1 rook onto the e8 king; after Kf8, Bxa8.
    const m = detectMotif(ctx('q3k3/8/8/8/4B3/8/8/4R1K1 w - - 0 1', ['e4d5', 'e8f8', 'd5a8']));
    expect(m?.type).toBe('discovered-attack');
    expect([...m!.targets].sort()).toEqual(['k@e8', 'q@a8']);
    expect(m!.piece).toBe('b@e4');
  });

  it('free piece', () => {
    const m = detectMotif(ctx('6k1/5ppp/8/3n4/8/8/5PPP/3R2K1 w - - 0 1', ['d1d5', 'g8f8']));
    expect(m).toMatchObject({ type: 'hanging-piece', targets: ['n@d5'], piece: 'r@d1' });
  });

  it('hanging-piece is marked defended only when the victim had a defender', () => {
    expect(detectMotif(ctx('6k1/5ppp/8/3n4/8/8/5PPP/3R2K1 w - - 0 1', ['d1d5', 'g8f8']))?.defended).toBeUndefined();
    // Real game: Black's Rxd6 wins the queen but the Re6 recaptures — a trade up, not a free piece.
    const fen = '8/2k5/3QR3/4N1K1/8/8/8/3r4 b - - 0 1';
    const m = detectMotif(ctx(fen, ['d1d6', 'e6d6'], { cp: 300 }));
    expect(m).toMatchObject({ type: 'hanging-piece', targets: ['q@d6'], piece: 'r@d1', defended: true });
  });

  it('capture that only incidentally pins is reported as the free piece, not a pin', () => {
    // Rxd5 also lines the rook up on d7-pawn/d8-king, but the pin wins nothing: the gain is the bishop.
    const m = detectMotif(ctx('3k4/3p4/8/3b4/8/8/5PPP/3R2K1 w - - 0 1', ['d1d5', 'd8e8']));
    expect(m).toMatchObject({ type: 'hanging-piece', targets: ['b@d5'] });
  });

  describe('ordinary exchanges are not forks or pins (payoff must capture a target)', () => {
    it('Nxd5 Nxd5 exd5 — the knight "forking" c7/e7 never takes them', () => {
      const m = detectMotif(ctx('7k/2p1p1pp/5n2/3b4/4P3/2N5/5PPP/6K1 w - - 0 1', ['c3d5', 'f6d5', 'e4d5']));
      expect(m?.type).not.toBe('fork');
    });
    it('mirror for Black: Nxd4 Nxd4 exd4', () => {
      const m = detectMotif(ctx('6k1/5ppp/2n5/4p3/3B4/5N2/2P1P1PP/7K b - - 0 1', ['c6d4', 'f3d4', 'e5d4']));
      expect(m?.type).not.toBe('fork');
    });
    it('Bxb5 Nxb5 axb5 — the d7 knight "pinned" to e8 is never taken', () => {
      const m = detectMotif(ctx('4k3/2nn1ppp/8/1b6/P7/8/5PPP/5BK1 w - - 0 1', ['f1b5', 'c7b5', 'a4b5']));
      expect(m?.type).not.toBe('pin');
    });
  });

  describe('pin/skewer payoff must be the pinned piece held on the line, or the piece behind a skewer (real games)', () => {
    it('Qxf6: f2 pawn "pinned" to f1 walks off the file and is taken later — not a pin', () => {
      const m = detectMotif(ctx('r2q1r2/5pk1/p1b1pB1p/1p1p2pB/4P3/2PP4/P4PPP/R2Q1RK1 b - - 0 18',
        ['d8f6', 'e4e5', 'f6e5', 'd3d4', 'e5f4', 'g2g3', 'f4c7', 'f2f4', 'f7f6', 'f4g5', 'h6g5'], { cp: 300 }, 'e5f6'));
      expect(m?.type).not.toBe('pin');
    });
    it('Rhg1: queen "skewered" to the g7 pawn, but g7 is never taken — not a skewer', () => {
      const m = detectMotif(ctx('r4rk1/1b3pp1/p3pn1p/3pQ2P/8/2N2N2/PPP3q1/2K2R1R w - - 0 20',
        ['h1g1', 'f6g4', 'e5f4', 'g2h3', 'f4g4', 'h3g4', 'g1g4', 'f7f6', 'g4b4'], { cp: 300 }, 'f2g2'));
      expect(m?.type).not.toBe('skewer');
    });
    it('Bxf3 gxf3: the pinner is taken at once and e2 falls later to a knight fork — not a pin', () => {
      const m = detectMotif(ctx('r2qr1k1/2p2ppp/p1n5/1p1p3b/3Pn3/PBP1BN1P/2P1RPP1/R2Q2K1 b - - 4 16',
        ['h5f3', 'g2f3', 'e4c3', 'd1d3', 'c3e2', 'd3e2', 'c6d4', 'e2d1', 'd4f5', 'b3d5', 'f5e3', 'f2e3', 'd8g5', 'g1h1']));
      expect(m?.type).not.toBe('pin');
    });
    it('a pin still counts when the pinner stays and the pinned piece is won on the intact line', () => {
      // Bb5 pins the c6 knight to the e8 queen; d4-d5 attacks it and dxc6 wins it.
      const m = detectMotif(ctx('4q1k1/6pp/2n5/8/3P4/8/6PP/5BK1 w - - 0 1', ['f1b5', 'g8f8', 'd4d5', 'f8g8', 'd5c6']));
      expect(m).toMatchObject({ type: 'pin', targets: ['n@c6', 'q@e8'] });
    });
    it('Bb4: queen pinned to the king and taken on c3 — still a pin', () => {
      const m = detectMotif(ctx('r2qkbnr/5ppp/p3p3/1p1pP3/3n4/2Q4P/PPB2PP1/RNB1K2R b KQkq - 1 12',
        ['f8b4', 'c2d1', 'b4c3', 'b1c3', 'g8e7', 'c1e3', 'e7f5', 'h3h4', 'd4c6', 'h4h5', 'c6e5', 'c3d5', 'e6d5']));
      expect(m).toMatchObject({ type: 'pin', targets: ['q@c3', 'k@e1'] });
    });
  });

  it('hanging-piece taken back on the square of the previous move is flagged as a recapture', () => {
    const fen = '6k1/5ppp/8/3n4/8/8/5PPP/3R2K1 w - - 0 1';
    const pv = ['d1d5', 'g8f8'];
    expect(detectMotif(ctx(fen, pv, { cp: 300 }, 'f6d5'))).toMatchObject({ type: 'hanging-piece', recapture: true });
    expect(detectMotif(ctx(fen, pv, { cp: 300 }, 'h8g8'))?.recapture).toBeUndefined();
    expect(detectMotif(ctx(fen, pv))?.recapture).toBeUndefined();
  });

  it('quiet equal line', () => {
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    expect(detectMotif(ctx(start, ['e2e4', 'e7e5', 'g1f3', 'b8c6'], { cp: 30 }))).toBeNull();
  });

  it('fork-shaped move that wins nothing is not called a fork', () => {
    expect(detectMotif(ctx(MOCKUP, ['d5c7', 'e8d7', 'c7d5']))).toBeNull();
  });

  it('material gain beyond cap is ignored', () => {
    // Nc7+ Kf8, then both kings shuffle; White only takes the a8 rook on its 11th move.
    const pv = ['d5c7', 'e8f8'];
    for (let i = 0; i < 9; i++) pv.push(i % 2 === 0 ? 'e1e2' : 'e2e1', i % 2 === 0 ? 'f8e7' : 'e7f8');
    pv.push('c7a8');
    expect(pv).toHaveLength(21); // ply index 20 = White's 11th move
    const c = ctx(MOCKUP, pv);
    expect(detectMotif(c)).toBeNull();
    expect(detectMotif(c, { depthCap: 9 })).toBeNull();
    expect(detectMotif(c, { depthCap: 11 })?.type).toBe('fork');
  });

  it('works for black mover', () => {
    const c = ctx(MOCKUP_BLACK, ['d4c2', 'e1d2', 'c2a1']);
    expect(c.mover).toBe('b');
    const m = detectMotif(c);
    expect(m?.type).toBe('fork');
    expect([...m!.targets].sort()).toEqual(['k@e1', 'r@a1']);
    expect(m!.piece).toBe('n@d4');
  });

  it('mate score whose pv does not end in mate is not called mate', () => {
    const fen = '2r3k1/5ppp/8/8/8/8/3R1PPP/3R2K1 w - - 0 1';
    expect(detectMotif(ctx(fen, ['d2d8', 'c8d8'], { mate: 2 }))).toBeNull();
  });

  describe('net gain and even recaptures (real game, user White, ply 23)', () => {
    // 12. Nxg6 (takes the g6 bishop) hxg6: Black only takes back. The engine's line later opens the
    // h-file and trades rooks (... h5xg6 Rxh1 Rxh1), which used to read as "Pin: your pawn can't move
    // without losing the rook".
    const BEFORE = 'rn2k2r/pp3ppp/1qpbp1b1/4N1B1/3P4/8/PPP1Q1PP/2KR1B1R w kq - 2 12';
    const AFTER = 'rn2k2r/pp3ppp/1qpbp1N1/6B1/3P4/8/PPP1Q1PP/2KR1B1R b kq - 0 12';
    const PV = ['h7g6', 'c1b1', 'b8d7', 'h2h4', 'd6e7', 'g5e7', 'e8e7', 'e2e3', 'd7f6', 'f1e2', 'a8d8', 'g2g4',
      'd8d7', 'h4h5', 'e7d8', 'h5g6', 'h8h1', 'd1h1', 'b6d4', 'e3d4', 'd7d4', 'g6f7', 'd8e7', 'g4g5', 'f6e4'];

    it('the position and line are legal', () => {
      expect(replayLine(BEFORE, ['e5g6']).fens[1]).toBe(AFTER);
      expect(replayLine(AFTER, PV).sans).toHaveLength(PV.length);
    });

    it('a rook taken and immediately taken back is not a pin payoff', () => {
      const c = ctx(AFTER, PV, { cp: 0 }, 'e5g6');
      const line = prepareLine(c, 9)!;
      expect(line.gain).toBe(2); // counted from after Nxg6, the recapture looks like winning material...
      expect(detectPin(c, line)).toBeNull(); // ...but Rxh1 Rxh1 is an even trade, not the pin paying off
    });

    it('counting from before the user\'s move, taking back is not winning material', () => {
      const c: LineContext = { ...ctx(AFTER, PV, { cp: 0 }, 'e5g6'), gainFrom: BEFORE };
      expect(prepareLine(c, 9)!.gain).toBe(-1);
      expect(detectMotif(c)).toBeNull();
    });

    it('a pin whose payoff capture is not taken back still counts', () => {
      // Same line cut before White's Rxh1: Black's Rxh1 wins the rook.
      const c = ctx(AFTER, PV.slice(0, 17), { cp: 0 }, 'e5g6');
      expect(detectPin(c, prepareLine(c, 9)!)?.type).toBe('pin');
    });
  });

  it('defended "could win" needs a net gain of 2 from the base position', () => {
    // 1. Nxb4 (wins the rook) dxe4 fxe4: Black wins the defended bishop, but White is still up.
    const before = '6k1/8/8/3p4/1r2B3/5P2/2N3PP/7K w - - 0 1';
    const after = replayLine(before, ['c2b4']).fens[1];
    const pv = ['d5e4', 'f3e4'];
    expect(detectMotif(ctx(after, pv))).toMatchObject({ type: 'hanging-piece', defended: true }); // from after Nxb4: +2
    expect(detectMotif({ ...ctx(after, pv), gainFrom: before })).toBeNull(); // net: -3
  });
});
