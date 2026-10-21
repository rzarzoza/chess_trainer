import { Chess } from 'chess.js';
import type { Square, PieceSymbol } from 'chess.js';
import type { Color, Phase } from '../types';

export const PIECE_VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

function pieces(fen: string) {
  return new Chess(fen).board().flat().flatMap((p) => (p ? [p] : []));
}

export function materialBalance(fen: string, pov: Color): number {
  let sum = 0;
  for (const p of pieces(fen)) {
    if (p.type === 'k') continue;
    sum += p.color === pov ? PIECE_VALUE[p.type] : -PIECE_VALUE[p.type];
  }
  return sum;
}

export function nonPawnMaterial(fen: string): number {
  return pieces(fen).reduce((s, p) => (p.type === 'p' || p.type === 'k' ? s : s + PIECE_VALUE[p.type]), 0);
}

export function phaseOf(fen: string, ply: number): Phase {
  if (nonPawnMaterial(fen) <= 26) return 'endgame';
  return ply <= 24 ? 'opening' : 'middlegame';
}

export function isHanging(fen: string, square: Square): boolean {
  const chess = new Chess(fen);
  const piece = chess.get(square);
  if (!piece || piece.type === 'k') return false;
  const enemy = chess.attackers(square, other(piece.color));
  if (enemy.length === 0) return false;
  const value = PIECE_VALUE[piece.type];
  if (enemy.some((sq) => PIECE_VALUE[chess.get(sq)!.type] < value)) return true;
  return chess.attackers(square, piece.color).length === 0;
}

export function attackedTargets(fen: string, from: Square): Square[] {
  const chess = new Chess(fen);
  const piece = chess.get(from);
  if (!piece) return [];
  const out: Square[] = [];
  for (const row of chess.board()) {
    for (const t of row) {
      if (t && t.color !== piece.color && chess.attackers(t.square, piece.color).includes(from)) out.push(t.square);
    }
  }
  return out;
}

export function replayLine(fen: string, uci: string[]): { fens: string[]; sans: string[] } {
  const chess = new Chess(fen);
  const fens = [fen];
  const sans: string[] = [];
  for (const m of uci) {
    try {
      const mv = chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
      sans.push(mv.san);
      fens.push(chess.fen());
    } catch {
      break;
    }
  }
  return { fens, sans };
}

export function nullMoveFen(fen: string): string | null {
  if (new Chess(fen).isCheck()) return null;
  const f = fen.split(' ');
  f[1] = f[1] === 'w' ? 'b' : 'w';
  f[3] = '-';
  return f.join(' ');
}
