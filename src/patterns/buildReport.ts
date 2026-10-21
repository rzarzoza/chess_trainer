import type {
  Color, ExampleRef, GameAnalysis, GameRecord, MistakeType, Moment, OpeningStat, Phase, Report, TimeClass, Weakness,
} from '../types';
import { FLAG_DROP } from '../analysis/winprob';

const TITLES: Record<Exclude<MistakeType, 'unexplained'>, string> = {
  'missed-mate': 'Missed checkmates',
  'missed-fork': 'Missed forks',
  'missed-pin': 'Missed pins',
  'missed-skewer': 'Missed skewers',
  'missed-discovered-attack': 'Missed discovered attacks',
  'missed-free-material': 'Not taking free material',
  'missed-positional': 'Missed strong positional moves',
  'ignored-threat': "Not checking what your opponent's last move attacks",
  'hung-piece': 'Leaving pieces hanging',
  'walked-into-tactic': 'Walking into tactics',
  'walked-into-mate': 'Walking into checkmate',
};
const PIECES: Record<string, string> = { n: 'knight', b: 'bishop', r: 'rook', q: 'queen', p: 'pawn', k: 'king' };
const PHASES: Phase[] = ['opening', 'middlegame', 'endgame'];

interface Item { game: GameRecord; m: Moment; cost: number; decided: boolean }

const colorName = (c: Color) => (c === 'w' ? 'White' : 'Black');
const fen4 = (fen: string) => fen.split(' ').slice(0, 4).join(' ');
const ref = (i: Item): ExampleRef => ({ gameId: i.game.id, ply: i.m.ply });
const itemId = (i: Item) => `${i.game.id}#${i.m.ply}`;

/**
 * Swing moments cost their win% drop; material moments (often in decided games) cost
 * 4 per pawn lost, capped below FLAG_DROP so they always rank under game-deciding swings.
 * Both are scaled down for longer lines.
 */
function momentCost(m: Moment): number {
  const userMoves = m.better ? m.better.userMoves : 1;
  const base = m.trigger === 'material' ? Math.min(FLAG_DROP - 1, 4 * m.materialLost) : m.drop;
  return base / (1 + 0.15 * (userMoves - 1));
}

/** The largest-drop moment of a lost game, if the user never got back above 50% afterwards ("the turning point"). */
export function decidingMoment(game: GameRecord, a: GameAnalysis): Moment | null {
  const swings = a.moments.filter((x) => x.trigger !== 'material'); // only swings decide a game
  if (game.userResult !== 'loss' || swings.length === 0) return null;
  const m = swings.reduce((best, x) => (x.drop > best.drop ? x : best));
  for (const mv of a.moves) {
    if (!mv.byUser) continue;
    if (mv.ply >= m.ply && mv.winAfter > 50) return null;
    if (mv.ply > m.ply && mv.winBefore > 50) return null;
  }
  return m;
}

function mostCommon<T>(values: T[], order?: T[]): T {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const keys = order ? order.filter((k) => counts.has(k)) : [...counts.keys()];
  return keys.reduce((best, k) => (counts.get(k)! > counts.get(best)! ? k : best));
}

function makeWeakness(
  key: string, kind: Weakness['kind'], title: string, items: Item[], summary: (decided: number) => string,
): Weakness {
  const decided = items.filter((i) => i.decided).length;
  const sorted = [...items].sort((a, b) => b.cost - a.cost);
  return {
    key, kind, title, summary: summary(decided), count: items.length, gamesDecided: decided,
    cost: items.reduce((s, i) => s + i.cost, 0) + 50 * decided,
    examples: sorted.map(ref), typical: ref(sorted[0]),
  };
}

function typeSummary(items: Item[], decided: number): string {
  const phase = mostCommon(items.map((i) => i.m.phase), PHASES);
  let s = `Happened ${items.length} times`;
  if (decided > 0) s += ` · decided ${decided} of your losses`;
  s += ` · mostly in the ${phase}`;
  const letters = items.map((i) => i.m.pieceInvolved?.split('@')[0].toLowerCase()).filter((l): l is string => !!l);
  if (letters.length > 0) {
    const top = mostCommon(letters);
    if (letters.filter((l) => l === top).length > items.length / 2 && PIECES[top]) {
      s += ` · usually with your ${PIECES[top]}`;
    }
  }
  return s;
}

