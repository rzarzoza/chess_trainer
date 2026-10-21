import { useId, type CSSProperties } from 'react';
import { Chessboard } from 'react-chessboard';

export interface MiniBoardProps {
  fen: string;
  orientation: 'white' | 'black';
  highlight?: string[];
  good?: string[];
  size?: number;
}

const BAD: CSSProperties = { boxShadow: 'inset 0 0 0 3px var(--bad)' };
const GOOD: CSSProperties = { boxShadow: 'inset 0 0 0 3px var(--good)' };

/** A small, non-interactive board. `highlight` squares get a red ring, `good` squares a green one. */
export function MiniBoard({ fen, orientation, highlight = [], good = [], size = 160 }: MiniBoardProps) {
  const id = useId();
  const squareStyles: Record<string, CSSProperties> = {};
  for (const sq of highlight) squareStyles[sq] = BAD;
  for (const sq of good) squareStyles[sq] = GOOD;
  return (
    <div className="mini-board" style={{ width: size, maxWidth: '100%' }}>
      <Chessboard
        options={{
          id: `mini${id.replace(/[^a-zA-Z0-9]/g, '')}`,
          position: fen,
          boardOrientation: orientation,
          squareStyles,
          allowDragging: false,
          allowDrawingArrows: false,
          showNotation: false,
          showAnimations: false,
        }}
      />
    </div>
  );
}
