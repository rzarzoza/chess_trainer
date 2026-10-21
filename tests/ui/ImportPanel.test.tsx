// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ImportError } from '../../src/import/chesscom';
import { parseGames } from '../../src/pgn/parseGames';
import { ImportPanel, WhichOneIsYou } from '../../src/ui/ImportPanel';
import { applyUserName } from '../../src/ui/appHelpers';

afterEach(cleanup);

const pgn = (white: string, black: string) => `[Event "x"]
[White "${white}"]
[Black "${black}"]
[Result "1-0"]
[TimeControl "600"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 1-0
`;

describe('ImportPanel', () => {
  it('ImportPanel shows not-found message', async () => {
    const fetchPgn = vi.fn().mockRejectedValue(new ImportError('not-found'));
    const onImport = vi.fn();
    render(<ImportPanel onImport={onImport} fetchPgn={fetchPgn} />);
    fireEvent.change(screen.getByLabelText('Chess.com username'), { target: { value: '  nobody  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fetch my games' }));
    expect(await screen.findByText('No Chess.com user with that name.')).toBeInTheDocument();
    expect(fetchPgn).toHaveBeenCalledWith('nobody');
    expect(onImport).not.toHaveBeenCalled();
  });

  it('disables fetch when the username is blank', () => {
    const fetchPgn = vi.fn();
    render(<ImportPanel onImport={vi.fn()} fetchPgn={fetchPgn} />);
    fireEvent.change(screen.getByLabelText('Chess.com username'), { target: { value: '   ' } });
    const btn = screen.getByRole('button', { name: 'Fetch my games' });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(fetchPgn).not.toHaveBeenCalled();
  });

  it('passes fetched PGN and username on success', async () => {
    const onImport = vi.fn();
    render(<ImportPanel onImport={onImport} fetchPgn={vi.fn().mockResolvedValue('PGN')} />);
    fireEvent.change(screen.getByLabelText('Chess.com username'), { target: { value: 'Alice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fetch my games' }));
    await vi.waitFor(() => expect(onImport).toHaveBeenCalledWith('PGN', 'Alice'));
  });

  it('disables the inputs while fetching', async () => {
    let release: (v: string) => void = () => {};
    const fetchPgn = vi.fn(() => new Promise<string>((r) => { release = r; }));
    const onImport = vi.fn();
    render(<ImportPanel onImport={onImport} fetchPgn={fetchPgn} />);
    fireEvent.change(screen.getByLabelText('Chess.com username'), { target: { value: 'Alice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fetch my games' }));
    expect(screen.getByLabelText('Chess.com username')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Choose a file' })).toBeDisabled();
    release('PGN');
    await vi.waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Chess.com username')).not.toBeDisabled();
  });

  it('unknown side prompt applies chosen name', () => {
    const { games } = parseGames(pgn('Alice', 'Bob') + '\n' + pgn('carol', 'ALICE') + '\n' + pgn('Dan', 'Eve'), null);
    expect(games.every((g) => g.userColor === null)).toBe(true);
    const onResolve = vi.fn();
    render(<WhichOneIsYou games={games} onResolve={onResolve} />);
    expect(screen.getByText('Which one is you?')).toBeInTheDocument();
    const names = screen.getAllByRole('button').map((b) => b.textContent);
    expect(names[0]).toBe('Alice');
    fireEvent.click(screen.getByRole('button', { name: 'Alice' }));
    const resolved = onResolve.mock.calls[0][0] as typeof games;
    expect(resolved.map((g) => g.userColor)).toEqual(['w', 'b', null]);
    expect(resolved[0].userResult).toBe('win');
    expect(resolved[1].userResult).toBe('loss');
    expect(applyUserName(games, 'alice').map((g) => g.userColor)).toEqual(['w', 'b', null]);
  });
});
