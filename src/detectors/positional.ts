import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import { materialBalance, nonPawnMaterial, phaseOf, isHanging, attackedTargets, replayLine, nullMoveFen } from '../chess/board';
import type { Color, EngineLine, LineContext, Motif } from '../types';
import { DEFAULT_DEPTH_CAP, TACTICAL_DETECTORS, prepareLine } from './tactical';
import type { PreparedLine } from './tactical';

// Positional motifs don't use the tactical payoff rule, so each detector is deliberately
// narrow: it only fires when the claim is plainly true on the board after pv[0], and never
// for a move that just drops the piece it is talking about. A miss is better than a wrong reason.

/** `rootWin` is the mover's win% after pv[0]. */
export type PositionalDetector = (ctx: LineContext, rootWin: number, line: PreparedLine) => Motif | null;

const FILES = 'abcdefgh';
const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');
const label = (chess: Chess, sq: Square) => `${chess.get(sq)!.type}@${sq}`;
const fileDist = (a: Square, b: Square) => Math.abs(FILES.indexOf(a[0]) - FILES.indexOf(b[0]));

function fileSquares(file: string): Square[] {
  return [1, 2, 3, 4, 5, 6, 7, 8].map((r) => `${file}${r}` as Square);
}

function pawnsOnFile(chess: Chess, file: string, color: Color): Square[] {
  return fileSquares(file).filter((sq) => {
    const p = chess.get(sq);
    return p && p.type === 'p' && p.color === color;
  });
}

const kingSquare = (chess: Chess, color: Color) => chess.findPiece({ type: 'k', color })[0];
const isCapture = (chess: Chess, from: Square, to: Square) =>
  !!chess.get(to) || (chess.get(from)?.type === 'p' && from[0] !== to[0]);

/**
 * open-file: pv[0] (not a capture) moves a rook or queen onto a new file that has no pawns
 * (open), or no own pawns where an enemy pawn there is undefended (by anything) or the
 * file is the enemy king's file or next to it (half-open). The piece must not be hanging there.
 * keySquares: the piece's new square, then (half-open) the enemy pawns on the file.
 * targets: the weak (undefended) enemy pawns only; empty when the file counts for the king.
 */
export const detectOpenFile: PositionalDetector = (ctx, _rootWin, line) => {
  const piece = line.pre.get(line.from);
  if (!piece || (piece.type !== 'r' && piece.type !== 'q')) return null;
  if (line.from[0] === line.to[0] || isCapture(line.pre, line.from, line.to)) return null;
  if (isHanging(line.fens[1], line.to)) return null;
  const file = line.to[0];
  const enemy = other(ctx.mover);
  if (pawnsOnFile(line.post, file, ctx.mover).length > 0) return null;
  const enemyPawns = pawnsOnFile(line.post, file, enemy);
  const motif: Motif = { type: 'open-file', keySquares: [line.to], targets: [], piece: label(line.pre, line.from) };
  if (enemyPawns.length === 0) return motif;
  const weak = enemyPawns.filter((sq) => line.post.attackers(sq, enemy).length === 0);
  const nearKing = fileDist(line.to, kingSquare(line.post, enemy)) <= 1;
  if (weak.length === 0 && !nearKing) return null;
  // targets = weak pawns only; a half-open file credited for being next to the king lists its
  // (defended) pawns in keySquares but names no target.
  const shown = weak.length > 0 ? weak : enemyPawns;
  return { ...motif, keySquares: [line.to, ...shown], targets: weak.map((sq) => label(line.post, sq)) };
};

/**
 * pawn-break: pv[0] is a pawn push (not a capture) into the enemy half of the board (ranks
 * 5-8 for White, 4-1 for Black) that attacks an enemy pawn, and the pushed pawn is not hanging.
 * Then either
 *  - subtype 'king-attack': an attacked pawn shields the enemy king — within 2 ranks and 1
 *    file of it — and that king has left the d/e files (castled or moved to a wing); or
 *  - subtype 'opens-file': a mover rook stands on the pawn's file and the pushed pawn is the
 *    only own pawn there, so the exchange opens the file for it.
 * keySquares: the pawn's new square, then the attacked enemy pawns.
 */
export const detectPawnBreak: PositionalDetector = (ctx, _rootWin, line) => {
  const piece = line.pre.get(line.from);
  if (!piece || piece.type !== 'p' || isCapture(line.pre, line.from, line.to)) return null;
  const rank = Number(line.to[1]);
  if (ctx.mover === 'w' ? rank < 5 : rank > 4) return null;
  const hit = attackedTargets(line.fens[1], line.to).filter((sq) => line.post.get(sq)!.type === 'p');
  if (hit.length === 0 || isHanging(line.fens[1], line.to)) return null;
  const king = kingSquare(line.post, other(ctx.mover));
  const kingOnWing = king[0] !== 'd' && king[0] !== 'e';
  const shield = hit.filter((sq) => kingOnWing && fileDist(sq, king) <= 1 && Math.abs(Number(sq[1]) - Number(king[1])) <= 2);
  const file = line.to[0];
  const rookOnFile = fileSquares(file).some((sq) => {
    const p = line.post.get(sq);
    return p && p.type === 'r' && p.color === ctx.mover;
  });
  const opensFile = rookOnFile && pawnsOnFile(line.post, file, ctx.mover).length === 1;
  if (shield.length === 0 && !opensFile) return null;
  const shown = shield.length > 0 ? shield : hit;
  return {
    type: 'pawn-break', subtype: shield.length > 0 ? 'king-attack' : 'opens-file',
    keySquares: [line.to, ...shown], targets: shown.map((sq) => label(line.post, sq)), piece: label(line.pre, line.from),
  };
};

