import type { ExampleRef, Weakness } from '../types';
import { MiniBoard, type MiniBoardProps } from './MiniBoard';

export type BoardInfo = Omit<MiniBoardProps, 'size'>;

export interface WeaknessCardProps {
  rank: number;
  weakness: Weakness;
  maxCost: number;
  board: BoardInfo | null;
  onOpenExamples(key: string): void;
  onOpenExample(ref: ExampleRef): void;
}

export function WeaknessCard({ rank, weakness, maxCost, board, onOpenExamples, onOpenExample }: WeaknessCardProps) {
  const pct = maxCost > 0 ? Math.round((weakness.cost / maxCost) * 100) : 0;
  return (
    <article className="weakness">
      {board && (
        <button
          type="button"
          className="weakness-board"
          aria-label={`Open a typical example of ${weakness.title}`}
          onClick={() => onOpenExample(weakness.typical)}
        >
          <MiniBoard {...board} size={150} />
        </button>
      )}
      <div className="weakness-info">
        <h3>{rank}. {weakness.title}</h3>
        <div className="cost-bar" aria-hidden="true">
          <div className="cost-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="weakness-summary">{weakness.summary}</p>
        <button type="button" className="link" onClick={() => onOpenExamples(weakness.key)}>
          See all {weakness.count} examples →
        </button>
      </div>
    </article>
  );
}