export function buildReport(
  games: GameRecord[], analyses: GameAnalysis[], filter: TimeClass | 'all', skippedCount = 0,
): Report {
  const byId = new Map(analyses.map((a) => [a.gameId, a]));
  const pairs: { game: GameRecord; analysis: GameAnalysis }[] = [];
  for (const game of games) {
    if (filter !== 'all' && game.timeClass !== filter) continue;
    const analysis = byId.get(game.id);
    if (analysis) pairs.push({ game, analysis });
  }

  const items: Item[] = [];
  for (const { game, analysis } of pairs) {
    const decidedMoment = decidingMoment(game, analysis);
    for (const m of analysis.moments) {
      items.push({ game, m, cost: momentCost(m), decided: m === decidedMoment });
    }
  }

  const weaknesses: Weakness[] = [];

  // Mistake types
  for (const [type, title] of Object.entries(TITLES)) {
    const group = items.filter((i) => i.m.mistakeType === type);
    if (group.length < 2) continue;
    weaknesses.push(makeWeakness(`type:${type}`, 'mistake-type', title, group, (d) => typeSummary(group, d)));
  }

  // (a) Same position, same mistake
  const claimed = new Set<string>();
  const byPos = new Map<string, Item[]>();
  for (const i of items) {
    if (!i.game.userColor) continue;
    const k = fen4(i.m.fenBefore);
    const list = byPos.get(k);
    if (list) list.push(i);
    else byPos.set(k, [i]);
  }
  for (const [k, bucket] of byPos) {
    const byType = new Map<string, Item[]>();
    for (const i of bucket) {
      if (i.m.mistakeType === 'unexplained') continue;
      const list = byType.get(i.m.mistakeType);
      if (list) list.push(i);
      else byType.set(i.m.mistakeType, [i]);
    }
    let best: { group: Item[]; nGames: number; cost: number } | null = null;
    for (const group of byType.values()) {
      const nGames = new Set(group.map((i) => i.game.id)).size;
      if (nGames < 2) continue;
      const cost = group.reduce((t, i) => t + i.cost, 0);
      if (!best || nGames > best.nGames || (nGames === best.nGames && cost > best.cost)) best = { group, nGames, cost };
    }
    if (!best) continue;
    const { group, nGames } = best;
    group.forEach((i) => claimed.add(itemId(i)));
    const first = group[0].game;
    const reached = pairs.filter(({ game }) =>
      game.userColor === first.userColor
      && game.plies.some((p) => p.color === game.userColor && fen4(p.fenBefore) === k)).length;
    const summary = reached <= nGames
      ? `You reached this position in ${nGames} games and made the same kind of mistake each time.`
      : `You reached this position in ${reached} games and made the same kind of mistake in ${nGames} of them.`;
    weaknesses.push(makeWeakness(
      `pos:${k}`, 'repeated-situation',
      `Same position, same mistake (${first.opening.family} as ${colorName(first.userColor!)})`, group,
      () => summary,
    ));
  }

  // (b) Same opening, same kind of mistake
  const gamesPer = new Map<string, number>();
  for (const { game } of pairs) {
    if (!game.userColor) continue;
    const k = `${game.opening.family}:${game.userColor}`;
    gamesPer.set(k, (gamesPer.get(k) ?? 0) + 1);
  }
  const byOpen = new Map<string, Item[]>();
  for (const i of items) {
    if (!i.game.userColor || i.m.phase !== 'opening' || i.m.mistakeType === 'unexplained') continue;
    if (claimed.has(itemId(i))) continue;
    const k = `open:${i.game.opening.family}:${i.game.userColor}:${i.m.mistakeType}`;
    const list = byOpen.get(k);
    if (list) list.push(i);
    else byOpen.set(k, [i]);
  }
  for (const [k, group] of byOpen) {
    const nGames = new Set(group.map((i) => i.game.id)).size;
    if (nGames < 3) continue;
    const { opening, userColor } = group[0].game;
    const title = TITLES[group[0].m.mistakeType as keyof typeof TITLES];
    weaknesses.push(makeWeakness(
      k, 'repeated-situation', `${opening.family} as ${colorName(userColor!)}`, group,
      () => `You played it ${gamesPer.get(`${opening.family}:${userColor}`)} times. In ${nGames} of them: ${title.toLowerCase()}.`,
    ));
  }

  weaknesses.sort((a, b) => b.cost - a.cost);

  const byPhase = Object.fromEntries(PHASES.map((p) => [p, { count: 0, cost: 0 }])) as Report['byPhase'];
  for (const i of items) {
    if (i.m.mistakeType === 'unexplained') continue; // shown on no card, so not counted as a mistake either
    byPhase[i.m.phase].count += 1;
    byPhase[i.m.phase].cost += i.cost;
  }

  const hasClocks = pairs.some(({ game }) => game.plies.some((p) => p.clockSec !== null));
  let timeTrouble: Report['timeTrouble'] = null;
  if (hasClocks) {
    const low = items.filter((i) => i.m.lowClock);
    timeTrouble = { count: low.length, cost: low.reduce((s, i) => s + i.cost, 0) };
  }

  const openings = new Map<string, OpeningStat>();
  for (const { game, analysis } of pairs) {
    if (!game.userColor) continue;
    const k = `${game.opening.family}:${game.userColor}`;
    const st = openings.get(k) ?? {
      family: game.opening.family, color: game.userColor, games: 0, wins: 0, losses: 0, draws: 0, moments: 0,
    };
    st.games += 1;
    if (game.userResult === 'win') st.wins += 1;
    else if (game.userResult === 'loss') st.losses += 1;
    else if (game.userResult === 'draw') st.draws += 1;
    st.moments += analysis.moments.filter((m) => m.mistakeType !== 'unexplained').length;
    openings.set(k, st);
  }

  return {
    gamesAnalysed: pairs.length, skippedCount, weaknesses, byPhase, timeTrouble,
    byOpening: [...openings.values()].sort((a, b) => b.games - a.games),
  };
}
