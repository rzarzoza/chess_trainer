import { describe, it, expect } from 'vitest';
import { materialBalance, phaseOf, isHanging, attackedTargets, replayLine, nullMoveFen, nonPawnMaterial } from '../../src/chess/board';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('board helpers', () => {
  it('start position balance is 0', () => {
    expect(materialBalance(START, 'w')).toBe(0);
  });
  it('balance is signed by pov', () => {
    const fen = '4k3/8/8/8/8/8/4P3/3QK3 w - - 0 1';
    expect(materialBalance(fen, 'w')).toBe(10);
    expect(materialBalance(fen, 'b')).toBe(-10);
  });
  it('nonPawnMaterial counts both sides without kings', () => {
    expect(nonPawnMaterial(START)).toBe(62);
  });
  it('endgame FEN gives endgame', () => {
    expect(phaseOf('4k3/8/8/8/8/8/4P3/3RK3 w - - 0 40', 80)).toBe('endgame');
  });
  it('ply 10 in start position is opening', () => {
    expect(phaseOf(START, 10)).toBe('opening');
  });
  it('late ply with material is middlegame', () => {
    expect(phaseOf(START, 30)).toBe('middlegame');
  });
  it('undefended knight attacked by a pawn is hanging', () => {
    expect(isHanging('4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1', 'd5')).toBe(true);
  });
  it('defended rook attacked by a queen is not hanging', () => {
    expect(isHanging('4k3/8/4p3/3r4/8/8/8/3QK3 w - - 0 1', 'd5')).toBe(false);
  });
  it('defended rook attacked by a knight is hanging', () => {
    expect(isHanging('4k3/8/4p3/3r4/8/2N5/8/4K3 w - - 0 1', 'd5')).toBe(true);
  });
  it('empty square and king are not hanging', () => {
    const fen = '4k3/8/8/8/8/8/4r3/4K3 w - - 0 1';
    expect(isHanging(fen, 'a1')).toBe(false);
    expect(isHanging(fen, 'e1')).toBe(false);
  });
  it('attackedTargets lists enemy-occupied attacked squares only', () => {
    const fen = '4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1';
    expect(attackedTargets(fen, 'd1')).toEqual(['d5']);
  });
  it('replayLine gives Nc7+ for d5c7', () => {
    const fen = 'r3k2r/pp3ppp/8/3N4/8/8/PPP2PPP/R3K2R w - - 0 1';
    const r = replayLine(fen, ['d5c7']);
    expect(r.sans).toEqual(['Nc7+']);
    expect(r.fens[0]).toBe(fen);
    expect(r.fens).toHaveLength(2);
  });
  it('replayLine stops at an illegal move and handles promotion', () => {
    const r = replayLine(START, ['e2e4', 'e2e4', 'e7e5']);
    expect(r.sans).toEqual(['e4']);
    const p = replayLine('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', ['a7a8q']);
    expect(p.sans).toEqual(['a8=Q+']);
  });
  it('nullMoveFen flips side and clears en passant', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    expect(nullMoveFen(fen)).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1');
  });
  it('nullMoveFen returns null when in check', () => {
    expect(nullMoveFen('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1')).toBeNull();
  });
});
