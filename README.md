# Chess Trainer

Find out what's actually costing you games, and what to train next.

Chess Trainer analyses your Chess.com games and finds the moments that decided them. It groups your mistakes into recurring patterns, ranks them by how much they cost you, and walks you through real examples from your own games, move by move.

> **Status:** in early development. The features below describe what's being built.

## What it does

- **Imports your games.** Upload a `.pgn` export, or type your Chess.com username.
- **Finds the mistakes that mattered.** It flags only the big swings: missed forks, pins, skewers and mates, pieces left hanging, threats you didn't notice, and strong positional moves you missed. It skips tiny engine inaccuracies.
- **Keeps it human.** It only flags moves a person could realistically find. You won't see "mate in 34".
- **Spots repeated mistakes.** For example: *"Italian Game as White: you played it 19 times, and in 7 of them you lost the e4 pawn the same way."*
- **Walks you through each example.** It replays the game, stops at the turning point, explains in plain words what went wrong, and plays out the move you should have found.
- **Splits results by time control:** Rapid, Blitz and Bullet.

## Private by design

Everything runs in your browser, including the Stockfish engine (compiled to WebAssembly). There is no server, so your games never leave your computer. The only exception is fetching them from Chess.com's public API when you use the username import.

## Tech

Vite · React · TypeScript · chess.js · Stockfish (WASM) · IndexedDB

## Development

*Setup instructions will be added once the project is scaffolded.*

## Docs

- Design: [`docs/superpowers/specs/2026-10-21-chess-trainer-design.md`](docs/superpowers/specs/2026-10-21-chess-trainer-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-10-21-chess-trainer.md`](docs/superpowers/plans/2026-10-21-chess-trainer.md)
