import { describe, expect, it } from 'vitest';
import { buildReport } from '../../src/patterns/buildReport';
import { FLAG_DROP } from '../../src/analysis/winprob';
import type { GameAnalysis, GameRecord, MistakeType, Moment, MoveEval, Phase, TimeClass } from '../../src/types';

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function game(id: string, o: Partial<GameRecord> & { clock?: number | null } = {}): GameRecord {
  const { clock, ...rest } = o;
  return {
    id, headers: {}, white: 'me', black: 'foe', userColor: 'w', result: '0-1', userResult: 'loss',
    timeClass: 'rapid' as TimeClass, baseTimeSec: 600,
    opening: { eco: 'C50', name: 'Italian Game', family: 'Italian Game' },
    plies: [{ ply: 1, san: 'e4', uci: 'e2e4', fenBefore: FEN, fenAfter: FEN, color: 'w', clockSec: clock ?? null }],
    date: null, url: null, ...rest,
  };
}
function moment(ply: number, o: Partial<Moment> = {}): Moment {
  return {
    ply, playedSan: 'x', fenBefore: `fen${ply} w - -`, winBefore: 60, winAfter: 30, drop: 30,
    mistakeType: 'hung-piece' as MistakeType, better: null, punishment: null, punished: true, explanation: '',
    phase: 'middlegame' as Phase, lowClock: false, pieceInvolved: null, trigger: 'swing' as const, materialLost: 0, ...o,
  };
}
function mv(ply: number, winBefore: number, winAfter: number): MoveEval {
  return { ply, san: 'x', byUser: true, winBefore, winAfter, drop: Math.max(0, winBefore - winAfter), label: 'good' };
}
function analysis(gameId: string, moments: Moment[], moves: MoveEval[] = []): GameAnalysis {
  // unique positions per game unless a test sets fenBefore explicitly
  const ms = moments.map((m) => (m.fenBefore.startsWith('fen') ? { ...m, fenBefore: `${gameId}-${m.fenBefore}` } : m));
  return { gameId, analysisVersion: 1, moves, moments: ms };
}
const better = (userMoves: number) => ({ uci: [], san: [], stepNotes: [], motif: null, summary: '', userMoves });

