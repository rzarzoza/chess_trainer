import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { analyzeGame } from '../../src/analysis/analyzeGame';
import { winPercentForColor } from '../../src/analysis/winprob';
import { createFakeEngine } from '../../src/engine/fakeEngine';
import { nullMoveFen, replayLine } from '../../src/chess/board';
import { detectMotif } from '../../src/detectors';
import { ANALYSIS_VERSION } from '../../src/types';
import type { Color, EngineLine, GameRecord, PlyRecord, Score } from '../../src/types';

// ── helpers ──────────────────────────────────────────────────────────────────

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FORK_FEN = 'r3k2r/pp3ppp/8/3N4/8/8/PPP2PPP/R3K2R w - - 0 1';

/** A GameRecord whose plies are replayed (and so verified legal) from `start`. */
function makeGame(start: string, moves: string[], userColor: Color | null,
  extra: { clocks?: (number | null)[]; baseTimeSec?: number | null } = {}): GameRecord {
  const { fens, sans } = replayLine(start, moves);
  expect(sans).toHaveLength(moves.length);
  const plies: PlyRecord[] = moves.map((uci, i) => ({
    ply: i + 1, san: sans[i], uci, fenBefore: fens[i], fenAfter: fens[i + 1],
    color: new Chess(fens[i]).turn() as Color, clockSec: extra.clocks?.[i] ?? null,
  }));
  return {
    id: 'g1', headers: {}, white: 'w', black: 'b', userColor, result: '*', userResult: null,
    timeClass: 'blitz', baseTimeSec: extra.baseTimeSec ?? null,
    opening: { eco: null, name: '', family: '' }, plies, date: null, url: null,
  };
}

const line = (score: Score, pv: string[] = [], multipv = 1): EngineLine => ({ multipv, score, pv, depth: 18 });

/** Fake engine: every position of the game (and its null-move twin) defaults to an even, empty line. */
function engineFor(game: GameRecord, overrides: Record<string, EngineLine[]> = {}) {
  const table: Record<string, EngineLine[]> = {};
  for (const p of game.plies) {
    for (const fen of [p.fenBefore, p.fenAfter, nullMoveFen(p.fenBefore)]) {
      if (fen) table[fen] = [line({ cp: 0 })];
    }
  }
  return createFakeEngine({ ...table, ...overrides });
}

const fenBefore = (g: GameRecord, ply: number) => g.plies[ply - 1].fenBefore;
const fenAfter = (g: GameRecord, ply: number) => g.plies[ply - 1].fenAfter;

// White, from the fork position: 1.h3 (misses Nc7+) a6 2.Ne3 b5
const whiteGame = (extra = {}) => makeGame(FORK_FEN, ['h2h3', 'a7a6', 'd5e3', 'b7b5'], 'w', extra);
const FORK_PV = ['d5c7', 'e8d7', 'c7a8'];

// Black: 1.e4 Nf6 2.Nc3 Ng4?? 3.Qxg4 e6
const blackGame = () => makeGame(START, ['e2e4', 'g8f6', 'b1c3', 'f6g4', 'd1g4', 'e7e6'], 'b');
// Black, unpunished: 1.e4 Nf6 2.Nc3 Ng4?? 3.h3 Nf6
const blackUnpunished = () => makeGame(START, ['e2e4', 'g8f6', 'b1c3', 'f6g4', 'h2h3', 'g4f6'], 'b');
const HUNG_SCRIPT = (g: GameRecord) => ({
  [fenBefore(g, 4)]: [line({ cp: 20 })], // Black to move: about 52% for Black
  [fenAfter(g, 4)]: [line({ cp: 500 }, ['d1g4', 'e7e6'])], // White to move, Qxg4 wins the knight
});

// ── tests ────────────────────────────────────────────────────────────────────

