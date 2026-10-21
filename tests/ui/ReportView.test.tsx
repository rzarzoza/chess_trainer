// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Report, Weakness } from '../../src/types';

vi.mock('../../src/ui/MiniBoard', () => ({
  MiniBoard: (p: { fen: string }) => <div data-testid="miniboard">{p.fen}</div>,
}));

import { ReportView } from '../../src/ui/ReportView';

afterEach(cleanup);

const weakness = (key: string, title: string, summary: string, cost: number, count: number): Weakness => ({
  key, kind: 'mistake-type', title, summary, count, gamesDecided: 0, cost,
  examples: [{ gameId: 'g1', ply: 10 }], typical: { gameId: 'g1', ply: 10 },
});

const report = (over: Partial<Report> = {}): Report => ({
  gamesAnalysed: 12,
  skippedCount: 0,
  weaknesses: [
    weakness('type:missed-fork', 'Missed forks', 'Happened 5 times · mostly in the middlegame', 2, 5),
    weakness('type:hung-piece', 'Leaving pieces hanging', 'Happened 3 times · mostly in the opening', 1, 3),
  ],
  byPhase: { opening: { count: 3, cost: 1 }, middlegame: { count: 5, cost: 2 }, endgame: { count: 0, cost: 0 } },
  timeTrouble: { count: 2, cost: 0.5 },
  byOpening: [{ family: 'Italian Game', color: 'w', games: 4, wins: 2, losses: 1, draws: 1, moments: 6 }],
  ...over,
});

const props = () => ({
  filter: 'all' as const, onFilter: vi.fn(), onOpenExamples: vi.fn(), onOpenExample: vi.fn(),
  boardFor: () => ({ fen: '8/8/8/8/8/8/8/8 w - - 0 1', orientation: 'white' as const, highlight: [], good: [] }),
});

describe('ReportView', () => {
  it('ReportView renders weaknesses in order with summaries', () => {
    const p = props();
    render(<ReportView report={report()} {...p} />);
    expect(screen.getByText('12 games analysed')).toBeInTheDocument();
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles.indexOf('1. Missed forks')).toBeGreaterThanOrEqual(0);
    expect(titles.indexOf('1. Missed forks')).toBeLessThan(titles.indexOf('2. Leaving pieces hanging'));
    expect(screen.getByText('Happened 5 times · mostly in the middlegame')).toBeInTheDocument();
    expect(screen.getByText('Happened 3 times · mostly in the opening')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'See all 5 examples →' }));
    expect(p.onOpenExamples).toHaveBeenCalledWith('type:missed-fork');
    const bars = document.querySelectorAll<HTMLElement>('.cost-bar-fill');
    expect(bars[0].style.width).toBe('100%');
    expect(bars[1].style.width).toBe('50%');
  });

  it('filter chip click calls onFilter', () => {
    const p = props();
    render(<ReportView report={report()} {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Blitz' }));
    expect(p.onFilter).toHaveBeenCalledWith('blitz');
  });

  it('time trouble section hidden when null', () => {
    const p = props();
    const { rerender } = render(<ReportView report={report()} {...p} />);
    expect(screen.getByRole('heading', { name: 'Time trouble' })).toBeInTheDocument();
    rerender(<ReportView report={report({ timeTrouble: null })} {...p} />);
    expect(screen.queryByRole('heading', { name: 'Time trouble' })).not.toBeInTheDocument();
  });

  it('shows the skipped games count', () => {
    render(<ReportView report={report({ skippedCount: 3 })} {...props()} />);
    expect(screen.getByText("Skipped 3 games we can't analyse (variants, daily, or too short).")).toBeInTheDocument();
  });
});

describe('ReportView left-out games', () => {
  it('shows games where the user was not found next to the skipped count', () => {
    render(<ReportView report={report({ skippedCount: 1 })} leftOutCount={2} {...props()} />);
    expect(screen.getByText("Skipped 1 game we can't analyse (variants, daily, or too short).")).toBeInTheDocument();
    expect(screen.getByText("Left out 2 games where we couldn't find you among the players.")).toBeInTheDocument();
  });
});
