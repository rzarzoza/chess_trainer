import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import type {
  Color, Engine, EngineLine, ExplainedLine, GameAnalysis, GameRecord, LineContext, MistakeType,
  Moment, Motif, MoveEval, PlyRecord, Score,
} from '../types';
import { ANALYSIS_VERSION } from '../types';
import { FLAG_DROP, labelMove, winPercentForColor } from './winprob';
import { detectMotif, detectStopsThreat } from '../detectors';
import { PIECE_VALUE, isHanging, materialBalance, nullMoveFen, phaseOf, replayLine } from '../chess/board';
import { describeStep, summarizeMotif, momentExplanation, FALLBACK_BETTER, FALLBACK_KEPT } from './explain';

export const MIN_WIN_BEFORE = 10; // already-lost positions don't produce swing moments
const MATERIAL_PLIES = 6; // material trigger: plies looked at after the user's move
const MATERIAL_MIN = 2; // material trigger: pawns lost (and avoidable)
const MULTI_PV = 3;
const ALT_WINDOW = 10; // a MultiPV line counts as "about as good" within this many win% of the best
const WON_WIN = 99; // material trigger: at or above this win% after the move, a "loss" is a winning sacrifice
const PLAIN_HUNG_DROP = 40;
const PLAIN_HUNG_GAIN = 3;
const PLAIN_HUNG_PLIES = 6; // 3 opponent moves (with the user's replies)
const SHOWN_USER_MOVES = 9; // lines are shown up to 9 of the mover's own moves
const LOW_CLOCK_SHARE = 0.15;

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');
const EVEN: Score = { cp: 0 };

const MISSED: Partial<Record<Motif['type'], MistakeType>> = {
  mate: 'missed-mate', fork: 'missed-fork', pin: 'missed-pin', skewer: 'missed-skewer',
  'discovered-attack': 'missed-discovered-attack', 'hanging-piece': 'missed-free-material',
};

/** UCI of the move that led to a line's root, only when it was a capture (so "take back" stays truthful). */
const capturePrev = (p: PlyRecord | undefined) => (p && p.san.includes('x') ? p.uci : undefined);

/** Builds the line shown to the user: at most 9 of the mover's own moves, legal prefix only. */
function explainLine(fen: string, pv: string[], motif: Motif | null, pov: Color, summary: string): ExplainedLine {
  const shown = pv.slice(0, 2 * SHOWN_USER_MOVES);
  const { fens, sans } = replayLine(fen, shown);
  let uci = shown.slice(0, sans.length);
  let stepNotes = uci.map((m, i) => describeStep(fens[i], m, pov));
  let san = sans;
  // Trim quiet tail moves: end at the last ply with something to say (always keep ply 1; never cut a mate).
  if (!san[san.length - 1]?.endsWith('#')) {
    let last = stepNotes.length - 1;
    while (last > 0 && !stepNotes[last]) last--;
    uci = uci.slice(0, last + 1); san = san.slice(0, last + 1); stepNotes = stepNotes.slice(0, last + 1);
  }
  return {
    uci, san, motif, summary, stepNotes,
    userMoves: Math.ceil(uci.length / 2), // the mover plays plies 0, 2, 4, ...
  };
}

/** `pov`'s material after the first `plies` plies of the line from `fen` (legal prefix). */
function materialAfter(fen: string, pv: string[], pov: Color, plies: number): number {
  const { fens } = replayLine(fen, pv.slice(0, plies));
  return materialBalance(fens[fens.length - 1], pov);
}

/**
 * User piece that became hanging with the opponent's last move, was left on its square (still
 * hanging after the user's move), and is what the punishment's first move captures.
 */
function ignoredThreat(user: Color, prev: PlyRecord | undefined, played: PlyRecord, punishFirst: string | undefined): string | null {
  if (!prev || prev.color === user || !punishFirst) return null;
  const sq = punishFirst.slice(2, 4) as Square;
  if (played.uci.slice(0, 2) === sq) return null; // the user moved it (and something else now stands there)
  const before = new Chess(played.fenBefore).get(sq);
  const after = new Chess(played.fenAfter).get(sq);
  if (!before || before.color !== user || !after || after.color !== user || after.type !== before.type) return null;
  if (!isHanging(played.fenBefore, sq) || isHanging(prev.fenBefore, sq) || !isHanging(played.fenAfter, sq)) return null;
  if (!replayLine(played.fenAfter, [punishFirst]).sans[0]?.includes('x')) return null; // must really capture it
  return `${before.type}@${sq}`;
}

