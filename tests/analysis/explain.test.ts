import { describe, it, expect } from 'vitest';
import { describeStep, summarizeMotif, momentExplanation, calmSummary } from '../../src/analysis/explain';
import type { GameRecord, Moment, Motif, MoveEval } from '../../src/types';

const FORK_FEN = 'r3k2r/pp3ppp/8/3N4/8/8/PPP2PPP/R3K2R w - - 0 1';
const fork: Motif = { type: 'fork', keySquares: ['c7', 'e8', 'a8'], targets: ['k@e8', 'r@a8'], piece: 'n@d5' };
const game = { userColor: 'w' } as GameRecord;
const baseMoment: Moment = {
  ply: 1, playedSan: 'h3', fenBefore: FORK_FEN, winBefore: 70, winAfter: 40, drop: 30,
  mistakeType: 'missed-fork', better: null, punishment: null, punished: true, explanation: '',
  phase: 'middlegame', lowClock: false, pieceInvolved: null, trigger: 'swing', materialLost: 0,
};
const line = (san: string[], motif: Motif | null) => ({ uci: [], san, stepNotes: [], motif, summary: '', userMoves: 1 });

describe('describeStep', () => {
  it('mockup fork: check and a second attacker', () => {
    expect(describeStep(FORK_FEN, 'd5c7', 'w')).toBe('check, attacks the rook too');
  });
  it('follow-ups: king has to move, then takes his rook', () => {
    const afterFork = 'r3k2r/ppN2ppp/8/8/8/8/PPP2PPP/R3K2R b - - 1 1';
    expect(describeStep(afterFork, 'e8d7', 'w')).toBe('king has to move');
    const afterKd7 = 'r6r/ppNk1ppp/8/8/8/8/PPP2PPP/R3K2R w - - 2 2';
    expect(describeStep(afterKd7, 'c7a8', 'w')).toBe('takes his rook');
  });
  it('swaps pronouns for the opponent and handles promotion', () => {
    expect(describeStep('4k3/8/8/8/8/8/3q4/3RK3 b - - 0 1', 'd2d1', 'w')).toBe('check, takes your rook');
    expect(describeStep('8/P7/8/8/8/8/7k/4K3 w - - 0 1', 'a7a8q', 'w')).toBe('promotes');
  });
  it('never throws on junk', () => {
    expect(describeStep('garbage', 'zz', 'w')).toBe('');
    expect(describeStep(FORK_FEN, 'a1a8', 'w')).toBe('');
  });
});

