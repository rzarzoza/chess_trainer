import { describe, it, expect } from 'vitest';
import { winPercentForColor, labelMove, INACCURACY_DROP, FLAG_DROP } from '../../src/analysis/winprob';

describe('winPercentForColor', () => {
  it('cp 0 is 50', () => expect(winPercentForColor({ cp: 0 }, 'w', 'w')).toBeCloseTo(50, 5));
  it('cp 300 for white, pov w ~75', () => expect(winPercentForColor({ cp: 300 }, 'w', 'w')).toBeCloseTo(75, 0));
  it('same score, pov b ~25', () => expect(winPercentForColor({ cp: 300 }, 'w', 'b')).toBeCloseTo(25, 0));
  it('mate for side to move is 100, being mated is 0', () => {
    expect(winPercentForColor({ mate: 3 }, 'w', 'w')).toBe(100);
    expect(winPercentForColor({ mate: -2 }, 'w', 'w')).toBe(0);
    expect(winPercentForColor({ mate: 0 }, 'b', 'b')).toBe(0);
    expect(winPercentForColor({ mate: 3 }, 'w', 'b')).toBe(0);
  });
  it('huge cp clamps, never NaN', () => {
    const hi = winPercentForColor({ cp: 1e9 }, 'w', 'w');
    expect(hi).toBe(winPercentForColor({ cp: 1000 }, 'w', 'w'));
    expect(Number.isNaN(winPercentForColor({ cp: NaN }, 'w', 'w'))).toBe(false);
    expect(winPercentForColor({ cp: -Infinity }, 'w', 'w')).toBeGreaterThanOrEqual(0);
  });
});

describe('labelMove', () => {
  it('thresholds', () => {
    expect(labelMove(INACCURACY_DROP - 0.1, false)).toBe('good');
    expect(labelMove(INACCURACY_DROP, false)).toBe('inaccuracy');
    expect(labelMove(0, true)).toBe('blunder');
    expect(FLAG_DROP).toBe(12); // tuned on real games (Task 14)
  });
});
