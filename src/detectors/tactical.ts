import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import { PIECE_VALUE, materialBalance, isHanging, attackedTargets, replayLine } from '../chess/board';
import type { Color, LineContext, Motif } from '../types';

// Every detector re-checks its claim on the actual line. Besides the brief's rules, the
// fork / pin / skewer / discovered-attack detectors also require a "payoff": a later move
// by the mover (pv[2], pv[4], ...) within the capped line captures one of the motif's
// TARGET pieces — on its square, or the same piece after it moved. This stops a pattern
// that merely exists on the board (or an ordinary exchange) from being credited with
// material that was won some other way. A capture that is immediately taken back by an equal or
// cheaper piece (e.g. Rxh1 Rxh1) is an exchange and never counts as the payoff.

export const DEFAULT_DEPTH_CAP = 9; // mover's own moves

export type Detector = (ctx: LineContext, line: PreparedLine) => Motif | null;

const FILES = 'abcdefgh';
const ORTHO: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

export interface PreparedLine {
  depthCap: number;
  fens: string[]; // fens[0] = root; truncated to 2*depthCap plies
  from: Square; // pv[0] from/to
  to: Square;
  pre: Chess; // root position
  post: Chess; // after pv[0]
  gain: number; // material change for the mover over the capped line, from ctx.gainFrom (default the root)
}

/** Replays the capped line once; null if the context is unusable (wrong side to move, empty or illegal pv[0]). */
export function prepareLine(ctx: LineContext, depthCap: number): PreparedLine | null {
  const pre = new Chess(ctx.fen);
  if (pre.turn() !== ctx.mover || ctx.pv.length === 0) return null;
  const { fens } = replayLine(ctx.fen, ctx.pv.slice(0, 2 * depthCap));
  if (fens.length < 2) return null;
  const gain = materialBalance(fens[fens.length - 1], ctx.mover) - materialBalance(ctx.gainFrom ?? ctx.fen, ctx.mover);
  return {
    depthCap, fens, pre, post: new Chess(fens[1]), gain,
    from: ctx.pv[0].slice(0, 2) as Square, to: ctx.pv[0].slice(2, 4) as Square,
  };
}

const label = (chess: Chess, sq: Square) => `${chess.get(sq)!.type}@${sq}`;
const value = (chess: Chess, sq: Square) => PIECE_VALUE[chess.get(sq)!.type];

function step(sq: Square, df: number, dr: number): Square | null {
  const f = FILES.indexOf(sq[0]) + df;
  const r = Number(sq[1]) + dr;
  return f >= 0 && f < 8 && r >= 1 && r <= 8 ? (`${FILES[f]}${r}` as Square) : null;
}

/** The first two pieces met walking from `start` (exclusive) in direction (df, dr). */
function rayPieces(chess: Chess, start: Square, df: number, dr: number): Square[] {
  const hits: Square[] = [];
  for (let sq = step(start, df, dr); sq && hits.length < 2; sq = step(sq, df, dr)) {
    if (chess.get(sq)) hits.push(sq);
  }
  return hits;
}

function sliderDirs(type: string): [number, number][] {
  if (type === 'r') return ORTHO;
  if (type === 'b') return DIAG;
  if (type === 'q') return [...ORTHO, ...DIAG];
  return [];
}

/**
 * Sliders of the mover that, after pv[0], look along a ray: the moved piece (all of its
 * directions) and any slider whose ray pv[0] unblocked (only the direction through `from`).
 */
function sliderRays(line: PreparedLine, mover: Color, includeMoved: boolean): { sq: Square; dir: [number, number] }[] {
  const out: { sq: Square; dir: [number, number] }[] = [];
  const moved = line.post.get(line.to);
  if (includeMoved && moved) for (const dir of sliderDirs(moved.type)) out.push({ sq: line.to, dir });
  for (const row of line.post.board()) {
    for (const p of row) {
      if (!p || p.color !== mover || p.square === line.to) continue;
      for (const dir of sliderDirs(p.type)) {
        // `from` must be the first square on this ray that was occupied before the move.
        for (let sq = step(p.square, dir[0], dir[1]); sq; sq = step(sq, dir[0], dir[1])) {
          if (sq === line.from) { out.push({ sq: p.square, dir }); break; }
          if (line.pre.get(sq)) break;
        }
      }
    }
  }
  return out;
}

/**
 * The mover's capture at ply `i` (landing on `to`) is taken straight back on that square, and the
 * capturing piece was worth at least what it took: an even (or losing) exchange, not a payoff.
 */
