# Chess Trainer

Find out what's actually costing you games, and what to train next.

Chess Trainer analyses your Chess.com games and finds the moments that decided them. It groups your mistakes into recurring patterns, ranks them by how much they cost you, and walks you through real examples from your own games, move by move.

> **Status:** working first version. You can import games, see the report and step through the walkthrough. The thresholds for what counts as a mistake are still being tuned on real games.

## What it does

- **Imports your games.** Upload a `.pgn` export, or type your Chess.com username.
- **Finds the mistakes that mattered.** It flags two kinds of moments. First, the swings that decided the game: missed forks, pins, skewers and mates, pieces left hanging, threats you didn't notice, and strong positional moves you missed. Second, clear material blunders (a piece left hanging, a short tactic you walked into), even in games that were already won or lost. These are habits worth fixing, so they're shown too, but they rank below the game-deciding swings. It skips tiny engine inaccuracies.
- **Keeps it human.** It only flags moves a person could realistically find. You won't see "mate in 34".
- **Spots repeated mistakes.** For example: *"Italian Game as White — You played it 19 times. In 7 of them: leaving pieces hanging."*
- **Walks you through each example.** It replays the game, stops at the mistake, explains in plain words what went wrong, and plays out the move you should have found.
- **Splits results by time control:** Rapid, Blitz and Bullet.

## Private by design

Everything runs in your browser, including the Stockfish engine (compiled to WebAssembly). There is no server, so your games never leave your computer. The only exception is fetching them from Chess.com's public API when you use the username import.

## Tech

Vite · React · TypeScript · chess.js · Stockfish (WASM) · IndexedDB

## Getting started

You need [Node.js](https://nodejs.org/) 22.12 or newer (it's developed on Node 24).

```bash
npm install      # installs dependencies and copies the Stockfish engine into public/engine/
npm run dev      # starts the app at http://localhost:5173
```

Open the URL in your browser, then either:

- type your Chess.com username and click **Fetch my games** (it loads your 100 most recent games; Daily and variant games such as Chess960 among them are skipped), or
- drop a `.pgn` file exported from Chess.com, optionally with your username so it knows which side you played.

Analysis runs in the background. Each game takes roughly 5 seconds, and the report fills in as games finish. Results are saved in your browser (IndexedDB), so a game is only analysed once. Click a weakness card, or **See all examples**, to open the step-by-step walkthrough.

> If `public/engine/` is missing (for example after cleaning the folder), run `node scripts/copy-engine.mjs` to restore the engine files.

## Development

```bash
npm test                              # run the test suite (Vitest)
npx tsc -p tsconfig.app.json --noEmit # type-check (the root tsconfig checks nothing on its own)
npm run lint                          # lint (oxlint)
npm run build                         # production build into dist/
npm run preview                       # serve the production build locally
```

The production build is a static site, so you can host `dist/` on any static host (GitHub Pages, Netlify and so on), with no server needed.

> **Note:** the app loads the engine from the absolute path `/engine/stockfish.js`, so host it at the root of a domain (for example `https://example.com/`, not `https://example.com/chess-trainer/`). To serve it from a sub-path, set Vite's `base` option and change the engine URL in `src/engine/stockfishEngine.ts` to match.

### Project layout

| Folder | What's in it |
|---|---|
| `src/pgn/` | PGN parsing and opening names |
| `src/import/` | Fetching games from the Chess.com public API |
| `src/engine/` | Stockfish (WASM) running in a Web Worker |
| `src/chess/` | Board helpers: material, attacks, game phase |
| `src/detectors/` | Tactical and positional motif detection |
| `src/analysis/` | Win probability, the two-pass game analysis, explanations, cache queue |
| `src/patterns/` | Building the ranked weakness report |
| `src/ui/` | React screens: import, report, examples, walkthrough |

## Docs

- Design: [`docs/superpowers/specs/2026-10-21-chess-trainer-design.md`](docs/superpowers/specs/2026-10-21-chess-trainer-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-10-21-chess-trainer.md`](docs/superpowers/plans/2026-10-21-chess-trainer.md)
