// Threshold tuning report: runs analyzeGame on real games with a Node Stockfish and prints
// moments per game and the mistake-type histogram for a sweep of FLAG_DROP values.
//
//   npm run tune -- tests/fixtures/user-games.pgn [--user neymessiz] [--drops 12,14,...,25]
//                   [--classes rapid,blitz] [--max 40] [--spot 10] [--spot-drop 18] [--spot-trigger material] [--seed 1]
//   npm run tune -- --fetch neymessiz [--max-games 60]   (downloads to tests/fixtures/user-games.pgn)
//
// Engine results are memoised on disk (see MEMO below), so re-runs only search new positions.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_WIN_BEFORE, analyzeGame } from '../src/analysis/analyzeGame';
import { FLAG_DROP } from '../src/analysis/winprob';
import { fetchRecentPgn } from '../src/import/chesscom';
import { parseGames } from '../src/pgn/parseGames';
import type { GameRecord, Moment } from '../src/types';
import { createNodeEngine, withDiskMemo } from './nodeEngine';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MEMO = `${ROOT}node_modules/.cache/chess-trainer/engine-memo.json`;
const DEFAULT_PGN = `${ROOT}tests/fixtures/user-games.pgn`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Small deterministic PRNG so spot-check picks are reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const fetchUser = arg('fetch');
  if (fetchUser) {
    const pgn = await fetchRecentPgn(fetchUser, { maxGames: Number(arg('max-games') ?? 60) });
    mkdirSync(dirname(DEFAULT_PGN), { recursive: true });
    writeFileSync(DEFAULT_PGN, pgn);
    console.log(`Saved ${pgn.split('[Event ').length - 1} games to ${DEFAULT_PGN}`);
    return;
  }

  const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : DEFAULT_PGN;
  const user = arg('user') ?? 'neymessiz';
  const classes = (arg('classes') ?? 'rapid,blitz').split(',');
  const drops = (arg('drops') ?? '12,13,14,15,16,17,18,19,20,21,22,23,24,25').split(',').map(Number);
  const max = Number(arg('max') ?? 1000);
  const spot = Number(arg('spot') ?? 0);
  const spotDrop = Number(arg('spot-drop') ?? FLAG_DROP);
  const spotTrigger = arg('spot-trigger'); // 'swing' | 'material' | undefined (both)

  const { games: all, skipped } = parseGames(readFileSync(file, 'utf8'), user);
  const games = all.filter((g) => g.userColor && classes.includes(g.timeClass)).slice(0, max);
  console.log(`${file}: ${all.length} parsed, ${skipped.length} skipped, using ${games.length} (${classes.join('+')})`);
  const byClass = new Map<string, number>();
  for (const g of games) byClass.set(g.timeClass, (byClass.get(g.timeClass) ?? 0) + 1);
  console.log(`  by class: ${[...byClass].map(([k, v]) => `${k}=${v}`).join(' ')}; as White=${games.filter((g) => g.userColor === 'w').length}, as Black=${games.filter((g) => g.userColor === 'b').length}`);

  const engine = withDiskMemo(await createNodeEngine(), MEMO);
  const results = new Map<number, { game: GameRecord; moments: Moment[]; candidates: number }[]>();
  try {
    // Lowest threshold first: it searches a superset of the later candidates.
    for (const drop of [...drops].sort((a, b) => a - b)) {
      const t0 = Date.now();
      const out: { game: GameRecord; moments: Moment[]; candidates: number }[] = [];
      for (const [gi, game] of games.entries()) {
        const a = await analyzeGame(game, engine, { flagDrop: drop });
        // Same rule as analyzeGame's pass-1 swing-candidate test (before the deep look and the findable filter).
        const candidates = a.moves.filter((m) => m.byUser && m.drop >= drop && m.winBefore >= MIN_WIN_BEFORE).length;
        out.push({ game, moments: a.moments, candidates });
        if (engine.misses > 0) process.stderr.write(`\r  drop ${drop}: game ${gi + 1}/${games.length} (engine misses ${engine.misses})   `);
      }
      engine.flush();
      process.stderr.write(`\r  drop ${drop}: done in ${((Date.now() - t0) / 1000).toFixed(0)}s${' '.repeat(30)}\n`);
      results.set(drop, out);
    }
  } finally {
    engine.dispose();
  }

  console.log('\nFLAG_DROP | swing cand/game | all: mean median max | swing: mean median | material: mean median | histogram');
  for (const drop of drops) {
    const out = results.get(drop)!;
    const per = (pred: (m: Moment) => boolean) => out.map((r) => r.moments.filter(pred).length);
    const all = per(() => true);
    const sw = per((m) => m.trigger === 'swing');
    const mat = per((m) => m.trigger === 'material');
    const hist = new Map<string, number>();
    for (const r of out) for (const m of r.moments) {
      const k = `${m.mistakeType}${m.trigger === 'material' ? '(m)' : ''}`;
      hist.set(k, (hist.get(k) ?? 0) + 1);
    }
    const h = [...hist].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ');
    console.log(`${String(drop).padStart(9)} | ${mean(out.map((r) => r.candidates)).toFixed(2).padStart(15)} | ${mean(all).toFixed(2)} ${median(all).toFixed(1)} ${Math.max(...all)} | ${mean(sw).toFixed(2)} ${median(sw).toFixed(1)} | ${mean(mat).toFixed(2)} ${median(mat).toFixed(1)} | ${h}`);
  }

  if (spot > 0 && results.has(spotDrop)) {
    const pool = results.get(spotDrop)!.flatMap((r) => r.moments.filter((m) => !spotTrigger || m.trigger === spotTrigger).map((m) => ({ game: r.game, m })));
    const rand = rng(Number(arg('seed') ?? 1));
    const picks: typeof pool = [];
    while (picks.length < Math.min(spot, pool.length)) {
      const c = pool[Math.floor(rand() * pool.length)];
      if (!picks.includes(c)) picks.push(c);
    }
    console.log(`\n── ${picks.length} random moments at FLAG_DROP=${spotDrop} ──`);
    for (const { game, m } of picks) {
      console.log(JSON.stringify({
        game: game.url ?? game.id, user: game.userColor, ply: m.ply, fenBefore: m.fenBefore, played: m.playedSan,
        win: `${m.winBefore.toFixed(0)}->${m.winAfter.toFixed(0)}`, type: m.mistakeType, trigger: m.trigger, materialLost: m.materialLost, piece: m.pieceInvolved, punished: m.punished,
        better: m.better && { san: m.better.san.join(' '), motif: m.better.motif?.type ?? null, summary: m.better.summary, notes: m.better.stepNotes },
        punishment: m.punishment && { san: m.punishment.san.join(' '), motif: m.punishment.motif?.type ?? null, summary: m.punishment.summary, notes: m.punishment.stepNotes },
        explanation: m.explanation,
      }, null, 1));
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