function recapturedEvenly(line: PreparedLine, ctx: LineContext, i: number, to: Square, victim: Square): boolean {
  const before = new Chess(line.fens[i]);
  const capturer = before.get(ctx.pv[i].slice(0, 2) as Square);
  const taken = before.get(victim);
  const reply = ctx.pv[i + 1];
  if (!capturer || !taken || !reply || reply.slice(2, 4) !== to) return false;
  if (replayLine(line.fens[i + 1], [reply]).sans.length === 0) return false; // not legal: no recapture
  return PIECE_VALUE[capturer.type] >= PIECE_VALUE[taken.type];
}

/**
 * A later mover move in the capped line captures one of the pieces standing on `targets`
 * after pv[0], following each piece as the opponent moves it.
 */
function hasPayoff(line: PreparedLine, ctx: LineContext, targets: Square[]): boolean {
  const tracked = new Set<Square>(targets);
  for (let i = 1; i < line.fens.length - 1; i++) {
    const from = ctx.pv[i].slice(0, 2) as Square;
    const to = ctx.pv[i].slice(2, 4) as Square;
    if (i % 2 === 0) {
      const before = new Chess(line.fens[i]);
      const enPassant = before.get(from)?.type === 'p' && from[0] !== to[0] && !before.get(to);
      const captured = enPassant ? (`${to[0]}${from[1]}` as Square) : to;
      if (tracked.has(captured) && (enPassant || before.get(to)) && !recapturedEvenly(line, ctx, i, to, captured)) return true;
    } else if (tracked.has(from)) {
      tracked.delete(from);
      tracked.add(to);
    }
  }
  return false;
}

const undefended = (chess: Chess, sq: Square) => chess.attackers(sq, chess.get(sq)!.color).length === 0;

export const detectMate: Detector = (ctx, line) => {
  if (!('mate' in ctx.score) || ctx.score.mate <= 0 || ctx.score.mate > line.depthCap) return null;
  const final = new Chess(line.fens[line.fens.length - 1]);
  if (!final.isCheckmate() || final.turn() === ctx.mover) return null;
  const kingSq = final.findPiece({ type: 'k', color: final.turn() })[0];
  const lastTo = ctx.pv[line.fens.length - 2].slice(2, 4);
  return {
    type: 'mate', keySquares: [lastTo, kingSq], targets: [`k@${kingSq}`],
    piece: label(line.pre, line.from), mateIn: ctx.score.mate,
  };
};

/** keySquares: the fork square, then the target squares. */
export const detectFork: Detector = (ctx, line) => {
  if (line.gain < 2) return null;
  const moverValue = value(line.post, line.to);
  const targets = attackedTargets(line.fens[1], line.to).filter((sq) => {
    const p = line.post.get(sq)!;
    return p.type === 'k' || PIECE_VALUE[p.type] > moverValue || undefended(line.post, sq);
  });
  if (targets.length < 2) return null;
  const keySquares = [line.to, ...targets];
  if (!hasPayoff(line, ctx, targets)) return null;
  return { type: 'fork', keySquares, targets: targets.map((sq) => label(line.post, sq)), piece: label(line.pre, line.from) };
};

/** Squares strictly between a and b if they share a rank, file or diagonal; otherwise null. */
function between(a: Square, b: Square): Square[] | null {
  const df = FILES.indexOf(b[0]) - FILES.indexOf(a[0]);
  const dr = Number(b[1]) - Number(a[1]);
  if (!(df === 0 || dr === 0 || Math.abs(df) === Math.abs(dr)) || (df === 0 && dr === 0)) return null;
  const out: Square[] = [];
  for (let sq = step(a, Math.sign(df), Math.sign(dr)); sq && sq !== b; sq = step(sq, Math.sign(df), Math.sign(dr))) out.push(sq);
  return out;
}

/** `mid` stands on the open line from `a` to `b`, with nothing else in between. */
function onOpenLine(chess: Chess, a: Square, mid: Square, b: Square): boolean {
  const ab = between(a, b);
  if (!ab || !ab.includes(mid)) return false;
  return ab.every((sq) => sq === mid || !chess.get(sq));
}

/**
 * The pin pays off: a later mover move captures the pinned (front) piece while the pinning
 * slider is still on the board and the pin line slider–front–back is intact, or captures the
 * back piece once the front piece stepped off an intact line. All three pieces are followed as
 * they move. A capture taken straight back at equal value is not a payoff (see recapturedEvenly).
 * Exception: if the pinned piece itself takes the pinner (along the line), winning it
 * back on that square still counts (e.g. Bb5 Qxb5 axb5).
 */
