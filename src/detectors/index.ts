import type { LineContext, Motif } from '../types';
import { DEFAULT_DEPTH_CAP, TACTICAL_DETECTORS, prepareLine } from './tactical';
import type { PreparedLine } from './tactical';
import { detectPositional } from './positional';

/** A positional detector; `rootWin` is the mover's win% after pv[0]. */
export type PositionalDetector = (ctx: LineContext, rootWin: number, line: PreparedLine) => Motif | null;

// ── TASK 7 HOOK ─────────────────────────────────────────────────────────────
// Positional detectors run after every tactical detector, and only when `opts.rootWin` is
// given. detectPositional tries open-file, pawn-break, winning-trade in that order.
// (stops-threat needs an engine threat line, so Task 9 calls detectStopsThreat itself.)
const POSITIONAL_DETECTORS: PositionalDetector[] = [detectPositional];
// ────────────────────────────────────────────────────────────────────────────

export { DEFAULT_DEPTH_CAP };
export { detectPositional, detectStopsThreat } from './positional';

/** First motif confirmed on the line: mate, fork, pin, skewer, discovered attack, hanging piece, then positional. */
export function detectMotif(ctx: LineContext, opts?: { depthCap?: number; rootWin?: number }): Motif | null {
  const depthCap = opts?.depthCap ?? DEFAULT_DEPTH_CAP;
  const line = prepareLine(ctx, depthCap);
  if (!line) return null;
  for (const detect of TACTICAL_DETECTORS) {
    const m = detect(ctx, line);
    if (m) return m;
  }
  if (opts?.rootWin !== undefined) {
    for (const detect of POSITIONAL_DETECTORS) {
      const m = detect(ctx, opts.rootWin, line);
      if (m) return m;
    }
  }
  return null;
}
