import { Chess } from 'chess.js';
import type { Color, GameRecord, PlyRecord, SkippedGame, TimeClass } from '../types';
import { parseOpening } from './opening';

const MIN_PLIES = 6;

interface RawGame { headerLines: string[]; moveText: string | null }

/** FNV-1a 64-bit, hex. Synchronous and dependency-free; ids only need to be stable and collision-resistant enough. */
function hashId(input: string): string {
  const mask = (1n << 64n) - 1n;
  let h = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(input)) {
    h ^= BigInt(byte);
    h = (h * 0x100000001b3n) & mask;
  }
  return h.toString(16).padStart(16, '0');
}

/** Split a file into games. Headers start a game; a following text block is its movetext; any other text is its own (garbage) entry. */
function splitGames(text: string): RawGame[] {
  const games: RawGame[] = [];
  let current: RawGame | null = null;
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  for (const raw of blocks) {
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    let i = 0;
    while (i < lines.length && /^\[\s*\w+\s+".*"\s*\]$/.test(lines[i])) i++;
    const headerLines = lines.slice(0, i);
    const rest = lines.slice(i).join(' ');
    if (headerLines.length > 0) {
      current = { headerLines, moveText: rest || null };
      games.push(current);
    } else if (current && current.moveText === null) {
      current.moveText = rest;
    } else {
      current = { headerLines: [], moveText: rest };
      games.push(current);
      current = null;
    }
  }
  return games;
}

function parseHeaders(lines: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const m = /^\[\s*(\w+)\s+"(.*)"\s*\]$/.exec(line);
    if (m) headers[m[1]] = m[2].replace(/\\(["\\])/g, '$1');
  }
  return headers;
}

/** Clock for each move token in order (null when absent). Variations and NAGs are ignored. */
function extractClocks(moveText: string): (number | null)[] {
  const clocks: (number | null)[] = [];
  const tokens = moveText.match(/\{[^}]*\}|\([^)]*\)|\$\d+|\d+\.+|1-0|0-1|1\/2-1\/2|\*|[^\s{}()]+/g) ?? [];
  for (const t of tokens) {
    if (t.startsWith('{')) {
      const m = /\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/.exec(t);
      if (m && clocks.length > 0 && clocks[clocks.length - 1] === null) {
        clocks[clocks.length - 1] = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      }
    } else if (t.startsWith('(') || t.startsWith('$') || /^\d+\.+$/.test(t) || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) {
      continue;
    } else {
      clocks.push(null);
    }
  }
  return clocks;
}

function timeInfo(tc: string | undefined): { timeClass: TimeClass; baseTimeSec: number | null; daily: boolean } {
  if (!tc || tc === '-' || tc === '?') return { timeClass: 'unknown', baseTimeSec: null, daily: false };
  if (tc.includes('/')) return { timeClass: 'daily', baseTimeSec: null, daily: true };
  const m = /^(\d+)(?:\+(\d+))?$/.exec(tc.trim());
  if (!m) return { timeClass: 'unknown', baseTimeSec: null, daily: false };
  const base = Number(m[1]);
  const est = base + 40 * Number(m[2] ?? 0);
  const timeClass: TimeClass = est < 180 ? 'bullet' : est < 600 ? 'blitz' : 'rapid';
  return { timeClass, baseTimeSec: base, daily: false };
}

function isVariant(h: Record<string, string>): boolean {
  const v = h.Variant?.trim().toLowerCase();
  if (v && v !== 'standard' && v !== 'chess') return true;
  return h.SetUp === '1' || (h.FEN !== undefined && h.FEN !== '');
}

function computeUserResult(result: GameRecord['result'], color: Color | null): GameRecord['userResult'] {
  if (!color || result === '*') return null;
  if (result === '1/2-1/2') return 'draw';
  return (result === '1-0') === (color === 'w') ? 'win' : 'loss';
}

function findUserColor(white: string, black: string, username: string | null): Color | null {
  const u = username?.trim().toLowerCase();
  if (!u) return null;
  if (white.trim().toLowerCase() === u) return 'w';
  if (black.trim().toLowerCase() === u) return 'b';
  return null;
}

function label(h: Record<string, string>, index: number): string {
  if (h.White || h.Black) return `${h.White ?? '?'} vs ${h.Black ?? '?'}${h.Date ? ` (${h.Date})` : ''}`;
  return `Game ${index + 1}`;
}

export function parseGames(pgnText: string, username: string | null): { games: GameRecord[]; skipped: SkippedGame[] } {
  const games: GameRecord[] = [];
  const skipped: SkippedGame[] = [];

  splitGames(pgnText).forEach((raw, index) => {
    const headers = parseHeaders(raw.headerLines);
    const skip = (reason: SkippedGame['reason']) => skipped.push({ index, reason, label: label(headers, index) });

    if (isVariant(headers)) return skip('variant');
    const time = timeInfo(headers.TimeControl);
    if (time.daily) return skip('daily');
    if (raw.headerLines.length === 0 || !raw.moveText) return skip('unparseable');

    const chess = new Chess();
    try {
      chess.loadPgn(`${raw.headerLines.join('\n')}\n\n${raw.moveText}`);
    } catch {
      return skip('unparseable');
    }
    const history = chess.history({ verbose: true });
    if (history.length === 0) return skip('unparseable');
    if (history.length < MIN_PLIES) return skip('too-short');

    const clocks = extractClocks(raw.moveText);
    const useClocks = clocks.length === history.length;
    const plies: PlyRecord[] = history.map((m, i) => ({
      ply: i + 1,
      san: m.san,
      uci: m.from + m.to + (m.promotion ?? ''),
      fenBefore: m.before,
      fenAfter: m.after,
      color: m.color,
      clockSec: useClocks ? clocks[i] : null,
    }));

    const white = headers.White ?? '';
    const black = headers.Black ?? '';
    const result = (['1-0', '0-1', '1/2-1/2'] as const).find((r) => r === headers.Result) ?? '*';
    const userColor = findUserColor(white, black, username);
    const sans = plies.map((p) => p.san);
    const rawUrl = headers.Link ?? headers.Site ?? '';
    const date = headers.Date && !headers.Date.includes('?') ? headers.Date.replace(/\./g, '-') : null;

    games.push({
      id: hashId([headers.Site ?? '', headers.Link ?? '', headers.Date ?? '', white, black, sans.join(' ')].join('|')),
      headers,
      white,
      black,
      userColor,
      result,
      userResult: computeUserResult(result, userColor),
      timeClass: time.timeClass,
      baseTimeSec: time.baseTimeSec,
      opening: parseOpening(headers, sans),
      plies,
      date,
      url: /^https?:\/\//.test(rawUrl) ? rawUrl : null,
    });
  });

  return { games, skipped };
}

export function withUserColor(game: GameRecord, color: Color): GameRecord {
  return { ...game, userColor: color, userResult: computeUserResult(game.result, color) };
}
