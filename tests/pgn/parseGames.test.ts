import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGames, withUserColor } from '../../src/pgn/parseGames';

const USER = 'fixture_user';
const sample = readFileSync('tests/fixtures/sample.pgn', 'utf8');
const bad = readFileSync('tests/fixtures/bad.pgn', 'utf8');

describe('parseGames', () => {
  it('parses three games', () => {
    const { games, skipped } = parseGames(sample, USER);
    expect(skipped).toEqual([]);
    expect(games.length).toBe(3);
    expect(games[0].userColor).toBe('w');
    expect(games[1].userColor).toBe('b');
    expect(games.map((g) => g.timeClass)).toEqual(['rapid', 'blitz', 'bullet']);
    expect(games.map((g) => g.userResult)).toEqual(['win', 'win', 'win']);
    expect(games[0].plies[0].san).toBe('e4');
    expect(typeof games[0].plies[0].clockSec).toBe('number');
    expect(games[0].plies[0].clockSec).toBeCloseTo(599, 0);
    expect(games[0].plies[0].uci).toBe('e2e4');
    expect(games[0].plies[1].color).toBe('b');
    expect(games[0].baseTimeSec).toBe(600);
    expect(games[0].date).toBe('2026-03-14');
    expect(games[0].url).toBe('https://www.chess.com/game/live/100000001');
    expect(games[0].opening.family).toBe('Italian Game');
    expect(games[0].opening.eco).toBe('C54');
    expect(games[0].plies[1].fenBefore).toBe(games[0].plies[0].fenAfter);
  });

  it('gives a stable id across parses and distinct ids per game', () => {
    const a = parseGames(sample, USER).games.map((g) => g.id);
    const b = parseGames(sample, USER).games.map((g) => g.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
  });

  it('username match is case-insensitive', () => {
    const { games } = parseGames(sample, USER.toUpperCase());
    expect(games.map((g) => g.userColor)).toEqual(['w', 'b', 'w']);
  });

  it('unknown username gives null userColor and null userResult', () => {
    const { games } = parseGames(sample, 'somebody_else');
    expect(games.every((g) => g.userColor === null && g.userResult === null)).toBe(true);
    expect(parseGames(sample, null).games[0].userColor).toBeNull();
  });

  it('withUserColor sets the side and recomputes the result', () => {
    const g = parseGames(sample, null).games[0];
    expect(withUserColor(g, 'w').userResult).toBe('win');
    expect(withUserColor(g, 'b').userResult).toBe('loss');
    expect(g.userColor).toBeNull();
  });

  it('skips bad games with reasons', () => {
    const { games, skipped } = parseGames(bad, USER);
    expect(games.length).toBe(0);
    expect(skipped.map((s) => s.reason)).toEqual(['variant', 'daily', 'too-short', 'unparseable']);
    expect(skipped.map((s) => s.index)).toEqual([0, 1, 2, 3]);
  });

  it('missing %clk gives clockSec null', () => {
    const text = '[White "a"]\n[Black "b"]\n[Result "1-0"]\n[TimeControl "600"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 1-0\n';
    const { games } = parseGames(text, 'a');
    expect(games.length).toBe(1);
    expect(games[0].plies.every((p) => p.clockSec === null)).toBe(true);
  });

  it('handles empty input', () => {
    expect(parseGames('', USER)).toEqual({ games: [], skipped: [] });
  });
});