describe('buildReport', () => {
  it('ranks by cost not count', () => {
    const games = [game('a'), game('b')];
    const an = [
      analysis('a', [moment(1, { mistakeType: 'hung-piece', drop: 5 }), moment(3, { mistakeType: 'hung-piece', drop: 5 }), moment(5, { mistakeType: 'missed-mate', drop: 60 })]),
      analysis('b', [moment(1, { mistakeType: 'hung-piece', drop: 5 }), moment(5, { mistakeType: 'missed-mate', drop: 60 })]),
    ];
    const r = buildReport(games, an, 'all');
    expect(r.weaknesses.map((w) => w.key)).toEqual(['type:missed-mate', 'type:hung-piece']);
    expect(r.weaknesses[0].count).toBe(2);
    expect(r.weaknesses[0].title).toBe('Missed checkmates');
  });

  it('decided only when no recovery above 50', () => {
    const games = [game('a'), game('b')];
    const big = moment(4, { drop: 50, winBefore: 60, winAfter: 10 });
    const an = [
      analysis('a', [moment(2, { drop: 10 }), big], [mv(4, 60, 10), mv(6, 12, 8)]),
      analysis('b', [moment(2, { drop: 10 }), { ...big }], [mv(4, 60, 10), mv(6, 12, 70)]),
    ];
    const w = buildReport(games, an, 'all').weaknesses.find((x) => x.key === 'type:hung-piece')!;
    expect(w.gamesDecided).toBe(1);
    expect(w.summary).toContain('decided 1 of your losses');
  });

  it('material moments cost min(FLAG_DROP - 1, 4 x materialLost) and rank below swings', () => {
    const games = [game('a'), game('b')];
    const mat = (ply: number, lost: number) => moment(ply, { trigger: 'material', drop: 1, winBefore: 98, winAfter: 97, materialLost: lost, mistakeType: 'hung-piece' });
    const an = [
      analysis('a', [mat(1, 9), mat(3, 1), moment(5, { mistakeType: 'missed-fork', drop: FLAG_DROP })]),
      analysis('b', [moment(5, { mistakeType: 'missed-fork', drop: FLAG_DROP })]),
    ];
    const r = buildReport(games, an, 'all');
    const hung = r.weaknesses.find((w) => w.key === 'type:hung-piece')!;
    expect(hung.cost).toBeCloseTo((FLAG_DROP - 1) + 4, 6); // queen capped at FLAG_DROP-1, pawn = 4
    expect(r.weaknesses.map((w) => w.key)).toEqual(['type:missed-fork', 'type:hung-piece']);
  });

  it('a material moment never "decides" a game, even with the biggest drop', () => {
    const games = [game('a'), game('b')];
    const swing = moment(2, { drop: 20, winBefore: 55, winAfter: 35 });
    const mat = moment(4, { trigger: 'material', mistakeType: 'walked-into-tactic', drop: 50, winBefore: 30, winAfter: 5, materialLost: 3 });
    const moves = [mv(2, 55, 35), mv(4, 30, 5)];
    const an = [analysis('a', [swing, mat], moves), analysis('b', [{ ...swing }, { ...mat }], moves)];
    const r = buildReport(games, an, 'all');
    expect(r.weaknesses.find((x) => x.key === 'type:hung-piece')!.gamesDecided).toBe(2);
    expect(r.weaknesses.find((x) => x.key === 'type:walked-into-tactic')!.gamesDecided).toBe(0);
  });

  it('count 1 types excluded, unexplained excluded', () => {
    const an = [analysis('a', [moment(1, { mistakeType: 'missed-fork' }), moment(3, { mistakeType: 'unexplained' }), moment(5, { mistakeType: 'unexplained' })])];
    expect(buildReport([game('a')], an, 'all').weaknesses).toEqual([]);
  });

  it('same-position repeat detected across 2 games', () => {
    const games = [game('a'), game('b')];
    const same = { fenBefore: 'pos w KQkq -', mistakeType: 'missed-fork' as MistakeType };
    const an = [analysis('a', [moment(7, same)]), analysis('b', [moment(9, same)])];
    const r = buildReport(games, an, 'all');
    const w = r.weaknesses.find((x) => x.key === 'pos:pos w KQkq -')!;
    expect(w.kind).toBe('repeated-situation');
    expect(w.title).toBe('Same position, same mistake (Italian Game as White)');
    expect(w.summary).toBe('You reached this position in 2 games and made the same kind of mistake each time.');
    expect(r.weaknesses.some((x) => x.key === 'type:missed-fork')).toBe(true);
  });

  it('opening-family repeat needs 3 games', () => {
    const op = (ply: number) => moment(ply, { phase: 'opening', mistakeType: 'hung-piece', fenBefore: `u${ply} w - -` });
    const games = [game('a'), game('b'), game('c'), game('d', { opening: { eco: null, name: 'x', family: 'Other' } })];
    const mk = (id: string, ply: number) => analysis(id, [op(ply)]);
    const two = buildReport(games, [mk('a', 1), mk('b', 3), mk('d', 5)], 'all');
    expect(two.weaknesses.some((w) => w.key.startsWith('open:'))).toBe(false);
    const three = buildReport(games, [mk('a', 1), mk('b', 3), mk('c', 5), mk('d', 7)], 'all');
    const w = three.weaknesses.find((x) => x.key === 'open:Italian Game:w:hung-piece')!;
    expect(w.title).toBe('Italian Game as White');
    expect(w.summary).toBe('You played it 3 times. In 3 of them: leaving pieces hanging.');
  });

  it("filter 'bullet' excludes rapid games", () => {
    const games = [game('a', { timeClass: 'bullet' }), game('b')];
    const an = [analysis('a', [moment(1)]), analysis('b', [moment(1)])];
    const r = buildReport(games, an, 'bullet', 2);
    expect(r.gamesAnalysed).toBe(1);
    expect(r.skippedCount).toBe(2);
    expect(r.byPhase.middlegame.count).toBe(1);
  });

  it('timeTrouble null without clocks', () => {
    const an = [analysis('a', [moment(1, { lowClock: true })])];
    expect(buildReport([game('a')], an, 'all').timeTrouble).toBeNull();
    const t = buildReport([game('a', { clock: 30 })], an, 'all').timeTrouble;
    expect(t).toEqual({ count: 1, cost: 30 });
  });

  it('byPhase counts', () => {
    const an = [analysis('a', [moment(1, { phase: 'opening', drop: 10 }), moment(3, { phase: 'endgame', drop: 20, better: better(3) }), moment(5, { phase: 'endgame', drop: 10 })])];
    const r = buildReport([game('a')], an, 'all');
    expect(r.byPhase.opening).toEqual({ count: 1, cost: 10 });
    expect(r.byPhase.endgame.count).toBe(2);
    expect(r.byPhase.endgame.cost).toBeCloseTo(20 / 1.3 + 10);
    expect(r.byPhase.middlegame).toEqual({ count: 0, cost: 0 });
    expect(r.byOpening).toEqual([{ family: 'Italian Game', color: 'w', games: 1, wins: 0, losses: 1, draws: 0, moments: 3 }]);
  });

  it('byPhase and byOpening do not count unexplained moments (they appear on no card)', () => {
    const an = [analysis('a', [
      moment(1, { phase: 'opening', drop: 10 }),
      moment(3, { phase: 'opening', drop: 20, mistakeType: 'unexplained' }),
      moment(5, { phase: 'endgame', drop: 15, mistakeType: 'unexplained' }),
    ])];
    const r = buildReport([game('a')], an, 'all');
    expect(r.byPhase.opening).toEqual({ count: 1, cost: 10 });
    expect(r.byPhase.endgame).toEqual({ count: 0, cost: 0 });
    expect(r.byOpening[0].moments).toBe(1);
  });

  it('summary mentions dominant piece', () => {
    const an = [analysis('a', [moment(1, { pieceInvolved: 'n@d5' }), moment(3, { pieceInvolved: 'n@e4' })])];
    const w = buildReport([game('a', { userResult: 'draw' })], an, 'all').weaknesses[0];
    expect(w.summary).toBe('Happened 2 times · mostly in the middlegame · usually with your knight');
  });

  it('same position with different mistake types is not a repeat', () => {
    const fenBefore = 'pos w KQkq -';
    const an = [
      analysis('a', [moment(7, { fenBefore, mistakeType: 'missed-fork' })]),
      analysis('b', [moment(9, { fenBefore, mistakeType: 'hung-piece' })]),
      analysis('c', [moment(9, { fenBefore, mistakeType: 'unexplained' }), moment(11, { fenBefore: 'q w - -', mistakeType: 'unexplained' })]),
    ];
    const r = buildReport([game('a'), game('b'), game('c')], an, 'all');
    expect(r.weaknesses.some((w) => w.key.startsWith('pos:'))).toBe(false);
  });

  it('same-position summary counts games that reached it', () => {
    const fenBefore = 'pos w KQkq -';
    const withPos = (id: string) => game(id, {
      plies: [{ ply: 7, san: 'e4', uci: 'e2e4', fenBefore: `${fenBefore} 0 1`, fenAfter: FEN, color: 'w', clockSec: null }],
    });
    const m = (ply: number) => moment(ply, { fenBefore: `${fenBefore} 0 1`, mistakeType: 'missed-fork' });
    const all = buildReport([withPos('a'), withPos('b')], [analysis('a', [m(7)]), analysis('b', [m(7)])], 'all');
    expect(all.weaknesses.find((w) => w.key.startsWith('pos:'))!.summary)
      .toBe('You reached this position in 2 games and made the same kind of mistake each time.');
    const more = buildReport([withPos('a'), withPos('b'), withPos('c')],
      [analysis('a', [m(7)]), analysis('b', [m(7)]), analysis('c', [])], 'all');
    expect(more.weaknesses.find((w) => w.key.startsWith('pos:'))!.summary)
      .toBe('You reached this position in 3 games and made the same kind of mistake in 2 of them.');
  });

  it('piece must cover over half of all moments', () => {
    const an = [analysis('a', [moment(1, { pieceInvolved: 'n@d5' }), moment(3), moment(5)])];
    const w = buildReport([game('a', { userResult: 'draw' })], an, 'all').weaknesses[0];
    expect(w.summary).not.toContain('usually');
  });
});