function pinPayoff(line: PreparedLine, ctx: LineContext, slider0: Square, front0: Square, back0: Square): boolean {
  let slider: Square | null = slider0;
  let front: Square | null = front0;
  let back: Square | null = back0;
  let frontTookSlider = false;
  for (let i = 1; i < line.fens.length - 1; i++) {
    const from = ctx.pv[i].slice(0, 2) as Square;
    const to = ctx.pv[i].slice(2, 4) as Square;
    const before = new Chess(line.fens[i]);
    if (i % 2 === 0) {
      const enPassant = before.get(from)?.type === 'p' && from[0] !== to[0] && !before.get(to);
      const captured = enPassant ? (`${to[0]}${from[1]}` as Square) : to;
      const isCapture = (enPassant || !!before.get(to)) && !recapturedEvenly(line, ctx, i, to, captured);
      if (isCapture && captured === front) {
        if (frontTookSlider) return true;
        if (slider && back && onOpenLine(before, slider, front, back)) return true;
      }
      if (isCapture && captured === back && slider && back) {
        const gap = between(slider, back);
        if (gap && gap.every((sq) => !before.get(sq))) return true;
      }
      if (from === slider) slider = to;
    } else {
      if (to === slider) {
        if (from === front && !frontTookSlider) frontTookSlider = true;
        slider = null;
        if (!frontTookSlider) return false; // the pinner is gone: whatever follows is not this pin
      }
      if (from === front) front = to;
      else if (from === back) back = to;
    }
  }
  return false;
}

/** keySquares: slider, front piece, back piece. targets: [front, back]. */
function detectRayMotif(ctx: LineContext, line: PreparedLine, kind: 'pin' | 'skewer'): Motif | null {
  if (line.gain < 2) return null;
  for (const { sq, dir } of sliderRays(line, ctx.mover, true)) {
    const [front, back] = rayPieces(line.post, sq, dir[0], dir[1]);
    if (!back) continue;
    const fp = line.post.get(front)!;
    const bp = line.post.get(back)!;
    if (fp.color === ctx.mover || bp.color === ctx.mover) continue;
    const fv = PIECE_VALUE[fp.type];
    const bv = PIECE_VALUE[bp.type];
    const isKind = kind === 'pin' ? fv < bv : fv > bv;
    if (!isKind) continue;
    // Pin: see pinPayoff. Skewer: the front piece steps aside and the piece behind it is taken.
    const paid = kind === 'pin' ? pinPayoff(line, ctx, sq, front, back) : hasPayoff(line, ctx, [back]);
    if (!paid) continue;
    const keySquares = [sq, front, back];
    return {
      type: kind, keySquares, targets: [label(line.post, front), label(line.post, back)],
      piece: label(line.pre, line.from),
    };
  }
  return null;
}

export const detectPin: Detector = (ctx, line) => detectRayMotif(ctx, line, 'pin');
export const detectSkewer: Detector = (ctx, line) => detectRayMotif(ctx, line, 'skewer');

/** keySquares: the uncovered slider, the square the piece left, the target. targets: the target, then (discovered check only) what the moved piece attacks. */
export const detectDiscoveredAttack: Detector = (ctx, line) => {
  if (line.gain < 2) return null;
  for (const { sq, dir } of sliderRays(line, ctx.mover, false)) {
    const [target] = rayPieces(line.post, sq, dir[0], dir[1]);
    if (!target) continue;
    const tp = line.post.get(target)!;
    if (tp.color === ctx.mover) continue;
    if (!(tp.type === 'k' || PIECE_VALUE[tp.type] > value(line.post, sq) || undefended(line.post, target))) continue;
    // Discovered check: the king itself is never taken, so the payoff is what the moved
    // piece hits while the opponent deals with the check.
    const extra = tp.type !== 'k' ? [] : attackedTargets(line.fens[1], line.to).filter((t) => {
      const p = line.post.get(t)!;
      return p.type !== 'k' && (PIECE_VALUE[p.type] > value(line.post, line.to) || undefended(line.post, t));
    });
    const tracked = [target, ...extra];
    if (!hasPayoff(line, ctx, tracked)) continue;
    const keySquares = [sq, line.from, target];
    return { type: 'discovered-attack', keySquares, targets: tracked.map((t) => label(line.post, t)), piece: label(line.pre, line.from) };
  }
  return null;
};

/** keySquares: the captured piece's square. */
export const detectHangingPiece: Detector = (ctx, line) => {
  if (line.gain < 2) return null;
  const victim = line.pre.get(line.to);
  if (!victim || victim.color === ctx.mover || !isHanging(ctx.fen, line.to)) return null;
  const motif: Motif = { type: 'hanging-piece', keySquares: [line.to], targets: [label(line.pre, line.to)], piece: label(line.pre, line.from) };
  if (line.pre.attackers(line.to, victim.color).length > 0) motif.defended = true;
  if (ctx.prevMove && ctx.prevMove.slice(2, 4) === line.to) motif.recapture = true;
  return motif;
};

export const TACTICAL_DETECTORS: Detector[] = [
  detectMate, detectFork, detectPin, detectSkewer, detectDiscoveredAttack, detectHangingPiece,
];
