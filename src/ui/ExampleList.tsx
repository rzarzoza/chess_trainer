import { useMemo } from 'react';
import type { ExampleRef, GameAnalysis, GameRecord, Weakness } from '../types';
import { makeBoardLookup, moveNumber, opponentOf, resultWord, timeClassLabel } from './appHelpers';
import { MiniBoard } from './MiniBoard';

export interface ExampleListProps {
  weakness: Weakness;
  games: GameRecord[];
  analyses: Map<string, GameAnalysis>;
  onOpen(ref: ExampleRef): void;
  onBack?(): void;
}

/** Every example of one weakness: a mini board, the opponent, time class, move number and result per row. */
export function ExampleList({ weakness, games, analyses, onOpen, onBack }: ExampleListProps) {
  const boardFor = useMemo(() => makeBoardLookup(games, analyses), [games, analyses]);
  const byId = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  return (
    <section className="examples">
      {onBack && <button type="button" className="secondary-btn" onClick={onBack}>← Back to report</button>}
      <h2>{weakness.title}</h2>
      <p className="muted">{weakness.summary}</p>
      <ul className="example-list">
        {weakness.examples.map((ref) => {
          const game = byId.get(ref.gameId);
          if (!game) return null;
          const board = boardFor(ref);
          const facts = [timeClassLabel(game), `move ${moveNumber(ref.ply)}`, resultWord(game)].filter(Boolean);
          return (
            <li key={`${ref.gameId}:${ref.ply}`}>
              <button type="button" className="example-row" onClick={() => onOpen(ref)}>
                {board && <MiniBoard {...board} size={110} />}
                <span className="example-info">
                  <span className="example-opp">vs. {opponentOf(game)}</span>
                  <span className="muted">{facts.join(' · ')}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