/** The user's piece a punishment motif is about: the piece taken (hung-piece) or the first non-king target. */
function userPieceHit(motif: Motif, fenAfter: string, user: Color): string | null {
  if (motif.type === 'hanging-piece') {
    const sq = motif.keySquares[0] as Square | undefined;
    const piece = sq ? new Chess(fenAfter).get(sq) : undefined;
    return piece && piece.color === user ? `${piece.type}@${sq}` : null;
  }
  // Tactical targets are always pieces of the side being hit, i.e. the user's.
  return motif.targets.find((t) => !t.startsWith('k@')) ?? null;
}

const byMultiPv = (lines: EngineLine[]) => [...lines].sort((a, b) => a.multipv - b.multipv);

export async function analyzeGame(
  game: GameRecord,
  engine: Engine,
  opts: { quickDepth?: number; deepDepth?: number; flagDrop?: number; onPly?: (done: number, total: number) => void } = {},
): Promise<GameAnalysis> {
  if (!game.userColor) throw new Error(`analyzeGame: game ${game.id} has no user side`);
  const user: Color = game.userColor;
  const opp = other(user);
  const quickDepth = opts.quickDepth ?? 12;
  const deepDepth = opts.deepDepth ?? 18;
  const flagDrop = opts.flagDrop ?? FLAG_DROP; // overridable for threshold tuning (scripts/tune-report.ts)
  const plies = game.plies;

  // ── Pass 1: quick eval of every position, user's win% ─────────────────────
  const fens = plies.length > 0 ? [...plies.map((p) => p.fenBefore), plies[plies.length - 1].fenAfter] : [];
  const wins: number[] = [];
  const quick: (EngineLine | null)[] = []; // pass-1 line per position (null when the game is over there)
  for (let i = 0; i < fens.length; i++) {
    const { win, line } = await positionEval(engine, fens[i], quickDepth, user);
    wins.push(win);
    quick.push(line);
    opts.onPly?.(i + 1, fens.length);
  }

  /**
   * Material trigger: the quick line after the user's move wins >= 2 for the opponent within 6 plies,
   * counted from before the user's move (so an even trade doesn't count), the user wasn't
   * already being mated, and the move isn't a winning sacrifice (mate for the user, or still >= 99%).
   */
  const materialTrigger = (p: PlyRecord, i: number): boolean => {
    const own = quick[i]?.score;
    if (own && 'mate' in own && own.mate < 0) return false;
    if (wins[i + 1] >= WON_WIN) return false;
    const reply = quick[i + 1];
    if (!reply || reply.pv.length === 0) return false;
    if ('mate' in reply.score && reply.score.mate < 0) return false; // the opponent (to move) is being mated
    const lost = materialBalance(p.fenBefore, user) - materialAfter(p.fenAfter, reply.pv, user, MATERIAL_PLIES);
    return lost >= MATERIAL_MIN;
  };

  const evals = plies.map((p, i) => {
    const byUser = p.color === user;
    const winBefore = wins[i];
    const winAfter = wins[i + 1];
    const drop = Math.max(0, byUser ? winBefore - winAfter : winAfter - winBefore);
    const swing = byUser && drop >= flagDrop && winBefore >= MIN_WIN_BEFORE;
    const trigger: Moment['trigger'] | null = swing ? 'swing' : byUser && materialTrigger(p, i) ? 'material' : null;
    return { p, i, byUser, winBefore, winAfter, drop, trigger };
  });

  // ── Pass 2: deep look at each candidate ───────────────────────────────────
  const moments: Moment[] = [];
  for (const e of evals) {
    if (!e.trigger) continue;
    const m = await examine(e.p, e.i, e.trigger);
    if (m) moments.push(m);
  }
  const flagged = new Set(moments.map((m) => m.ply));

  const moves: MoveEval[] = evals.map((e) => ({
    ply: e.p.ply, san: e.p.san, byUser: e.byUser, winBefore: e.winBefore, winAfter: e.winAfter, drop: e.drop,
    label: e.byUser ? labelMove(e.drop, flagged.has(e.p.ply)) : 'opponent',
  }));
  return { gameId: game.id, analysisVersion: ANALYSIS_VERSION, moves, moments };

  async function examine(p: PlyRecord, i: number, trigger: Moment['trigger']): Promise<Moment | null> {
    const winBefore = wins[i];
    const winAfter = wins[i + 1];
    const drop = winBefore - winAfter;
    const prev = plies[i - 1];
    const next = plies[i + 1];

    // Better move: the first explainable line among those about as good as the best.
    const deepLines = byMultiPv(await engine.analyse(p.fenBefore, { depth: deepDepth, multiPv: MULTI_PV })).filter((l) => l.pv.length > 0);
    const lineWin = (l: EngineLine) => winPercentForColor(l.score, user, user);
    const bestWin = deepLines.length > 0 ? lineWin(deepLines[0]) : -Infinity;
    // The deep search rates the played move about as good as the best: not a real mistake.
    // (Material moments are checked on material instead: win% says little in a decided game.)
    if (trigger === 'swing' && deepLines.some((l) => l.pv[0] === p.uci && bestWin - lineWin(l) <= ALT_WINDOW)) return null;
    const multi = deepLines.filter((l) => l.pv[0] !== p.uci); // never offer the played move as "better"
    const close = multi.filter((l) => bestWin - lineWin(l) <= ALT_WINDOW);
    const ctxOf = (l: EngineLine): LineContext => {
      const ctx: LineContext = { fen: p.fenBefore, pv: l.pv, mover: user, score: l.score };
      const pm = capturePrev(prev);
      if (pm) ctx.prevMove = pm;
      return ctx;
    };
    let betterLine: EngineLine | null = null;
    let betterMotif: Motif | null = null;
    for (const l of close) {
      betterMotif = detectMotif(ctxOf(l), { rootWin: lineWin(l) });
      if (betterMotif) { betterLine = l; break; }
    }
    if (!betterMotif && close.length > 0) {
      const nf = nullMoveFen(p.fenBefore);
      if (nf) {
        const threat = (await engine.analyse(nf, { depth: quickDepth }))[0] ?? null;
        for (const l of close) {
          betterMotif = detectStopsThreat(ctxOf(l), threat);
          if (betterMotif) { betterLine = l; break; }
        }
      }
    }
    if (!betterMotif && multi.length > 0 && (trigger === 'material' || lineWin(multi[0]) - winAfter >= flagDrop)) betterLine = multi[0];

    // Punishment: the opponent's best reply, tactical motifs only.
    const top = byMultiPv(await engine.analyse(p.fenAfter, { depth: deepDepth }))[0];
    const punishPv = top?.pv ?? [];
    let punishMotif: Motif | null = null;
    if (top && punishPv.length > 0) {
      // Gain counted from before the user's move: taking back what he just took is not winning material.
      const ctx: LineContext = { fen: p.fenAfter, pv: punishPv, mover: opp, score: top.score, gainFrom: p.fenBefore };
      const pm = capturePrev(p);
      if (pm) ctx.prevMove = pm;
      punishMotif = detectMotif(ctx);
      if (punishMotif && isEvenTradeBack(p, punishMotif)) punishMotif = null;
    }
    // Opponent's net material gain from before the user's move (so taking back is not "winning material").
    const netGain = (plies: number) => materialBalance(p.fenBefore, user) - materialAfter(p.fenAfter, punishPv, user, plies);
    const bestLine = deepLines[0];
    const materialLost = bestLine
      ? Math.max(0, materialAfter(p.fenBefore, bestLine.pv, user, MATERIAL_PLIES)
        - materialAfter(p.fenBefore, [p.uci, ...punishPv], user, MATERIAL_PLIES))
      : 0;
    const threatened = ignoredThreat(user, prev, p, punishPv[0]);

    // Findable filter.
    const plainHung = drop >= PLAIN_HUNG_DROP && punishPv.length > 0
      && netGain(PLAIN_HUNG_PLIES) >= PLAIN_HUNG_GAIN;
    if (trigger === 'material') {
      // A clear, avoidable material loss: the punishment is a real tactic or wins >= 2, and the
      // best line keeps >= 2 more material than the played move. Never a winning sacrifice.
      if (top && 'mate' in top.score && top.score.mate < 0) return null;
      if (!(punishMotif || netGain(MATERIAL_PLIES) >= MATERIAL_MIN) || materialLost < MATERIAL_MIN) return null;
    } else if (!punishMotif && !betterMotif && !plainHung) return null;

    let mistakeType: MistakeType;
    let pieceInvolved: string | null;
    if (threatened) {
      mistakeType = 'ignored-threat';
      pieceInvolved = threatened;
    } else if (punishMotif) {
      mistakeType = punishMotif.type === 'mate' ? 'walked-into-mate'
        : punishMotif.type === 'hanging-piece' ? 'hung-piece' : 'walked-into-tactic';
      pieceInvolved = userPieceHit(punishMotif, p.fenAfter, user);
    } else if (betterMotif && trigger === 'swing') { // material moments are named by what was lost only
      mistakeType = MISSED[betterMotif.type] ?? 'missed-positional';
      pieceInvolved = betterMotif.piece; // the user's moving piece
    } else {
      mistakeType = 'unexplained';
      pieceInvolved = null;
    }
    // Material moments are habit examples: they need a named mistake about what was lost (a
    // punishment motif or an ignored threat), and walking into mate in an already-lost game is noise.
    if (trigger === 'material'
      && (mistakeType === 'unexplained' || (mistakeType === 'walked-into-mate' && winBefore <= MIN_WIN_BEFORE))) return null;

    const better = betterLine
      ? explainLine(p.fenBefore, betterLine.pv, betterMotif, user,
        betterMotif ? summarizeMotif(betterMotif, user, user) : `${trigger === 'material' ? FALLBACK_KEPT : FALLBACK_BETTER}.`)
      : null;
    // Show the punishment only when there is something true to say about it:
    // a confirmed motif, or it actually wins material in the shown line.
    const showPunish = punishPv.length > 0
      && (punishMotif || threatened || netGain(2 * SHOWN_USER_MOVES) >= 1);
    const punishment = showPunish
      ? explainLine(p.fenAfter, punishPv, punishMotif, user, summarizeMotif(punishMotif, user, opp))
      : null;

    // A material moment must be able to show what was lost.
    if (trigger === 'material' && !punishment) return null;

    const punished = !next
      || (punishPv.length > 0 && next.uci === punishPv[0])
      || wins[i + 2] < winBefore - flagDrop / 2
      || (trigger === 'material' && materialBalance(p.fenBefore, user) - materialBalance(next.fenAfter, user) >= MATERIAL_MIN);

    const moment: Moment = {
      ply: p.ply, playedSan: p.san, fenBefore: p.fenBefore, winBefore, winAfter, drop,
      mistakeType, better, punishment, punished, explanation: '',
      phase: phaseOf(p.fenBefore, p.ply),
      lowClock: p.clockSec !== null && game.baseTimeSec !== null && p.clockSec < LOW_CLOCK_SHARE * game.baseTimeSec,
      pieceInvolved, trigger, materialLost,
    };
    moment.explanation = momentExplanation(moment, game);
    return moment;
  }
}