describe('analyzeGame', () => {
  it('flags a missed fork as White', async () => {
    const g = whiteGame();
    const engine = engineFor(g, { [FORK_FEN]: [line({ cp: 600 }, FORK_PV)] });
    const a = await analyzeGame(g, engine);
    expect(a.gameId).toBe('g1');
    expect(a.analysisVersion).toBe(ANALYSIS_VERSION);
    expect(a.moments).toHaveLength(1);
    const m = a.moments[0];
    expect(m).toMatchObject({ ply: 1, playedSan: 'h3', fenBefore: FORK_FEN, mistakeType: 'missed-fork', pieceInvolved: 'n@d5' });
    expect(m.better!.san[0]).toBe('Nc7+');
    expect(m.better!.stepNotes[0]).toBe('check, attacks the rook too');
    expect(m.better!.uci).toEqual(FORK_PV);
    expect(m.better!.userMoves).toBe(2);
    expect(m.better!.summary).toBe('Knight fork: it hits his rook and king at the same time.');
    expect(m.punishment).toBeNull(); // the engine's reply wins nothing, so nothing is claimed
    expect(m.explanation).toContain('Better was Nc7+. Knight fork');
  });

  it('opts.flagDrop overrides the flag threshold', async () => {
    const g = whiteGame();
    const engine = () => engineFor(g, { [FORK_FEN]: [line({ cp: 600 }, FORK_PV)] });
    // h3 drops about 40 win% (90 -> 50)
    expect((await analyzeGame(g, engine(), { flagDrop: 39 })).moments).toHaveLength(1);
    expect((await analyzeGame(g, engine(), { flagDrop: 41 })).moments).toHaveLength(0);
  });

  describe('material trigger (clear material blunders in decided games)', () => {
    // White is a queen and rook up; Rd5?? hangs the rook to the f6 knight.
    const WON = 'r5k1/5ppp/5n2/8/8/8/5PPP/1Q1RR1K1 w - - 0 1';
    const wonGame = () => makeGame(WON, ['d1d5', 'f6d5'], 'w');
    const script = (g: GameRecord, best: EngineLine[]) => ({
      [fenBefore(g, 1)]: best,
      [fenAfter(g, 1)]: [line({ cp: -1000 }, ['f6d5', 'g1f1'])], // Black still lost, but wins the rook
      [fenAfter(g, 2)]: [line({ cp: 900 })],
    });

    it('flags a hung rook although the win% hardly moves, ranked as material', async () => {
      const g = wonGame();
      const a = await analyzeGame(g, engineFor(g, script(g, [line({ cp: 1500 }, ['e1e7', 'h7h6'])])));
      expect(a.moments).toHaveLength(1);
      const m = a.moments[0];
      expect(m.drop).toBeLessThan(12);
      expect(m).toMatchObject({ trigger: 'material', materialLost: 5, mistakeType: 'hung-piece', punished: true, pieceInvolved: 'r@d5' });
      expect(m.punishment!.san[0]).toBe('Nxd5');
      expect(m.better!.san[0]).toBe('Re7');
      expect(m.explanation).toMatch(/The game was already decided, but this is a habit worth fixing\.$/);
    });

    it('is not flagged when the best line loses the same material (not avoidable)', async () => {
      const g = wonGame();
      const a = await analyzeGame(g, engineFor(g, script(g, [line({ cp: 1500 }, ['d1d5', 'f6d5'])])));
      expect(a.moments).toHaveLength(0);
    });

    it('is not flagged when the user is already being mated', async () => {
      const g = wonGame();
      const a = await analyzeGame(g, engineFor(g, script(g, [line({ mate: -3 }, ['e1e7', 'h7h6'])])));
      expect(a.moments).toHaveLength(0);
    });

    it('is not flagged when the material comes back later and so no punishment can be shown', async () => {
      const g = wonGame();
      // Nxd5 wins the rook, Qxd5 takes the knight back (net -2 at ply 6), then Qxa8+ wins a rook.
      const pv = ['f6d5', 'g2g3', 'd5f6', 'b1b3', 'f6d5', 'b3d5', 'h7h6', 'd5a8'];
      expect(replayLine(fenAfter(g, 1), pv).sans).toHaveLength(pv.length);
      const a = await analyzeGame(g, engineFor(g, {
        ...script(g, [line({ cp: 1500 }, ['e1e7', 'h7h6'])]),
        [fenAfter(g, 1)]: [line({ cp: -1000 }, pv)],
      }));
      expect(a.moments).toHaveLength(0);
    });

    it('drops a material moment that would be "unexplained" (no motif to show)', async () => {
      // Re3?: Nd5 hits the rook (defended by f2), Nxe3 fxe3 wins the exchange; no detector names it.
      const g = makeGame(WON, ['e1e3', 'f6d5'], 'w');
      const pv = ['f6d5', 'g2g3', 'd5e3', 'f2e3'];
      expect(replayLine(fenAfter(g, 1), pv).sans).toHaveLength(pv.length);
      const a = await analyzeGame(g, engineFor(g, {
        [fenBefore(g, 1)]: [line({ cp: 1500 }, ['e1e7', 'h7h6'])],
        [fenAfter(g, 1)]: [line({ cp: -1000 }, pv)],
      }));
      expect(a.moments).toHaveLength(0);
    });

    describe('material walked-into-mate', () => {
      // Black: ...Rd1+?? Rxd1 and Rd8# on the back rank.
      const FEN = '6k1/p4ppp/8/8/8/8/3r1PPP/2R3K1 b - - 0 1';
      const run = (cp: number) => {
        const g = makeGame(FEN, ['d2d1', 'c1d1'], 'b');
        const pv = ['c1d1', 'a7a6', 'd1d8'];
        expect(replayLine(fenAfter(g, 1), pv).sans.at(-1)).toBe('Rd8#');
        return analyzeGame(g, engineFor(g, {
          [fenBefore(g, 1)]: [line({ cp }, ['d2a2', 'g1f1'])],
          [fenAfter(g, 1)]: [line({ mate: 2 }, pv)],
        }));
      };
      it('is dropped when the game was already lost (winBefore <= 10)', async () => {
        expect((await run(-1000)).moments).toHaveLength(0);
      });
      it('a swing into mate from a playable position is still flagged', async () => {
        const a = await run(-300);
        expect(a.moments).toHaveLength(1);
        expect(a.moments[0]).toMatchObject({ trigger: 'swing', mistakeType: 'walked-into-mate' });
      });
    });

    it('a material moment with no motif for the better move says it kept your material', async () => {
      const g = wonGame();
      const a = await analyzeGame(g, engineFor(g, script(g, [line({ cp: 1500 }, ['e1e7', 'h7h6'])])));
      const m = a.moments[0];
      expect(m.better!.motif).toBeNull();
      expect(m.better!.summary).toBe('This kept your material.');
      expect(m.explanation).toContain('Better was Re7. This kept your material.');
      expect(m.explanation).not.toContain('much stronger');
    });

    it('a winning mating sacrifice is not a hung piece', async () => {
      // White, already winning: Qd8+!! Rxd8 Rxd8# gives up the queen for mate.
      const FEN = '2r3k1/5ppp/8/Q7/8/8/3R1PPP/6K1 w - - 0 1';
      const g = makeGame(FEN, ['a5d8', 'c8d8', 'd2d8'], 'w');
      expect(g.plies[2].san).toBe('Rxd8#');
      const a = await analyzeGame(g, engineFor(g, {
        [fenBefore(g, 1)]: [line({ cp: 900 }, ['g1f1', 'h7h6'])],
        [fenAfter(g, 1)]: [line({ mate: -1 }, ['c8d8', 'd2d8'])], // Black to move is mated
        [fenAfter(g, 2)]: [line({ mate: 1 }, ['d2d8'])],
      }));
      expect(a.moments).toHaveLength(0);
    });

    it('is classified only by what was lost: a missed fork alone does not make a material moment', async () => {
      // Lost anyway (Black's b-pawn is about to queen): Re3?? lets ...b1=Q+ through. Nc7+ (fork) was
      // better, but no punishment motif names the loss, so the moment is dropped rather than filed
      // as a missed fork.
      const FEN = 'r3k3/4pppp/8/3N4/8/8/1p3PPP/4R1K1 w - - 0 1';
      const g = makeGame(FEN, ['e1e3', 'b2b1q'], 'w');
      const punish = ['b2b1q', 'e3e1', 'b1e1'];
      expect(replayLine(fenAfter(g, 1), punish).sans).toHaveLength(3);
      const fork = ['d5c7', 'e8d8', 'c7a8'];
      expect(detectMotif({ fen: FEN, pv: fork, mover: 'w', score: { cp: -700 } })?.type).toBe('fork');
      const a = await analyzeGame(g, engineFor(g, {
        [fenBefore(g, 1)]: [line({ cp: -700 }, fork)],
        [fenAfter(g, 1)]: [line({ cp: 1000 }, punish)],
      }));
      expect(a.moments).toHaveLength(0);
    });

    it('swing moments are marked as swing', async () => {
      const g = blackGame();
      const a = await analyzeGame(g, engineFor(g, HUNG_SCRIPT(g)));
      expect(a.moments[0].trigger).toBe('swing');
      expect(a.moments[0].materialLost).toBeGreaterThanOrEqual(0);
    });
  });

  it('regression (real game, user White, ply 23): taking back on g6 is not a pin', async () => {
    // 12. Nxg6 hxg6: Black only takes the bishop back. The old copy said "He answered with hxg6.
    // Pin: your pawn can't move without losing the rook." (the "payoff" was a later even Rxh1 Rxh1).
    const FEN = 'rn2k2r/pp3ppp/1qpbp1b1/4N1B1/3P4/8/PPP1Q1PP/2KR1B1R w kq - 2 12';
    const g = makeGame(FEN, ['e5g6', 'h7g6'], 'w');
    const pv = ['h7g6', 'c1b1', 'b8d7', 'h2h4', 'd6e7', 'g5e7', 'e8e7', 'e2e3', 'd7f6', 'f1e2', 'a8d8', 'g2g4',
      'd8d7', 'h4h5', 'e7d8', 'h5g6', 'h8h1', 'd1h1', 'b6d4', 'e3d4', 'd7d4', 'g6f7', 'd8e7', 'g4g5', 'f6e4'];
    expect(replayLine(fenAfter(g, 1), pv).sans).toHaveLength(pv.length);
    const a = await analyzeGame(g, engineFor(g, {
      [fenBefore(g, 1)]: [line({ cp: 150 }, ['c1b1', 'b8d7'])], // scripted as a swing (about 75% -> 50%)
      [fenAfter(g, 1)]: [line({ cp: 2 }, pv)],
    }));
    for (const m of a.moments) {
      expect(m.punishment?.motif?.type).not.toBe('pin');
      expect(m.explanation).not.toMatch(/Pin|could win/);
    }
    expect(a.moments).toHaveLength(0); // nothing true to say about the punishment, and no motif for the better move
  });

  it('taking back after an even trade is not a punishment (Bxf6 gxf6)', async () => {
    const g = makeGame('6k1/5ppp/5n2/8/8/2B5/5PPP/6K1 w - - 0 1', ['c3f6', 'g7f6'], 'w');
    const a = await analyzeGame(g, engineFor(g, {
      [fenBefore(g, 1)]: [line({ cp: 0 }, ['g1f1', 'g8f8'])],
      [fenAfter(g, 1)]: [line({ cp: 600 }, ['g7f6', 'g1f1'])], // scripted as a big swing
    }));
    // No "free piece" claim and no fake "wins material": with nothing true to say, no moment.
    expect(a.moments).toHaveLength(0);
  });

  it('flags hung piece as Black', async () => {
    const g = blackGame();
    const a = await analyzeGame(g, engineFor(g, HUNG_SCRIPT(g)));
    expect(a.moments).toHaveLength(1);
    const m = a.moments[0];
    // pov b: +20 for Black to move is a little over 50%; +500 for White is bad for Black.
    expect(m.winBefore).toBeCloseTo(winPercentForColor({ cp: 20 }, 'b', 'b'), 6);
    expect(m.winBefore).toBeGreaterThan(50);
    expect(m.winAfter).toBeCloseTo(winPercentForColor({ cp: 500 }, 'w', 'b'), 6);
    expect(m).toMatchObject({ ply: 4, playedSan: 'Ng4', mistakeType: 'hung-piece', punished: true, pieceInvolved: 'n@g4' });
    expect(m.punishment!.san[0]).toBe('Qxg4');
    expect(m.punishment!.stepNotes[0]).toBe('takes your knight');
    expect(m.punishment!.summary).toBe('Your knight on g4 was free to take.');
    expect(m.explanation).toBe('You played Ng4. He answered with Qxg4. Your knight on g4 was free to take.');
  });

  it('deep engine-only refutation is not flagged', async () => {
    const g = whiteGame();
    const root = fenBefore(g, 3); // after 1.h3 a6, White to move
    const after = fenAfter(g, 3); // after 2.Ne3, Black to move
    const best = ['g2g3', 'g7g6'];
    // Kd7, Rhe8 pins the knight, ...f5-f4 and the knight only falls on Black's 5th move.
    const late = ['e8d7', 'a2a3', 'h8e8', 'b2b3', 'f7f5', 'c2c3', 'f5f4', 'e1d2', 'f4e3'];
    // Premise: both lines are legal and neither carries a motif.
    expect(replayLine(root, best).sans).toHaveLength(best.length);
    expect(replayLine(after, late).sans).toHaveLength(late.length);
    expect(detectMotif({ fen: root, pv: best, mover: 'w', score: { cp: 0 } }, { rootWin: 50 })).toBeNull();
    expect(detectMotif({ fen: after, pv: late, mover: 'b', score: { cp: 280 } })).toBeNull();

    const script = (cp: number) => ({ [root]: [line({ cp: 0 }, best)], [after]: [line({ cp }, late)] });
    const a = await analyzeGame(g, engineFor(g, script(280)));
    expect(a.moves[2].drop).toBeGreaterThan(20);
    expect(a.moves[2].drop).toBeLessThan(30);
    expect(a.moments).toHaveLength(0);
    // Even a drop over 40 stays unflagged: no material changes hands in his first 3 moves.
    const big = await analyzeGame(g, engineFor(g, script(700)));
    expect(big.moves[2].drop).toBeGreaterThanOrEqual(40);
    expect(big.moments).toHaveLength(0);
  });

  it('prefers simple explainable alternative', async () => {
    const g = whiteGame();
    const engine = engineFor(g, {
      [FORK_FEN]: [line({ cp: 650 }, ['g2g3', 'a7a6'], 1), line({ cp: 600 }, FORK_PV, 2)],
    });
    const a = await analyzeGame(g, engine);
    expect(a.moments).toHaveLength(1);
    expect(a.moments[0].better!.uci).toEqual(FORK_PV);
    expect(a.moments[0].mistakeType).toBe('missed-fork');
  });

  it('does not take a motif line that is more than 10% worse than the best', async () => {
    const g = whiteGame();
    const engine = engineFor(g, {
      [FORK_FEN]: [line({ mate: 3 }, ['g2g3', 'a7a6'], 1), line({ cp: 400 }, FORK_PV, 2)], // 100% vs ~81%
    });
    const a = await analyzeGame(g, engine);
    expect(a.moments).toHaveLength(0); // best line unexplained, fork line too far behind → not findable
  });

  it('trims a long shown line to its last commented ply, but never cuts a mate', async () => {
    const g = whiteGame();
    // Nc7+ Kd7 Nxa8 then quiet king/rook shuffles with nothing to say
    const long = [...FORK_PV, 'd7c8', 'a1b1', 'c8d7', 'b1a1', 'd7c8', 'a1b1'];
    const a = await analyzeGame(g, engineFor(g, { [fenBefore(g, 1)]: [line({ cp: 300 }, long), line({ cp: 0 }, [], 2), line({ cp: 0 }, [], 3)] }));
    const b = a.moments[0].better!;
    expect(b.uci.length).toBeLessThan(long.length);
    expect(b.stepNotes[b.stepNotes.length - 1]).not.toBe('');
    expect(b.uci).toHaveLength(b.san.length);
    expect(b.userMoves).toBe(Math.ceil(b.uci.length / 2));
    expect(b.uci.slice(0, 3)).toEqual(FORK_PV);
  });

  it('unpunished mistake', async () => {
    const g = blackUnpunished();
    const a = await analyzeGame(g, engineFor(g, HUNG_SCRIPT(g)));
    expect(a.moments).toHaveLength(1);
    const m = a.moments[0];
    expect(m.mistakeType).toBe('hung-piece');
    expect(m.punished).toBe(false); // he played h3, and after it Black is back to 50%
    expect(m.explanation).toContain('He can answer with Qxg4.');
    expect(m.explanation).toContain('next time someone will');
  });

  it('stays punished when the win% does not recover, even if he played something else', async () => {
    const g = blackUnpunished();
    const a = await analyzeGame(g, engineFor(g, { ...HUNG_SCRIPT(g), [fenAfter(g, 5)]: [line({ cp: -300 })] }));
    expect(a.moments[0].punished).toBe(true);
  });

  it('flags an ignored threat and names the threatened piece', async () => {
    // White: 1.e4 e5 2.Bc4 Nf6 3.d3 d5 (hits the bishop) 4.Nc3?? dxc4
    const g = makeGame(START, ['e2e4', 'e7e5', 'f1c4', 'g8f6', 'd2d3', 'd7d5', 'b1c3', 'd5c4'], 'w');
    const a = await analyzeGame(g, engineFor(g, {
      [fenBefore(g, 7)]: [line({ cp: 50 })],
      [fenAfter(g, 7)]: [line({ cp: 250 }, ['d5c4', 'd3c4'])],
    }));
    expect(a.moments).toHaveLength(1);
    const m = a.moments[0];
    expect(m).toMatchObject({ ply: 7, mistakeType: 'ignored-threat', pieceInvolved: 'b@c4', punished: true });
    expect(m.explanation).toContain('His last move attacked your bishop on c4, and you left it there.');
  });

  it('flags a missed fork as Black', async () => {
    const start = 'r3k2r/ppp2ppp/8/8/3n4/8/PP3PPP/R3K2R b - - 0 1'; // the fork position, colours swapped
    const g = makeGame(start, ['h7h6', 'a2a3'], 'b');
    const a = await analyzeGame(g, engineFor(g, { [start]: [line({ cp: 600 }, ['d4c2', 'e1d1', 'c2a1'])] }));
    expect(a.moments).toHaveLength(1);
    const m = a.moments[0];
    expect(m.winBefore).toBeCloseTo(winPercentForColor({ cp: 600 }, 'b', 'b'), 6);
    expect(m).toMatchObject({ ply: 1, mistakeType: 'missed-fork', pieceInvolved: 'n@d4' });
    expect(m.better!.san[0]).toBe('Nc2+');
    expect(m.better!.stepNotes[0]).toBe('check, attacks the rook too');
    expect(m.better!.summary).toContain('it hits his');
  });

  it('flags a missed stops-threat, using the null-move threat line', async () => {
    // Black's d4 knight threatens Nc2+ forking king and rook; Bd3 covers c2. White plays h3 instead.
    const start = '6k1/5ppp/8/4p3/3n4/8/PP3PPP/R3KB2 w - - 0 1';
    const g = makeGame(start, ['h2h3', 'd4c2', 'e1d1', 'c2a1'], 'w');
    const threat = line({ cp: 400 }, ['d4c2', 'e1d1', 'c2a1']);
    const script = {
      [start]: [line({ cp: 0 }, ['f1d3', 'g8f8'])],
      [fenAfter(g, 1)]: [line({ cp: 400 })], // no punishment line: only the better move explains it
    };
    const a = await analyzeGame(g, engineFor(g, { ...script, [nullMoveFen(start)!]: [threat] }));
    expect(a.moments).toHaveLength(1);
    expect(a.moments[0]).toMatchObject({ mistakeType: 'missed-positional', pieceInvolved: 'b@f1' });
    expect(a.moments[0].better!.uci[0]).toBe('f1d3');
    expect(a.moments[0].better!.motif!.type).toBe('stops-threat');
    // Without the threat line there is nothing to explain, so nothing is flagged.
    expect((await analyzeGame(g, engineFor(g, script))).moments).toHaveLength(0);
  });

  it('the played move is never offered as the better move', async () => {
    const g = whiteGame();
    const a = await analyzeGame(g, engineFor(g, {
      [FORK_FEN]: [line({ cp: 600 }, FORK_PV, 1), line({ cp: -100 }, ['h2h3', 'a7a6'], 2)],
    }));
    expect(a.moments).toHaveLength(1);
    expect(a.moments[0].better!.uci[0]).toBe('d5c7');
  });

  it('drops the candidate when the deep search rates the played move about as good as the best', async () => {
    // Quick eval says 1.Nc7+ dropped a lot; the deep MultiPV has Nc7+ as its top line.
    const g = makeGame(FORK_FEN, ['d5c7', 'e8d7'], 'w');
    const a = await analyzeGame(g, engineFor(g, {
      [FORK_FEN]: [line({ cp: 600 }, FORK_PV, 1), line({ cp: 50 }, ['g2g3', 'a7a6'], 2)],
      [fenAfter(g, 1)]: [line({ cp: 200 })],
    }));
    expect(a.moves[0].drop).toBeGreaterThanOrEqual(18);
    expect(a.moments).toHaveLength(0);
    expect(a.moves[0].label).not.toBe('blunder');
  });

  it('no ignored-threat when the user moved the attacked piece away', async () => {
    // ...b5 hits the c4 bishop, White plays Bd5, and ...Nc4 forks queen and rook.
    const start = '6k1/5ppp/pp6/4n3/2B5/4Q3/1R3PPP/2R3K1 b - - 0 1';
    const g = makeGame(start, ['b6b5', 'c4d5', 'e5c4'], 'w');
    const a = await analyzeGame(g, engineFor(g, {
      [fenBefore(g, 2)]: [line({ cp: 50 })],
      [fenAfter(g, 2)]: [line({ cp: 400 }, ['e5c4', 'e3e4', 'c4b2'])],
    }));
    expect(a.moments).toHaveLength(1);
    const m = a.moments[0];
    expect(m).toMatchObject({ ply: 2, mistakeType: 'walked-into-tactic', pieceInvolved: 'q@e3', punished: true });
    expect(m.explanation).not.toContain('you left it there');
  });

  it('ignored-threat still holds when the defence does not stop the piece from hanging', async () => {
    // 4.b3 defends the c4 bishop, but it is attacked by a pawn: still hanging, and dxc4 takes it.
    const g = makeGame(START, ['e2e4', 'e7e5', 'f1c4', 'g8f6', 'd2d3', 'd7d5', 'b2b3', 'd5c4'], 'w');
    const a = await analyzeGame(g, engineFor(g, {
      [fenBefore(g, 7)]: [line({ cp: 50 })],
      [fenAfter(g, 7)]: [line({ cp: 250 }, ['d5c4', 'b3c4'])],
    }));
    expect(a.moments).toHaveLength(1);
    expect(a.moments[0]).toMatchObject({ mistakeType: 'ignored-threat', pieceInvolved: 'b@c4' });
  });

  it("lost position doesn't spam", async () => {
    const g = whiteGame();
    const overrides: Record<string, EngineLine[]> = {};
    g.plies.forEach((p, i) => {
      overrides[p.fenBefore] = [line(p.color === 'w' ? { mate: -(6 - i) } : { mate: 6 - i }, [])];
    });
    overrides[fenAfter(g, 4)] = [line({ mate: -2 })];
    const a = await analyzeGame(g, engineFor(g, overrides));
    expect(a.moments).toHaveLength(0);
    for (const e of a.moves) {
      expect(Number.isFinite(e.winBefore) && Number.isFinite(e.winAfter) && Number.isFinite(e.drop)).toBe(true);
      expect(e.winBefore).toBeLessThan(10);
    }
  });

  it('lowClock is set from the clocks', async () => {
    const script = (g: GameRecord) => engineFor(g, { [FORK_FEN]: [line({ cp: 600 }, FORK_PV)] });
    const low = whiteGame({ clocks: [20, 170, 160, 150], baseTimeSec: 180 });
    expect((await analyzeGame(low, script(low))).moments[0].lowClock).toBe(true);
    const ok = whiteGame({ clocks: [30, 170, 160, 150], baseTimeSec: 180 });
    expect((await analyzeGame(ok, script(ok))).moments[0].lowClock).toBe(false);
    const noClock = whiteGame({ baseTimeSec: 180 });
    expect((await analyzeGame(noClock, script(noClock))).moments[0].lowClock).toBe(false);
    const noBase = whiteGame({ clocks: [5, 5, 5, 5] });
    expect((await analyzeGame(noBase, script(noBase))).moments[0].lowClock).toBe(false);
  });

  it('labels every move: user moves graded, opponent moves "opponent"', async () => {
    const g = blackGame();
    const a = await analyzeGame(g, engineFor(g, HUNG_SCRIPT(g)));
    expect(a.moves.map((e) => e.ply)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(a.moves.map((e) => e.byUser)).toEqual([false, true, false, true, false, true]);
    expect(a.moves.map((e) => e.label)).toEqual(['opponent', 'good', 'opponent', 'blunder', 'opponent', 'good']);
    expect(a.moves[3].san).toBe('Ng4');
  });

  it('reports pass-1 progress and passes the depths to the engine', async () => {
    const g = whiteGame();
    const inner = engineFor(g, { [FORK_FEN]: [line({ cp: 600 }, FORK_PV)] });
    const calls: { fen: string; depth: number; multiPv?: number }[] = [];
    const engine = { ...inner, analyse: (fen: string, o: { depth: number; multiPv?: number }) => (calls.push({ fen, ...o }), inner.analyse(fen, o)) };
    const progress: [number, number][] = [];
    await analyzeGame(g, engine, { quickDepth: 8, deepDepth: 14, onPly: (d, t) => progress.push([d, t]) });
    expect(progress).toEqual([[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]]);
    expect(calls.slice(0, 5).every((c) => c.depth === 8 && !c.multiPv)).toBe(true);
    expect(calls).toContainEqual({ fen: FORK_FEN, depth: 14, multiPv: 3 });
    expect(calls).toContainEqual({ fen: fenAfter(g, 1), depth: 14 });
  });

  it('throws when the user side is unknown', async () => {
    const g = makeGame(FORK_FEN, ['h2h3'], null);
    await expect(analyzeGame(g, engineFor(g))).rejects.toThrow();
  });
});
