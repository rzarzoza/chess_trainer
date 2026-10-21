import { useRef, useState, type DragEvent, type FormEvent } from 'react';
import { fetchRecentPgn, ImportError, type ImportErrorCode } from '../import/chesscom';
import type { GameRecord } from '../types';
import { applyUserName, frequentNames } from './appHelpers';

const IMPORT_MESSAGES: Record<ImportErrorCode, string> = {
  'not-found': 'No Chess.com user with that name.',
  'no-games': 'That account has no games yet.',
  'rate-limited': 'Chess.com is busy, try again in a minute.',
  network: "Couldn't reach Chess.com.",
};

const USERNAME_KEY = 'chess-trainer:last-username';

function loadUsername(): string {
  try { return localStorage.getItem(USERNAME_KEY) ?? ''; } catch { return ''; }
}
function saveUsername(name: string) {
  try { localStorage.setItem(USERNAME_KEY, name); } catch { /* storage unavailable */ }
}

export interface ImportPanelProps {
  /** Called with the PGN text and the username to match against (null when none was given). */
  onImport(pgnText: string, username: string | null): void;
  fetchPgn?: (username: string) => Promise<string>;
  /** An error from a later step (e.g. a file with no readable games). */
  error?: string | null;
}

export function ImportPanel({ onImport, fetchPgn = (u) => fetchRecentPgn(u), error = null }: ImportPanelProps) {
  const [username, setUsername] = useState(loadUsername);
  const [pgnUsername, setPgnUsername] = useState(loadUsername);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const trimmed = username.trim();

  async function onFetch(e: FormEvent) {
    e.preventDefault();
    if (!trimmed || loading) return;
    setLoading(true);
    setMessage(null);
    try {
      const pgn = await fetchPgn(trimmed);
      saveUsername(trimmed);
      onImport(pgn, trimmed);
    } catch (err) {
      setMessage(err instanceof ImportError ? IMPORT_MESSAGES[err.code] : IMPORT_MESSAGES.network);
    } finally {
      setLoading(false);
    }
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setMessage("Couldn't read that file.");
      return;
    }
    const name = pgnUsername.trim();
    if (name) saveUsername(name);
    onImport(text, name || null);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (!loading) void readFile(e.dataTransfer.files[0]);
  }

  const shown = message ?? error;

  return (
    <section className="import">
      <form className="panel" onSubmit={onFetch}>
        <h2>From Chess.com</h2>
        <label htmlFor="cc-username">Chess.com username</label>
        <div className="input-row">
          <input
            id="cc-username"
            type="text"
            autoComplete="username"
            spellCheck={false}
            value={username}
            disabled={loading}
            onChange={(e) => setUsername(e.target.value)}
          />
          <button type="submit" disabled={!trimmed || loading}>Fetch my games</button>
        </div>
        {loading && <p className="muted">Fetching your games…</p>}
      </form>

      <div className="panel">
        <h2>Or upload a PGN file</h2>
        <div
          className={`drop-zone${dragging ? ' over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <p>Drop a .pgn file here, or</p>
          <button type="button" className="secondary-btn" disabled={loading} onClick={() => fileInput.current?.click()}>
            Choose a file
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".pgn,application/x-chess-pgn,text/plain"
            hidden
            onChange={(e) => { void readFile(e.target.files?.[0]); e.target.value = ''; }}
          />
        </div>
        <label htmlFor="pgn-username">Your name in these games (optional)</label>
        <input
          id="pgn-username"
          type="text"
          spellCheck={false}
          value={pgnUsername}
          disabled={loading}
          onChange={(e) => setPgnUsername(e.target.value)}
        />
      </div>

      {shown && <p className="error" role="alert">{shown}</p>}
    </section>
  );
}

export interface WhichOneIsYouProps { games: GameRecord[]; onResolve(games: GameRecord[]): void }

export function WhichOneIsYou({ games, onResolve }: WhichOneIsYouProps) {
  const names = frequentNames(games.filter((g) => g.userColor === null));
  return (
    <section className="panel">
      <h2>Which one is you?</h2>
      <p className="muted">We couldn't tell which side you played in some games.</p>
      <div className="name-list">
        {names.map((n) => (
          <button key={n} type="button" className="secondary-btn" onClick={() => onResolve(applyUserName(games, n))}>
            {n}
          </button>
        ))}
      </div>
    </section>
  );
}
