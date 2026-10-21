import { describe, expect, it } from 'vitest';
import { parseOpening } from '../../src/pgn/opening';

describe('parseOpening', () => {
  it('derives the family from the ECOUrl slug (Italian)', () => {
    const o = parseOpening({ ECOUrl: 'https://www.chess.com/openings/Italian-Game-Two-Knights-Defense-Modern-Bishops-Opening' }, []);
    expect(o.family).toBe('Italian Game');
  });
  it('derives the family from the ECOUrl slug (Sicilian)', () => {
    const o = parseOpening({ ECOUrl: 'https://www.chess.com/openings/Sicilian-Defense-Najdorf-Variation' }, []);
    expect(o.family).toBe('Sicilian Defense');
  });
  it('strips trailing move sequences from the slug', () => {
    const o = parseOpening({ ECO: 'B90', ECOUrl: 'https://www.chess.com/openings/Sicilian-Defense-Najdorf-Variation-6.Be3-e5' }, []);
    expect(o.name).toBe('Sicilian Defense Najdorf Variation');
    expect(o.eco).toBe('B90');
  });
  it('falls back to the first 4 SANs when there are no headers', () => {
    const o = parseOpening({}, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']);
    expect(o.family).toBe('1.e4 e5 2.Nf3 Nc6');
    expect(o.eco).toBeNull();
  });
  it('shortens long keyword families to the first two words', () => {
    expect(parseOpening({ ECOUrl: 'https://www.chess.com/openings/Ruy-Lopez-Morphy-Defense' }, []).family).toBe('Ruy Lopez');
    expect(parseOpening({ ECOUrl: 'https://www.chess.com/openings/Ruy-Lopez-Berlin-Defense' }, []).family).toBe('Ruy Lopez');
    expect(parseOpening({ ECOUrl: 'https://www.chess.com/openings/Kings-Indian-Defense' }, []).family).toBe('Kings Indian Defense');
  });
  it('does not throw on a malformed percent escape in the slug', () => {
    const o = parseOpening({ ECOUrl: 'https://www.chess.com/openings/Italian-Game-%E0%A4%A' }, []);
    expect(o.family).toBe('Italian Game');
  });
  it('merges Chess.com\'s alternative names into one family', () => {
    const fam = (slug: string) => parseOpening({ ECOUrl: `https://www.chess.com/openings/${slug}` }, []).family;
    expect(fam('Giuoco-Piano-Game')).toBe('Italian Game');
    expect(fam('Giuoco-Piano-Game-Main-Line')).toBe('Italian Game');
    expect(fam('Ruy-Lopez-Opening')).toBe('Ruy Lopez');
    expect(fam('Ruy-Lopez-Opening-Morphy-Defense-Closed')).toBe('Ruy Lopez');
    expect(parseOpening({ Opening: 'Giuoco Piano' }, []).family).toBe('Italian Game');
    expect(fam('Italian-Game')).toBe('Italian Game');
  });
});