describe('summarizeMotif', () => {
  it('fork with names and pronouns', () => {
    expect(summarizeMotif(fork, 'w', 'w')).toBe('Knight fork: it hits his king and rook at the same time.');
    expect(summarizeMotif(fork, 'w', 'b')).toBe('Knight fork: it hits your king and rook at the same time.');
    expect(summarizeMotif({ ...fork, piece: 'q@d1', targets: ['q@a', 'r@b', 'b@c'] }, 'w', 'w'))
      .toBe('Queen fork: it hits his queen, rook and bishop at the same time.');
  });
  it('mate, pin, skewer, discovered, hanging', () => {
    expect(summarizeMotif({ type: 'mate', keySquares: [], targets: ['k@e8'], piece: 'q@d1', mateIn: 2 }, 'w', 'w')).toBe('Checkmate in 2.');
    expect(summarizeMotif({ type: 'pin', keySquares: [], targets: ['n@c6', 'q@d7'], piece: 'b@b5' }, 'w', 'w'))
      .toBe("Pin: his knight can't move without losing the queen.");
    // Pinned to the king (real game: Bb4 pins the c3 queen to e1): the piece can't legally move at all.
    expect(summarizeMotif({ type: 'pin', keySquares: [], targets: ['q@c3', 'k@e1'], piece: 'b@f8' }, 'w', 'b'))
      .toBe("Pin: your queen can't move off the line without exposing your king.");
    expect(summarizeMotif({ type: 'pin', keySquares: [], targets: ['q@c6', 'k@e8'], piece: 'b@b5' }, 'w', 'w'))
      .toBe("Pin: his queen can't move off the line without exposing his king.");
    expect(summarizeMotif({ type: 'skewer', keySquares: [], targets: ['q@c6', 'r@d7'], piece: 'b@b5' }, 'w', 'w'))
      .toBe('Skewer: his queen has to move and the rook behind it falls.');
    expect(summarizeMotif({ type: 'discovered-attack', keySquares: [], targets: ['q@d8'], piece: 'n@e5' }, 'w', 'w'))
      .toBe('Discovered attack: moving the knight uncovers an attack on his queen.');
    const h: Motif = { type: 'hanging-piece', keySquares: ['e4'], targets: ['n@e4'], piece: 'p@d3' };
    expect(summarizeMotif(h, 'w', 'w')).toBe('His knight on e4 was free to take.');
    expect(summarizeMotif({ ...h, recapture: true }, 'w', 'w')).toBe('Take back: his knight on e4 was free to take.');
    expect(summarizeMotif(h, 'w', 'b')).toBe('Your knight on e4 was free to take.');
  });
  it('defended hanging piece not worth more than the capturer drops the "worth more" clause', () => {
    const h: Motif = { type: 'hanging-piece', keySquares: ['d6'], targets: ['r@d6'], piece: 'q@d1', defended: true };
    expect(summarizeMotif(h, 'b', 'b')).toBe('You could win his rook on d6.');
    expect(summarizeMotif(h, 'b', 'w')).toBe('He could win your rook on d6.');
    expect(summarizeMotif({ ...h, targets: ['n@d6'], piece: 'b@d1' }, 'w', 'w')).toBe('You could win his knight on d6.');
  });

  it('hanging piece that was defended is a trade up, not "free"', () => {
    const h: Motif = { type: 'hanging-piece', keySquares: ['d6'], targets: ['q@d6'], piece: 'r@d1', defended: true };
    expect(summarizeMotif(h, 'b', 'b')).toBe("You could win his queen on d6: it's worth more than the rook that takes it.");
    expect(summarizeMotif(h, 'b', 'w')).toBe("He could win your queen on d6: it's worth more than the rook that takes it.");
    expect(summarizeMotif({ ...h, recapture: true }, 'b', 'b')).toBe('Take back: you could win his queen on d6.');
    expect(summarizeMotif({ ...h, recapture: true }, 'b', 'w')).toBe('Take back: he could win your queen on d6.');
    expect(summarizeMotif({ ...h, defended: false }, 'b', 'b')).toBe('His queen on d6 was free to take.');
  });
  it('positional motifs', () => {
    const of: Motif = { type: 'open-file', keySquares: ['d1'], targets: [], piece: 'r@a1' };
    expect(summarizeMotif(of, 'w', 'w')).toBe('Puts your rook on the open d-file.');
    expect(summarizeMotif({ ...of, piece: 'q@a1' }, 'w', 'w')).toBe('Puts your queen on the open d-file.');
    expect(summarizeMotif({ ...of, targets: ['p@d6'] }, 'w', 'w')).toBe('Puts your rook on the half-open d-file, aiming at his weak pawn.');
    expect(summarizeMotif({ ...of, keySquares: ['d1', 'd6'] }, 'w', 'w')).toBe('Puts your rook on the half-open d-file, toward his king.');
    expect(summarizeMotif({ ...of, keySquares: ['d1', 'd6'] }, 'w', 'b')).toBe('Puts his rook on the half-open d-file, toward your king.');
    const pb: Motif = { type: 'pawn-break', keySquares: [], targets: [], piece: 'p@g2', subtype: 'king-attack' };
    expect(summarizeMotif(pb, 'w', 'w')).toBe('Pawn break that opens up his king.');
    expect(summarizeMotif({ ...pb, subtype: 'opens-file' }, 'w', 'w')).toBe('Pawn break that opens a file for your rook.');
    expect(summarizeMotif({ type: 'winning-trade', keySquares: [], targets: [], piece: 'q@d1' }, 'w', 'w')).toBe("Trades into an endgame you're winning.");
    expect(summarizeMotif({ type: 'stops-threat', keySquares: [], targets: [], piece: 'q@d1' }, 'w', 'w')).toBe('Stops his threat before it happens.');
  });
  it('falls back when the motif is null', () => {
    expect(summarizeMotif(null, 'w', 'w')).toBe('This wins material.');
  });
});

