export type Color = 'w' | 'b';
export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'daily' | 'unknown';
export type Phase = 'opening' | 'middlegame' | 'endgame';
export interface PlyRecord { ply: number; san: string; uci: string; fenBefore: string; fenAfter: string; color: Color; clockSec: number | null }
export interface OpeningInfo { eco: string | null; name: string; family: string }
export interface GameRecord {
  id: string; headers: Record<string, string>; white: string; black: string;
  userColor: Color | null; result: '1-0' | '0-1' | '1/2-1/2' | '*';
  userResult: 'win' | 'loss' | 'draw' | null; timeClass: TimeClass; baseTimeSec: number | null;
  opening: OpeningInfo; plies: PlyRecord[]; date: string | null; url: string | null;
}
export interface SkippedGame { index: number; reason: 'variant' | 'daily' | 'too-short' | 'unparseable'; label: string }
export type Score = { cp: number } | { mate: number };
export interface EngineLine { multipv: number; score: Score; pv: string[]; depth: number }
export interface Engine {
  analyse(fen: string, opts: { depth: number; multiPv?: number }): Promise<EngineLine[]>;
  dispose(): void;
}
export type MotifType = 'mate' | 'fork' | 'pin' | 'skewer' | 'discovered-attack' | 'hanging-piece'
  | 'open-file' | 'pawn-break' | 'winning-trade' | 'stops-threat';
export interface Motif { type: MotifType; keySquares: string[]; targets: string[]; piece: string; mateIn?: number; recapture?: boolean; defended?: boolean; subtype?: 'king-attack' | 'opens-file' }
// subtype: pawn-break only — 'king-attack' (hits the enemy king's pawn shield) or 'opens-file' (opens a file for the rook)
// defended: hanging-piece only — the captured piece had a defender before the capture (a trade up, not a free piece)
// recapture: hanging-piece only — pv[0] captures on the to-square of ctx.prevMove
// targets: piece letters+squares, e.g. ['k@e8','r@a8']; piece: the moving piece, e.g. 'n@d5'
export interface LineContext { fen: string; pv: string[]; mover: Color; score: Score; prevMove?: string; gainFrom?: string }
// fen = position before pv[0]; mover = side playing pv[0]; score from mover's perspective at the root
// prevMove: UCI of the move that led to fen (optional)
// gainFrom: position whose material is the baseline for the mover's gain (default fen). A punishment line
// passes the position before the user's move, so taking back what the user just took is not "winning material".

export const ANALYSIS_VERSION = 5;
export type MistakeType = 'missed-mate' | 'missed-fork' | 'missed-pin' | 'missed-skewer' | 'missed-discovered-attack'
  | 'missed-free-material' | 'missed-positional' | 'ignored-threat' | 'hung-piece' | 'walked-into-tactic'
  | 'walked-into-mate' | 'unexplained';
export interface ExplainedLine { uci: string[]; san: string[]; stepNotes: string[]; motif: Motif | null; summary: string; userMoves: number }
export interface MoveEval { ply: number; san: string; byUser: boolean; winBefore: number; winAfter: number; drop: number; label: 'good' | 'inaccuracy' | 'blunder' | 'opponent' }
export interface Moment {
  ply: number; playedSan: string; fenBefore: string; winBefore: number; winAfter: number; drop: number;
  mistakeType: MistakeType; better: ExplainedLine | null; punishment: ExplainedLine | null;
  punished: boolean; explanation: string; phase: Phase; lowClock: boolean; pieceInvolved: string | null;
  trigger: 'swing' | 'material'; materialLost: number;
}
// trigger: 'swing' = win% drop >= FLAG_DROP; 'material' = a clear material blunder (often in an already
// decided game) that didn't swing the win% much. materialLost: material (pawns) the user's best line keeps
// over the played move, 6 plies on (0 when not measured).
export interface GameAnalysis { gameId: string; analysisVersion: number; moves: MoveEval[]; moments: Moment[] }

export interface ExampleRef { gameId: string; ply: number }
export interface Weakness {
  key: string; kind: 'mistake-type' | 'repeated-situation'; title: string; summary: string;
  count: number; gamesDecided: number; cost: number; examples: ExampleRef[]; typical: ExampleRef;
}
export interface OpeningStat { family: string; color: Color; games: number; wins: number; losses: number; draws: number; moments: number }
export interface Report {
  gamesAnalysed: number; skippedCount: number; weaknesses: Weakness[];
  byPhase: Record<Phase, { count: number; cost: number }>;
  timeTrouble: { count: number; cost: number } | null; byOpening: OpeningStat[];
}
