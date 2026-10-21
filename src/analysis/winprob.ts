import type { Color, Score } from '../types';

export type { Score };

export const INACCURACY_DROP = 10;
// Tuned on the user's real games (Task 14, 37 rapid+blitz games, depth 12/18, after the findable
// filter): 12 -> mean 1.14 swing moments/game (median 1), 18 -> 0.81, 25 -> 0.62. The 3-6 target is
// not reachable inside 12-25 (even 6 gives only 1.84), so this is the closest value in range.
// Round 3 (material trigger, habit types only + stricter pin/trade rules): 12 -> 1.05 swing + 0.24 material = 1.30/game.
export const FLAG_DROP = 12;

/** Win % (0-100) for `pov`, given an engine score from `sideToMove`'s perspective. */
export function winPercentForColor(score: Score, sideToMove: Color, pov: Color): number {
  let forMover: number;
  if ('mate' in score) {
    forMover = score.mate > 0 ? 100 : 0;
  } else {
    const raw = Number.isFinite(score.cp) ? score.cp : score.cp > 0 ? 1000 : score.cp < 0 ? -1000 : 0;
    const cp = Math.max(-1000, Math.min(1000, raw));
    forMover = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
  }
  return pov === sideToMove ? forMover : 100 - forMover;
}

export function labelMove(drop: number, flagged: boolean): 'good' | 'inaccuracy' | 'blunder' {
  if (flagged) return 'blunder';
  if (drop >= INACCURACY_DROP) return 'inaccuracy';
  return 'good';
}