describe('momentExplanation', () => {
  it('material moments in a decided game add the habit line; swings and undecided ones do not', () => {
    const HABIT = 'The game was already decided, but this is a habit worth fixing.';
    const mat = { ...baseMoment, trigger: 'material' as const, materialLost: 3, winAfter: 95 };
    expect(momentExplanation({ ...mat, winBefore: 97 }, game)).toMatch(new RegExp(`${HABIT}$`));
    expect(momentExplanation({ ...mat, winBefore: 4, winAfter: 2 }, game)).toContain(HABIT);
    expect(momentExplanation({ ...mat, winBefore: 60 }, game)).not.toContain(HABIT);
    expect(momentExplanation({ ...baseMoment, winBefore: 97 }, game)).not.toContain(HABIT);
  });
  it('names the move, the better line and the not-punished sentence', () => {
    const text = momentExplanation({ ...baseMoment, punished: false, better: line(['Nc7+'], fork) }, game);
    expect(text).toContain('You played h3.');
    expect(text).toContain('Better was Nc7+. Knight fork: it hits his king and rook at the same time.');
    expect(text).toContain("He didn't take advantage, but next time someone will.");
  });
  it('punishment uses your/his from the opponent side and omits the sentence when punished', () => {
    const text = momentExplanation({ ...baseMoment, mistakeType: 'walked-into-tactic', punishment: { ...line(['Nc3'], fork), uci: ['b1c3'] } }, { userColor: 'w', plies: [{ uci: 'h2h3' }, { uci: 'b1c3' }] } as unknown as GameRecord);
    expect(text).toContain('He answered with Nc3. Knight fork: it hits your king and rook at the same time.');
    expect(text).not.toContain('next time');
  });
  it('ignored-threat names the attacked piece', () => {
    // Black bishop on b4 attacks nothing hanging; use a hanging white knight on e4 attacked by a pawn on d5.
    const fen = '4k3/8/8/3p4/4N3/8/8/4K3 w - - 0 1';
    const text = momentExplanation({ ...baseMoment, fenBefore: fen, mistakeType: 'ignored-threat', playedSan: 'Kd2', pieceInvolved: 'n@e4',
      punishment: { ...line(['dxe4'], null), uci: ['d5e4'] } }, game);
    expect(text).toContain('His last move attacked your knight on e4');
    // pieceInvolved is what names it; without it, or if the capture is elsewhere, stay generic
    const named = { ...baseMoment, fenBefore: fen, mistakeType: 'ignored-threat' as const, pieceInvolved: 'n@e4',
      punishment: { ...line(['dxe4'], null), uci: ['d5e4'] } };
    expect(momentExplanation(named, game)).toContain('His last move attacked your knight on e4, and you left it there.');
    const generic = 'His last move made a threat, and you left it there.';
    expect(momentExplanation({ ...named, punishment: { ...named.punishment, uci: ['d5c4'] } }, game)).toContain(generic);
    expect(momentExplanation({ ...named, pieceInvolved: null }, game)).toContain(generic);
  });
  it('tense, advantage wording and a Black user', () => {
    const blk = { userColor: 'b', plies: [{ uci: 'x' }, { uci: 'b1c3' }] } as unknown as GameRecord;
    const pun = { ...line(['Nc3'], fork), uci: ['b1c3'] };
    expect(momentExplanation({ ...baseMoment, ply: 1, punishment: pun }, blk)).toContain('He answered with Nc3. Knight fork: it hits your king and rook');
    expect(momentExplanation({ ...baseMoment, punishment: pun, punished: false }, blk)).toContain('He can answer with Nc3.');
    expect(momentExplanation({ ...baseMoment, winBefore: 70 }, game)).toContain('That gave away much of your advantage.');
    expect(momentExplanation({ ...baseMoment, winBefore: 45 }, game)).toContain('That made your position much worse.');
  });
  it('only says "answered" when he really played the punishment; otherwise "could have answered"', () => {
    const pun = { ...line(['Qxd1'], fork), uci: ['d6d1'] };
    const withNext = (uci: string) => ({ userColor: 'w', plies: [{ uci: 'h2h3' }, { uci }] }) as unknown as GameRecord;
    const m = { ...baseMoment, ply: 1, punishment: pun };
    expect(momentExplanation(m, withNext('d6d1'))).toContain('He answered with Qxd1.');
    const other = momentExplanation(m, withNext('e6e8'));
    expect(other).toContain('He could have answered with Qxd1.');
    expect(other).not.toContain('He answered');
    expect(momentExplanation(m, game)).toContain('He could have answered with Qxd1.'); // no next ply known
    expect(momentExplanation({ ...m, punished: false }, withNext('d6d1'))).toContain('He can answer with Qxd1.');
  });
  it('uses fallbacks when lines have no motif or are missing', () => {
    const t = momentExplanation({ ...baseMoment, better: line(['Qd8'], null), punishment: line([], null) }, game);
    expect(t).toContain('This was much stronger.');
    expect(t).toContain('This wins material.');
    expect(momentExplanation({ ...baseMoment }, game)).toContain('You played h3.');
  });
});

