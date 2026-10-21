import { Chess } from 'chess.js';
import type { Square, PieceSymbol } from 'chess.js';
import { PIECE_VALUE, attackedTargets } from '../chess/board';
import type { Color, GameRecord, Moment, MoveEval, Motif } from '../types';

const NAMES: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const PLURAL: Record<string, string> = { pawn: 'pawns', knight: 'knights', bishop: 'bishops', rook: 'rooks', queen: 'queens', king: 'kings' };
const COUNT = ['', 'one', 'two', 'three', 'four'];
export const FALLBACK_WIN = 'This wins material';
export const FALLBACK_BETTER = 'This was much stronger';
export const FALLBACK_KEPT = 'This kept your material'; // better-move fallback for material moments

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');
const SQ = /^[a-h][1-8]$/;

/** 'n@d5' -> 'knight'; anything unrecognised -> 'piece'. */
function pieceName(label: string | undefined): string {
  return (label && NAMES[label[0]?.toLowerCase()]) || 'piece';
}

/** ['rook','rook','bishop'] -> 'two rooks and bishop'; 2+ items joined with commas and "and". */
function nameList(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const parts = [...counts].map(([n, c]) => (c > 1 ? `${COUNT[c] ?? 'several'} ${PLURAL[n] ?? n}` : n));
  if (parts.length === 0) return 'pieces';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A short note for one move of a line, from pov's perspective. Never throws. */
export function describeStep(fenBefore: string, uci: string, pov: Color): string {
  try {
    const chess = new Chess(fenBefore);
    const mover = chess.turn();
    const wasInCheck = chess.isCheck();
    const from = uci.slice(0, 2) as Square;
    const to = uci.slice(2, 4) as Square;
    const movingType = chess.get(from)?.type;
    const mv = chess.move({ from, to, promotion: uci[4] });
    const parts: string[] = [];
    if (chess.isCheck()) parts.push('check');
    if (mv.captured) {
      parts.push(`takes ${mover === pov ? 'his' : 'your'} ${NAMES[mv.captured] ?? 'piece'}`);
    }
    const after = chess.fen();
    const before = new Set(attackedTargets(fenBefore, from));
    const fresh = (movingType === 'k' ? [] : attackedTargets(after, to)).filter((sq) => {
      if (before.has(sq)) return false;
      const t = chess.get(sq);
      if (!t || t.type === 'k') return false; // king attacks are covered by "check"
      const mine = PIECE_VALUE[(mv.promotion ?? movingType ?? 'p') as PieceSymbol];
      const defended = chess.attackers(sq, t.color).length > 0;
      return PIECE_VALUE[t.type] > mine || (!defended && PIECE_VALUE[t.type] >= 3);
    });
    if (fresh.length > 0) {
      const types = fresh.map((sq) => chess.get(sq)!.type).sort((a, b) => PIECE_VALUE[b] - PIECE_VALUE[a]).slice(0, 2);
      parts.push(`attacks the ${nameList(types.map((t) => NAMES[t]))} too`);
    }
    if (mv.promotion) parts.push('promotes');
    if (wasInCheck && movingType === 'k') parts.push('king has to move');
    return parts.join(', ');
  } catch {
    return '';
  }
}

/** One sentence about a motif. `mover` is the side that plays it; "his" = the opponent of pov. */
export function summarizeMotif(m: Motif | null | undefined, pov: Color, mover: Color): string {
  try {
    if (!m) return FALLBACK_WIN + '.';
    const mine = mover === pov;
    const his = mine ? 'his' : 'your';
    const your = mine ? 'your' : 'his';
    const targets = Array.isArray(m.targets) ? m.targets : [];
    const keys = Array.isArray(m.keySquares) ? m.keySquares : [];
    const t = (i: number) => pieceName(targets[i]);
    switch (m.type) {
      case 'fork': {
        const hit = targets.length > 0 ? `${his} ${nameList(targets.map(pieceName))}` : 'two pieces';
        return `${cap(pieceName(m.piece))} fork: it hits ${hit} at the same time.`;
      }
      case 'mate':
        return typeof m.mateIn === 'number' && Number.isFinite(m.mateIn) && m.mateIn > 0
          ? `Checkmate in ${Math.round(m.mateIn)}.` : 'Checkmate.';
      case 'pin':
        return t(1) === 'king'
          ? `Pin: ${his} ${t(0)} can't move off the line without exposing ${his} king.`
          : `Pin: ${his} ${t(0)} can't move without losing the ${t(1)}.`;
      case 'skewer':
        return `Skewer: ${his} ${t(0)} has to move and the ${t(1)} behind it falls.`;
      case 'discovered-attack':
        return `Discovered attack: moving the ${pieceName(m.piece)} uncovers an attack on ${his} ${t(0)}.`;
      case 'hanging-piece': {
        const sq = SQ.test(keys[0] ?? '') ? ` on ${keys[0]}` : '';
        if (m.defended) {
          const who = mine ? 'you' : 'he';
          if (m.recapture) return `Take back: ${who} could win ${his} ${t(0)}${sq}.`;
          const victim = PIECE_VALUE[targets[0]?.[0]?.toLowerCase() as PieceSymbol];
          const capturer = PIECE_VALUE[m.piece?.[0]?.toLowerCase() as PieceSymbol];
          return victim !== undefined && capturer !== undefined && victim > capturer
            ? `${cap(who)} could win ${his} ${t(0)}${sq}: it's worth more than the ${pieceName(m.piece)} that takes it.`
            : `${cap(who)} could win ${his} ${t(0)}${sq}.`;
        }
        const core = `${his} ${t(0)}${sq} was free to take.`;
        return m.recapture ? `Take back: ${core}` : cap(core);
      }
      case 'open-file': {
        const file = SQ.test(keys[0] ?? '') ? `${keys[0][0]}-file` : 'file';
        const p = m.piece?.[0]?.toLowerCase() === 'q' ? 'queen' : 'rook';
        if (targets.length > 0) return `Puts ${your} ${p} on the half-open ${file}, aiming at ${his} weak pawn.`;
        return keys.length > 1
          ? `Puts ${your} ${p} on the half-open ${file}, toward ${his} king.`
          : `Puts ${your} ${p} on the open ${file}.`;
      }
      case 'pawn-break':
        if (m.subtype === 'king-attack') return `Pawn break that opens up ${his} king.`;
        if (m.subtype === 'opens-file') return `Pawn break that opens a file for ${your} rook.`;
        return 'Pawn break that opens up the position.';
      case 'winning-trade':
        return `Trades into an endgame ${mine ? "you're" : "he's"} winning.`;
      case 'stops-threat':
        return `Stops ${his} threat before it happens.`;
      default:
        return FALLBACK_WIN + '.';
    }
  } catch {
    return FALLBACK_WIN + '.';
  }
}

/** The threatened piece, from Moment.pieceInvolved ('r@d1'), only if the punishment's first move captures on that square. */
function threatenedPiece(m: Moment): { name: string; sq: string } | null {
  const [kind, sq] = (m.pieceInvolved ?? '').split('@');
  const name = NAMES[(kind ?? '').toLowerCase()];
  if (!name || !SQ.test(sq ?? '')) return null;
  return m.punishment?.uci?.[0]?.slice(2, 4) === sq ? { name, sq } : null;
}

/** The walkthrough's "what went wrong" paragraph. Never throws. */
export function momentExplanation(m: Moment, game: GameRecord): string {
  try {
    const pov: Color = game?.userColor ?? 'w';
    const opp = other(pov);
    const out: string[] = [];
    out.push(`You played ${m.playedSan || 'that move'}.`);
    if (m.mistakeType === 'ignored-threat') {
      const t = threatenedPiece(m);
      out.push(t
        ? `His last move attacked your ${t.name} on ${t.sq}, and you left it there.`
        : 'His last move made a threat, and you left it there.');
    }
    const pun = m.punishment;
    if (pun) {
      const san = pun.san?.[0];
      const what = pun.motif ? summarizeMotif(pun.motif, pov, opp) : FALLBACK_WIN + '.';
      const actual = game?.plies?.[m.ply]?.uci;
      const verb = m.punished
        ? (actual && actual === pun.uci?.[0] ? 'answered' : 'could have answered')
        : 'can answer';
      out.push(san ? `He ${verb} with ${san}. ${what}` : what);
    }
    const better = m.better;
    if (better) {
      const san = better.san?.[0];
      const what = better.motif ? summarizeMotif(better.motif, pov, pov)
        : (m.trigger === 'material' ? FALLBACK_KEPT : FALLBACK_BETTER) + '.';
      out.push(san ? `Better was ${san}. ${what}` : what);
    } else if (!pun) {
      out.push(m.winBefore >= 60 ? 'That gave away much of your advantage.' : 'That made your position much worse.');
    }
    if (!m.punished) out.push("He didn't take advantage, but next time someone will.");
    if (m.trigger === 'material' && (m.winBefore >= 90 || m.winBefore <= 10)) {
      out.push('The game was already decided, but this is a habit worth fixing.');
    }
    return out.join(' ');
  } catch {
    return `${FALLBACK_BETTER}.`;
  }
}

const moveNo = (ply: number) => Math.max(1, Math.ceil(ply / 2));

/** Collapsed text for a stretch of moves with nothing flagged. Plies are 1-based; shown as move numbers. */
export function calmSummary(moves: MoveEval[], fromPly: number, toPly: number): string {
  const range = `Moves ${moveNo(fromPly)}–${moveNo(toPly)}`;
  const rough = (moves ?? []).some((e) => e.ply >= fromPly && e.ply <= toPly && (e.label === 'inaccuracy' || e.label === 'blunder'));
  return `${range}: ${rough ? 'mostly fine' : 'solid'}.`;
}