/**
 * winning-trade: the root is not yet an endgame, pv[0] is a capture answered by a recapture on
 * the same square (or pv[0] provokes a capture that the mover takes back at once: the pair
 * starts at ply 0 or 1), the capped line ends in an endgame with the mover not worse than a
 * pawn down, and rootWin >= 80.
 * keySquares: the square of the first such trade. targets: the piece captured first there.
 */
export const detectWinningTrade: PositionalDetector = (ctx, rootWin, line) => {
  if (rootWin < 80 || nonPawnMaterial(ctx.fen) <= 26) return null;
  const final = line.fens[line.fens.length - 1];
  if (phaseOf(final, Number.MAX_SAFE_INTEGER) !== 'endgame' || materialBalance(final, ctx.mover) < -1) return null;
  const captureAt = (i: number): { sq: Square; chess: Chess } | null => {
    const chess = new Chess(line.fens[i]);
    const to = ctx.pv[i].slice(2, 4) as Square;
    return chess.get(to) ? { sq: to, chess } : null; // en passant never lands on an occupied square, so no "pair"
  };
  for (let i = 0; i <= 1 && i + 2 < line.fens.length; i++) {
    const a = captureAt(i);
    const b = a && captureAt(i + 1);
    if (a && b && a.sq === b.sq) {
      return { type: 'winning-trade', keySquares: [a.sq], targets: [label(a.chess, a.sq)], piece: label(line.pre, line.from) };
    }
  }
  return null;
};

export const POSITIONAL_DETECTORS: PositionalDetector[] = [detectOpenFile, detectPawnBreak, detectWinningTrade];

/** First positional motif on the line (open-file, pawn-break, winning-trade), or null. */
export function detectPositional(ctx: LineContext, rootWin: number, line?: PreparedLine): Motif | null {
  const prepared = line ?? prepareLine(ctx, DEFAULT_DEPTH_CAP);
  if (!prepared) return null;
  for (const detect of POSITIONAL_DETECTORS) {
    const m = detect(ctx, rootWin, prepared);
    if (m) return m;
  }
  return null;
}

/** Tactical-only motif search (same as detectMotif without rootWin; kept here to avoid an import cycle). */
function tacticalMotif(ctx: LineContext): Motif | null {
  const line = prepareLine(ctx, DEFAULT_DEPTH_CAP);
  if (!line) return null;
  for (const detect of TACTICAL_DETECTORS) {
    const m = detect(ctx, line);
    if (m) return m;
  }
  return null;
}

/**
 * stops-threat: `threatLine` (the opponent's best line in nullMoveFen(ctx.fen)) is a tactic for
 * the opponent, and after pv[0] it no longer works. "No longer works" means one of:
 *  - the threat's first move is illegal, or the threat line breaks at one of the opponent's moves;
 *  - the threat line replays but detectMotif no longer finds a tactic on it;
 *  - the threat's first move now lands on a square where the mover can legally take the piece
 *    and it is hanging (the "covers the square" case — the stale threat pv can't show that
 *    reply, so it is checked directly; it only counts if the piece was not already hanging
 *    there in the null-move line).
 * Not claimed when pv[0] gives check (that only delays the threat), or when the threat line
 * breaks at one of the mover's own replies (we can't tell what the threat would be then).
 * keySquares / targets: the threat's.
 */
export function detectStopsThreat(ctx: LineContext, threatLine: EngineLine | null): Motif | null {
  if (!threatLine || threatLine.pv.length === 0) return null;
  const nullFen = nullMoveFen(ctx.fen);
  if (!nullFen) return null;
  const opp = other(ctx.mover);
  const threat = tacticalMotif({ fen: nullFen, pv: threatLine.pv, mover: opp, score: threatLine.score });
  if (!threat) return null;

  const pre = new Chess(ctx.fen);
  if (pre.turn() !== ctx.mover || ctx.pv.length === 0) return null;
  const after = replayLine(ctx.fen, ctx.pv.slice(0, 1)).fens[1];
  if (!after || new Chess(after).isCheck()) return null;

  const motif: Motif = { type: 'stops-threat', keySquares: threat.keySquares, targets: threat.targets, piece: label(pre, ctx.pv[0].slice(0, 2) as Square) };
  const { fens } = replayLine(after, threatLine.pv);
  const played = fens.length - 1;
  if (played === 0) return motif;
  if (played < threatLine.pv.length && played % 2 === 1) return null; // broke at a mover reply

  if (pieceNowCapturable(nullFen, after, threatLine.pv[0])) return motif;
  const still = tacticalMotif({ fen: after, pv: threatLine.pv.slice(0, played), mover: opp, score: threatLine.score });
  return still ? null : motif;
}

/** The threat's first move lands on a square where its piece is hanging and the mover can legally take it — but wasn't before. */
function pieceNowCapturable(nullFen: string, after: string, uci: string): boolean {
  const to = uci.slice(2, 4) as Square;
  const landed = (fen: string) => replayLine(fen, [uci]).fens[1];
  const before = landed(nullFen);
  const now = landed(after);
  if (!before || !now) return false;
  if (isHanging(before, to) || !isHanging(now, to)) return false;
  return new Chess(now).moves({ verbose: true }).some((m) => m.to === to);
}