describe('calmSummary', () => {
  const mv = (ply: number, label: MoveEval['label']): MoveEval => ({ ply, san: 'x', byUser: true, winBefore: 50, winAfter: 50, drop: 0, label });
  it('solid vs mostly fine', () => {
    expect(calmSummary([mv(5, 'good'), mv(7, 'good')], 5, 18)).toBe('Moves 3–9: solid.');
    expect(calmSummary([mv(5, 'good'), mv(7, 'inaccuracy')], 5, 18)).toBe('Moves 3–9: mostly fine.');
    expect(calmSummary([mv(30, 'blunder')], 5, 18)).toBe('Moves 3–9: solid.');
  });
});

describe('no engine numbers or junk leak into copy', () => {
  it('is clean across motifs and malformed input', () => {
    const types = ['fork', 'mate', 'pin', 'skewer', 'discovered-attack', 'hanging-piece', 'open-file', 'pawn-break', 'winning-trade', 'stops-threat', 'bogus'];
    const outs: string[] = [];
    for (const type of types) {
      for (const m of [{ type, keySquares: [], targets: [], piece: '' }, { type, keySquares: ['e4'], targets: ['n@e4', 'r@a1'], piece: 'q@d1', mateIn: 3 }]) {
        outs.push(summarizeMotif(m as Motif, 'b', 'w'), summarizeMotif(m as Motif, 'b', 'b'));
        outs.push(momentExplanation({ ...baseMoment, punishment: line([], m as Motif), better: line([], m as Motif), punished: false }, { userColor: null } as GameRecord));
      }
    }
    outs.push(summarizeMotif(undefined, 'w', 'w'), momentExplanation({ ...baseMoment, playedSan: '', fenBefore: 'junk', mistakeType: 'ignored-threat' }, game));
    outs.push(calmSummary([], 1, 2), describeStep(FORK_FEN, 'd5c7', 'b'));
    for (const o of outs) {
      expect(o).not.toMatch(/undefined|NaN|null|\bcp\b|\d\s*cp|[+\-−]\d/);
    }
  });
});