/**
 * A hanging-piece take-back where the user's move was itself a capture of equal or greater value
 * than the piece he takes back: that is just a trade, not a punishment.
 */
function isEvenTradeBack(p: PlyRecord, motif: Motif): boolean {
  if (motif.type !== 'hanging-piece' || !motif.recapture) return false;
  const to = p.uci.slice(2, 4) as Square;
  const before = new Chess(p.fenBefore);
  const mover = before.get(p.uci.slice(0, 2) as Square);
  const taken = before.get(to) ?? (mover?.type === 'p' && p.uci[0] !== p.uci[2] ? { type: 'p' as const } : undefined);
  const mine = new Chess(p.fenAfter).get(to);
  return !!taken && !!mine && PIECE_VALUE[taken.type] >= PIECE_VALUE[mine.type];
}

/** User's win% in a position plus the engine's line; game-over positions are scored directly. */
async function positionEval(engine: Engine, fen: string, depth: number, user: Color): Promise<{ win: number; line: EngineLine | null }> {
  const chess = new Chess(fen);
  const toMove = chess.turn() as Color;
  if (chess.isCheckmate()) return { win: toMove === user ? 0 : 100, line: null };
  if (chess.isStalemate() || chess.isInsufficientMaterial()) return { win: 50, line: null };
  const line = byMultiPv(await engine.analyse(fen, { depth }))[0] ?? null;
  return { win: winPercentForColor(line?.score ?? EVEN, toMove, user), line };
}
