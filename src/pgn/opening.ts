import type { OpeningInfo } from '../types';

const FAMILY_END = new Set(['Game', 'Opening', 'Defense', 'Defence', 'Gambit', 'Attack', 'System']);

/** Words of an opening slug/name, with trailing move sequences ("3.Bc4", "4...Nf6") removed. */
function slugWords(slug: string): string[] {
  const words = slug.split(/[-\s]+/).filter(Boolean);
  const cut = words.findIndex((w) => /^\d+\.+/.test(w));
  return cut === -1 ? words : words.slice(0, cut);
}

/** Families Chess.com names two ways, merged so repeated-situation grouping sees one opening. */
const FAMILY_ALIAS: Record<string, string> = {
  'Giuoco Piano Game': 'Italian Game',
  'Giuoco Piano': 'Italian Game',
  'Ruy Lopez Opening': 'Ruy Lopez',
};
const alias = (family: string) => FAMILY_ALIAS[family] ?? family;

function familyFromWords(words: string[]): string {
  const end = words.findIndex((w) => FAMILY_END.has(w));
  if (end !== -1) {
    const kept = words.slice(0, Math.min(end + 1, 4));
    return (kept.length > 3 ? kept.slice(0, 2) : kept).join(' '); // "Ruy Lopez Morphy Defense" -> "Ruy Lopez"
  }
  return words.slice(0, 2).join(' '); // no keyword: first two words, e.g. "Ruy Lopez"
}

function formatMoves(sanMoves: string[]): string {
  return sanMoves
    .slice(0, 4)
    .map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}.${san}` : san))
    .join(' ');
}

export function parseOpening(headers: Record<string, string>, sanMoves: string[]): OpeningInfo {
  const eco = headers.ECO && headers.ECO !== '?' ? headers.ECO : null;

  const url = headers.ECOUrl;
  if (url) {
    const rawSlug = url.split('?')[0].replace(/\/+$/, '').split('/').pop() ?? '';
    let slug = rawSlug;
    try {
      slug = decodeURIComponent(rawSlug);
    } catch {
      /* malformed escape: keep the raw slug */
    }
    const words = slugWords(slug);
    if (words.length > 0) return { eco, name: words.join(' '), family: alias(familyFromWords(words)) };
  }

  const named = headers.Opening;
  if (named && named !== '?') {
    const family = named.split(/[:,]/)[0].trim();
    return { eco, name: named, family: alias(family || named) };
  }

  const moves = formatMoves(sanMoves);
  if (moves) return { eco, name: moves, family: moves };
  return { eco, name: 'Unknown opening', family: 'Unknown opening' };
}
