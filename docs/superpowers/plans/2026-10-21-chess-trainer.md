# Chess Trainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static website that analyses a player's Chess.com games in the browser, finds the human-findable moments that decided them, groups them into ranked recurring weaknesses, and walks the player through each example move by move.

**Architecture:**
- **Pure TypeScript core, no DOM:** PGN parsing, win-probability math, tactical/positional detectors, the two-pass analysis pipeline, and report aggregation. All of it is unit-tested with Vitest against a fake engine.
- **Engine:** Stockfish (single-threaded WASM, in a Web Worker), hidden behind an `Engine` interface.
- **UI:** a thin React layer for import, the report, the example list, and the walkthrough.
- **Cache:** per-game results in IndexedDB.

**Tech Stack:**
- Vite + React 18 + TypeScript (strict)
- `chess.js` ^1.0 (move generation, `attackers()`, `isAttacked()`)
- `react-chessboard` ^4 for boards
- `idb-keyval` for IndexedDB
- npm `stockfish` (pin the exact version at install) — use its **lite single-threaded** build, so no COOP/COEP headers are needed and it can be hosted anywhere
- Vitest + @testing-library/react + fake-indexeddb

**Spec:** `docs/superpowers/specs/2026-10-21-chess-trainer-design.md`

## Global Constraints

- **No backend.** Everything runs in the browser. Games never leave the user's machine, except the call that fetches them from `api.chess.com`.
- **English only.** No translation layer.
- **Wording:** all user-facing text is plain chess language. **Never show centipawns or engine scores** in explanations.
- **No invented reasons.** Never claim a motif that a detector didn't confirm on the actual line. If nothing explains a move, use the fallback copy: "This wins material" / "This was much stronger".
- **What gets flagged:** use win-probability drop, never raw centipawns. The target is roughly **3–6 flagged moments per typical game**, measured *after* the findable filter.
- **Human-findable:** a move is flagged only if the punishment of the user's move **or** the better move is human-findable. Lines are allowed up to about **9 of the user's own moves** (soft outer edge). Shorter lines rank higher.
- **Simplest good move:** when the engine's best move is unexplainable but a simple explainable good move exists, show the simple move.
- **Unpunished mistakes:** if the opponent didn't punish a mistake, say so: "He didn't take advantage, but next time someone will."
- **Time-control filter:** results are filterable by All / Rapid / Blitz / Bullet.
- **Out of scope for v1:** no LLM explanations, accounts, cloud storage, or puzzle drills.
- **No git writes, ever (user's rule):** never run `git commit`, `git push`, or anything else that changes git history or remotes. The user makes every commit. Each task ends by stopping and handing off for the user to commit.

## Review Focus

1. **The user played Black.** Win% must be from the user's perspective, the board must be oriented to the user, and "your/his" wording must point the right way. Tests: Task 3 (`winPercentForColor` with pov `b`), Task 9 (`analyzeGame` on a Black game), and Task 13 (walkthrough orientation).
2. **Mate scores and already-lost positions.** Mate-in-N, being mated, and positions where the user is already at <10% win must never produce NaN. They also must not produce a stream of flagged moves in a dead-lost game. Tests: Task 3 (mate→win%) and Task 9 (lost-game test).
3. **PGNs the tool can't analyse:** Chess960/variants (`SetUp`/`FEN`/`Variant` headers), Daily games, aborted games under 6 plies, malformed text. These are skipped with a reason and counted, never a crash. Tests: Task 1.
4. **The username doesn't match a side** (case differences, or a PGN file from someone else). Matching is case-insensitive. If no side matches, `userColor` is `null` and the UI asks once which name is the user. Tests: Task 1 and Task 12.
5. **Reload mid-analysis, and analysis-logic changes.** Finished games come from the cache. Unfinished games re-run. Bumping `ANALYSIS_VERSION` invalidates old results. Tests: Task 10.

---

## File Structure

```
package.json, vite.config.ts, tsconfig.json, index.html
scripts/copy-engine.mjs            # postinstall: copies stockfish lite-single .js/.wasm to public/engine/
src/types.ts                       # all shared types (Task 1, extended by later tasks)
src/pgn/parseGames.ts              # PGN text → GameRecord[] + skipped list
src/pgn/opening.ts                 # ECOUrl/ECO → OpeningInfo
src/import/chesscom.ts             # username → PGN text via public API
src/analysis/winprob.ts            # Score → win%, move labels
src/engine/uci.ts                  # parse UCI "info"/"bestmove" lines
src/engine/stockfishEngine.ts      # Engine impl over Web Worker
src/engine/fakeEngine.ts           # scripted Engine for tests
src/chess/board.ts                 # piece values, material, attack helpers, phase, line replay
src/detectors/tactical.ts          # fork, pin, skewer, hanging, discovered, mate
src/detectors/positional.ts        # open-file, pawn-break, winning-trade, stops-threat
src/detectors/index.ts             # detectMotif(line) — ordered dispatch
src/analysis/explain.ts            # step notes, line summaries, moment explanation copy
src/analysis/analyzeGame.ts        # two-pass pipeline → GameAnalysis
src/storage/cache.ts               # IndexedDB cache keyed by game id + version
src/analysis/queue.ts              # runs many games with progress + cache
src/patterns/buildReport.ts        # GameAnalysis[] → Report
src/ui/App.tsx, ImportPanel.tsx, ProgressBar.tsx, ReportView.tsx,
src/ui/WeaknessCard.tsx, ExampleList.tsx, Walkthrough.tsx, MiniBoard.tsx
tests/** mirrors src/**; tests/fixtures/*.pgn
```

---

### Task 1: Scaffold + PGN parsing

**Files:**
- Create: the project scaffold (Vite react-ts template), `src/types.ts`, `src/pgn/parseGames.ts`, `src/pgn/opening.ts`
- Test: `tests/pgn/parseGames.test.ts`, `tests/pgn/opening.test.ts`, `tests/fixtures/sample.pgn` (3 real Chess.com games: the user as White, the user as Black, a bullet game), `tests/fixtures/bad.pgn` (a Chess960 game, a Daily game, a 4-ply aborted game, garbage text)

**Interfaces — Produces (in `src/types.ts`):**

```ts
export type Color = 'w' | 'b';
export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'daily' | 'unknown';
export type Phase = 'opening' | 'middlegame' | 'endgame';
export interface PlyRecord { ply: number; san: string; uci: string; fenBefore: string; fenAfter: string; color: Color; clockSec: number | null }
export interface OpeningInfo { eco: string | null; name: string; family: string }
export interface GameRecord {
  id: string; headers: Record<string, string>; white: string; black: string;
  userColor: Color | null; result: '1-0' | '0-1' | '1/2-1/2' | '*';
  userResult: 'win' | 'loss' | 'draw' | null; timeClass: TimeClass; baseTimeSec: number | null;
  opening: OpeningInfo; plies: PlyRecord[]; date: string | null; url: string | null;
}
export interface SkippedGame { index: number; reason: 'variant' | 'daily' | 'too-short' | 'unparseable'; label: string }
```

- `parseGames(pgnText: string, username: string | null): { games: GameRecord[]; skipped: SkippedGame[] }`
- `withUserColor(game: GameRecord, color: Color): GameRecord` (used when the UI asks which side is the user)
- `parseOpening(headers: Record<string, string>, sanMoves: string[]): OpeningInfo`

- [ ] **Step 1: Scaffold.**
  - The user sets up git themselves. Confirm `git status` works; don't run `git init`.
  - Run `npm create vite@latest . -- --template react-ts`.
  - Install `chess.js react-chessboard idb-keyval stockfish`, and the dev deps `vitest @testing-library/react @testing-library/jest-dom jsdom fake-indexeddb`.
  - Add `"test": "vitest run"`.
  - Add `scripts/copy-engine.mjs`, run as `postinstall`. It copies the `stockfish` package's `*lite-single*.js` and `.wasm` into `public/engine/` under the fixed names `stockfish.js` / `stockfish.wasm`.
  - Add `.superpowers/` and `public/engine/` to `.gitignore`.
- [ ] **Step 2: Write the failing tests.**
  - `parses three games`: on `sample.pgn` with username `"<fixture user>"`:
    - `games.length === 3`
    - the first game has `userColor === 'w'` and the second has `'b'`
    - `timeClass` is `'rapid'`, `'blitz'`, `'bullet'` respectively
    - `plies[0].san === 'e4'` and `plies[0].clockSec` is a number
    - `id` is stable across two parses
  - `username match is case-insensitive`: `parseGames(text, USER.toUpperCase())` gives the same `userColor`s.
  - `unknown username gives null userColor and null userResult`.
  - `skips bad games with reasons`: on `bad.pgn`, `games.length === 0` and `skipped.map(s => s.reason)` equals `['variant', 'daily', 'too-short', 'unparseable']`.
  - `missing %clk gives clockSec null`.
  - `opening family`:
    - `parseOpening({ECOUrl: '.../openings/Italian-Game-Two-Knights-Defense-Modern-Bishops-Opening'}, [])` gives `family === 'Italian Game'`
    - `'Sicilian-Defense-Najdorf-Variation'` gives `'Sicilian Defense'`
    - with no headers, `family` comes from the first 4 SANs, e.g. `'1.e4 e5 2.Nf3 Nc6'`
- [ ] **Step 3: Run `npm test`.** Expected: FAIL (modules missing).
- [ ] **Step 4: Implement.**
  - Split the text into games on blank lines before `[Event`, and parse each one with `chess.js` `loadPgn`.
  - Extract `%clk` from the comments in order.
  - Time class comes from `TimeControl`:
    - contains `/` → daily
    - otherwise `base + 40*inc` (seconds): <180 bullet, <600 blitz, else rapid
  - `id` = hex SHA-1 of `Site + Date + White + Black + move text`. Compute it synchronously (small inline SHA-1, or `crypto.subtle` via an async variant — pick one, keep the signature sync).
  - Opening family: take the words of the ECOUrl slug up to and including the first one in `{Game, Opening, Defense, Gambit, Attack, System}`, capped at 4 words.
- [ ] **Step 5: Run `npm test`.** Expected: PASS.
- [ ] **Step 6: Hand off for commit.** Do not run git. Report the changed files and suggest a commit description ("scaffold and PGN parsing") — the user commits.

### Task 2: Chess.com import

**Files:** Create `src/import/chesscom.ts`. Test `tests/import/chesscom.test.ts` (mock `fetch`).

**Interfaces — Produces:**
- `fetchRecentPgn(username: string, opts?: { maxGames?: number; fetchImpl?: typeof fetch }): Promise<string>`
  - Default `maxGames` is 100.
  - Fetches `https://api.chess.com/pub/player/{lowercased}/games/archives` and walks the archives newest-first, fetching `{archive}/pgn` until it has `maxGames` games.
- It throws an `ImportError` whose `code` is `'not-found' | 'no-games' | 'rate-limited' | 'network'`.

- [ ] **Step 1: Write the failing tests.**
  - `fetches newest archives first until maxGames`: 2 archives with 3 games each, `maxGames: 4`. It requests the newest archive first, and the returned text has 4 `[Event` blocks.
  - `404 → not-found`.
  - `empty archives → no-games`.
  - `429 → rate-limited`.
  - `fetch rejects → network`.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Hand off for commit.** Do not run git. Report the changed files and suggest a commit description ("chess.com import") — the user commits.

### Task 3: Win probability and move labels

**Files:** Create `src/analysis/winprob.ts`. Test `tests/analysis/winprob.test.ts`.

**Interfaces — Produces:**
- `export type Score = { cp: number } | { mate: number }` (from the side to move's perspective; add it to `types.ts`)
- `winPercentForColor(score: Score, sideToMove: Color, pov: Color): number`
  - Range 0–100.
  - Uses the Lichess formula `50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)`, with cp clamped to ±1000.
  - Mate for the side to move → 100. Being mated → 0. `{mate: 0}` → 0 for the side to move.
- `labelMove(drop: number, flagged: boolean): 'good' | 'inaccuracy' | 'blunder'`
  - flagged → `'blunder'`
  - else drop ≥ `INACCURACY_DROP` → `'inaccuracy'`
  - else `'good'`
- Constants (exported from this file and tuned in Task 14): `INACCURACY_DROP = 10`, `FLAG_DROP = 18`.

- [ ] **Step 1: Write the failing tests.**
  - `cp 0 → 50`
  - `cp 300 for white, pov w ≈ 75 (±1)`
  - `same score, pov b ≈ 25`
  - `mate 3 for side to move → 100; mate -2 → 0`
  - `huge cp clamps, never NaN`
  - the `labelMove` thresholds
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Hand off for commit.** Do not run git. Report the changed files and suggest a commit description ("win probability") — the user commits.

### Task 4: Engine wrapper

**Files:**
- Create `src/engine/uci.ts`, `src/engine/stockfishEngine.ts`, `src/engine/fakeEngine.ts`
- Test `tests/engine/uci.test.ts`, `tests/engine/fakeEngine.test.ts`

**Interfaces — Produces:**

```ts
export interface EngineLine { multipv: number; score: Score; pv: string[]; depth: number } // pv in UCI
export interface Engine { analyse(fen: string, opts: { depth: number; multiPv?: number }): Promise<EngineLine[]>; dispose(): void }
```

- `parseInfo(line: string): EngineLine | null`. It ignores `info` lines without `pv`, and handles `score mate -3` and `lowerbound`/`upperbound`, which it skips.
- `createStockfishEngine(url = '/engine/stockfish.js'): Promise<Engine>`
  - Sends `uci`, waits for `uciok`, then `isready`.
  - Each `analyse` call: `setoption name MultiPV`, `position fen`, `go depth N`. It resolves on `bestmove` with the deepest line per multipv, sorted by multipv.
  - Calls are queued, so one search runs at a time.
- `createFakeEngine(table: Record<string, EngineLine[]>): Engine` returns `table[fen]`. It throws `Unscripted FEN: <fen>` if the FEN isn't in the table, so tests stay explicit.

- [ ] **Step 1: Write the failing tests.**
  - The `parseInfo` cases:
    - a cp line with multipv 2
    - a mate line
    - a line without pv → null
    - a bound line → null
  - The fake engine returns scripted lines and throws on unknown FENs.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** all three files. The worker engine isn't unit-tested; it's verified in Task 12 in the browser.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Hand off for commit.** Do not run git. Report the changed files and suggest a commit description ("engine wrapper") — the user commits.

### Task 5: Board helpers

**Files:** Create `src/chess/board.ts`. Test `tests/chess/board.test.ts`.

**Interfaces — Produces:**
- `PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 }`
- `materialBalance(fen: string, pov: Color): number` — own material minus the opponent's, kings excluded
- `nonPawnMaterial(fen: string): number` — both sides, kings excluded
- `phaseOf(fen: string, ply: number): Phase`
  - `nonPawnMaterial ≤ 26` → endgame
  - else `ply ≤ 24` → opening
  - else middlegame
- `isHanging(fen: string, square: Square): boolean`
  - The piece is attacked by an enemy piece of lower value, **or** it is attacked and not defended.
  - Use chess.js `attackers()`.
- `attackedTargets(fen: string, from: Square): Square[]` — enemy-occupied squares the piece on `from` attacks
- `replayLine(fen: string, uci: string[]): { fens: string[]; sans: string[] }`
  - `fens[0] === fen`.
  - It stops early, without throwing, at an illegal move.
- `nullMoveFen(fen: string): string | null`
  - Flips the side to move and clears en passant.
  - Returns `null` if the side to move is in check.

- [ ] **Step 1: Write the failing tests.** One focused assertion each, using hand-picked FENs:
  - start position balance 0
  - an endgame FEN gives `'endgame'`
  - ply 10 in the start-ish position gives `'opening'`
  - an undefended knight attacked by a pawn is hanging
  - a defended rook attacked by a queen is not hanging
  - a defended rook attacked by a knight is hanging
  - the Nd5 FEN from the spec mockup `r3k2r/pp3ppp/8/3N4/8/8/PPP2PPP/R3K2R w - - 0 1`: `replayLine(fen, ['d5c7'])` gives `sans === ['Nc7+']`
  - `nullMoveFen` returns null when in check
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Hand off for commit.** Do not run git. Report the changed files and suggest a commit description ("board helpers") — the user commits.

### Task 6: Tactical detectors

**Files:** Create `src/detectors/tactical.ts`, `src/detectors/index.ts`. Test `tests/detectors/tactical.test.ts`.

**Interfaces — Consumes:** Task 5 helpers, plus `Score` from Task 3.

**Interfaces — Produces (in `types.ts`):**

```ts
export type MotifType = 'mate' | 'fork' | 'pin' | 'skewer' | 'discovered-attack' | 'hanging-piece'
  | 'open-file' | 'pawn-break' | 'winning-trade' | 'stops-threat';
export interface Motif { type: MotifType; keySquares: string[]; targets: string[]; piece: string; mateIn?: number }
// targets: piece letters+squares, e.g. ['k@e8','r@a8']; piece: the moving piece, e.g. 'n@d5'
export interface LineContext { fen: string; pv: string[]; mover: Color; score: Score }
// fen = position before pv[0]; mover = side playing pv[0]; score from mover's perspective at the root
```

`detectMotif(ctx: LineContext, opts?: { depthCap?: number; rootWin?: number }): Motif | null`:
- It tries the detectors in this order: mate, fork, pin, skewer, discovered-attack, hanging-piece, then the Task 7 positional detectors.
- The positional detectors run only when `rootWin` is given.
- It returns the first hit.
- `depthCap` defaults to 9 of the mover's own moves.

**The rules (each one must be confirmed on the real line, not guessed):**
- **Material gain** means: `materialBalance(lastFen of pv truncated to 2*depthCap plies, mover) - materialBalance(fen, mover) ≥ 2`.
- **mate:** `score` is `{mate: n}` with `0 < n ≤ depthCap`, and replaying the pv ends in checkmate. `mateIn = n`.
- **fork:** after pv[0], the moved piece attacks ≥ 2 enemy pieces, each of which is either the king, worth more than the mover, or undefended. The material gain also holds.
- **pin / skewer:** after pv[0], a slider (the moved piece, or one the move unblocked) attacks a target with a more valuable piece or the king behind it on the same ray. A pin has the cheaper piece in front; a skewer has the more valuable piece in front. The material gain also holds.
- **discovered-attack:** pv[0] moves a piece off the ray of the mover's own slider, which then attacks a king or a piece worth more than the slider, or an undefended piece. The material gain also holds.
- **hanging-piece:** pv[0] captures a piece that `isHanging` before the move, with a material gain ≥ 2 by the end of the line.

- [ ] **Step 1: Write the failing tests.** Each uses a FEN and pv built by hand:
  - `knight fork`: the mockup FEN with pv `['d5c7','e8d7','c7a8']` gives `{type: 'fork', targets: ['k@e8','r@a8']}`, in any order
  - `back-rank mate in 2` gives `{type: 'mate', mateIn: 2}`
  - `absolute pin wins piece` gives `'pin'`
  - `skewer king→queen` gives `'skewer'`
  - `discovered attack on queen` gives `'discovered-attack'`
  - `free piece` gives `'hanging-piece'`
  - `quiet equal line` gives `null`
  - `material gain beyond cap is ignored`: a line that wins material only at move 11 for the mover gives `null`
  - `works for black mover`: a mirrored fork FEN with Black to move gives `'fork'`
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Hand off for commit.** Do not run git. Report the changed files and suggest a commit description ("tactical detectors") — the user commits.

### Task 7: Positional detectors

**Files:** Create `src/detectors/positional.ts`, and register the detectors in `src/detectors/index.ts`. Test `tests/detectors/positional.test.ts`.

**Interfaces — Consumes:**
- `LineContext`, `Motif`
- `winPercentForColor`
- `engineReply?: (fen: string) => Promise<EngineLine[]>` — only for stops-threat (below)

**Interfaces — Produces:**
- `detectPositional(ctx: LineContext, rootWin: number): Motif | null`, used by `detectMotif`. `rootWin` is the mover's win% after pv[0].
- `detectStopsThreat(ctx: LineContext, threatLine: EngineLine | null): Motif | null`. It's called separately by Task 9, which supplies `threatLine` from a null-move search.

**The rules:**
- **open-file:** pv[0] puts a rook or queen on a file with no pawns of either color (open), or with no own pawns (half-open, only if an enemy pawn there is weak or the file points at the enemy king).
- **pawn-break:** pv[0] is a pawn move that attacks an enemy pawn and is on a file within 1 of the enemy king's file, or opens a file for the mover's rook.
- **winning-trade:** the line contains ≥ 1 capture-recapture pair, the final position is `'endgame'`, material is about equal or the mover is ahead, and `rootWin ≥ 80`.
- **stops-threat:** `threatLine` (the opponent's best move from `nullMoveFen`, as if the mover passed) produces a tactical motif for the opponent through `detectMotif`, and that threat is gone after pv[0]: re-running `detectMotif` on the threat line after pv[0] returns null or the line is illegal.

- [ ] **Step 1: Write the failing tests.**
  - `rook to open file` gives `'open-file'`
  - `rook to file with own pawn` gives `null`
  - `g-pawn break vs castled king` gives `'pawn-break'`
  - `trade into won pawn endgame, rootWin 85` gives `'winning-trade'`, and the same with `rootWin 60` gives `null`
  - `stops-threat`: given a threat line that is a fork, after a move that covers the fork square → `'stops-threat'`
  - a tactical motif still takes priority over positional in `detectMotif` ordering
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Hand off for commit.** Do not run git. Report the changed files and suggest a commit description ("positional detectors") — the user commits.

### Task 8: Explanation copy

**Files:** Create `src/analysis/explain.ts`. Test `tests/analysis/explain.test.ts`.

**Interfaces — Produces:**
- `describeStep(fenBefore: string, uci: string, pov: Color): string` — a short note for one move in a line, from the user's (`pov`) perspective. It joins with ", " whichever apply:
  - "check"
  - "takes his rook" / "takes your rook"
  - "attacks the rook too" (new attacks on targets worth more or undefended)
  - "promotes"
  - "king has to move" (when the reply is a forced king move)
  - otherwise "".
- `summarizeMotif(m: Motif, pov: Color, mover: Color): string`. Templates:
  - fork: "Knight fork: it hits his king and rook at the same time."
  - mate: "Checkmate in {n}."
  - pin: "Pin: his {front} can't move without losing the {back}."
  - skewer: "Skewer: his {front} has to move and the {back} behind it falls."
  - discovered: "Discovered attack: moving the {piece} uncovers an attack on his {target}."
  - hanging: "His {piece} on {sq} was free to take."
  - open-file: "Puts your rook on the open {file}-file."
  - pawn-break: "Pawn break that opens up his king."
  - winning-trade: "Trades into an endgame you're winning."
  - stops-threat: "Stops his threat before it happens."
  - When `mover !== pov`, swap the pronouns: "your king and rook".
- `momentExplanation(m: Moment, game: GameRecord): string` — the walkthrough's "what went wrong" paragraph. It names:
  - what the opponent's last move did, if a threat was ignored
  - the played move
  - the motif, or the fallback copy
  - the line "He didn't take advantage, but next time someone will." when `!m.punished`
- `calmSummary(moves: MoveEval[], fromPly: number, toPly: number): string`
  - "Moves {a}–{b}: solid." when there are no inaccuracies
  - "Moves {a}–{b}: mostly fine." otherwise

- [ ] **Step 1: Write the failing tests.**
  - The exact strings for:
    - the mockup fork: `describeStep` on Nc7+ gives `'check, attacks the rook too'`
    - `summarizeMotif` on the fork
    - the mate summary
    - the pronoun swap when the mover is the opponent
    - the fallback when the motif is null
    - the not-punished sentence is present
    - both `calmSummary` variants
  - No output contains a digit followed by "cp", or "+0."/"−".
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Hand off for commit.** Do not run git. Report the changed files and suggest a commit description ("explanation copy") — the user commits.

### Task 9: Game analysis pipeline

**Files:** Create `src/analysis/analyzeGame.ts`. Test `tests/analysis/analyzeGame.test.ts`, using a fake engine with hand-scripted positions from two short fixture games: one with the user as White and one as Black.

**Interfaces — Consumes:**
- `Engine` (Task 4)
- `winPercentForColor`, `FLAG_DROP`, `labelMove` (Task 3)
- `detectMotif`, `detectStopsThreat` (Tasks 6–7)
- `nullMoveFen`, `phaseOf`, `replayLine` (Task 5)
- `describeStep`, `summarizeMotif`, `momentExplanation` (Task 8)

**Interfaces — Produces (in `types.ts`):**

```ts
export const ANALYSIS_VERSION = 1;
export type MistakeType = 'missed-mate' | 'missed-fork' | 'missed-pin' | 'missed-skewer' | 'missed-discovered-attack'
  | 'missed-free-material' | 'missed-positional' | 'ignored-threat' | 'hung-piece' | 'walked-into-tactic'
  | 'walked-into-mate' | 'unexplained';
export interface ExplainedLine { uci: string[]; san: string[]; stepNotes: string[]; motif: Motif | null; summary: string; userMoves: number }
export interface MoveEval { ply: number; san: string; byUser: boolean; winBefore: number; winAfter: number; drop: number; label: 'good' | 'inaccuracy' | 'blunder' | 'opponent' }
export interface Moment {
  ply: number; playedSan: string; fenBefore: string; winBefore: number; winAfter: number; drop: number;
  mistakeType: MistakeType; better: ExplainedLine | null; punishment: ExplainedLine | null;
  punished: boolean; explanation: string; phase: Phase; lowClock: boolean; pieceInvolved: string | null;
}
export interface GameAnalysis { gameId: string; analysisVersion: number; moves: MoveEval[]; moments: Moment[] }
```

- `analyzeGame(game: GameRecord, engine: Engine, opts?: { quickDepth?: number; deepDepth?: number; onPly?: (done: number, total: number) => void }): Promise<GameAnalysis>`
  - Defaults: `quickDepth = 12`, `deepDepth = 18`.
  - It requires `game.userColor` to be non-null.

**Algorithm (the decisions the tests pin):**
1. **Pass 1.** Run `engine.analyse(fenBefore of each ply, {depth: quickDepth})`, plus the final position. User win% before and after each ply is `winPercentForColor` from the user's pov. A user move is a **candidate** when `drop ≥ FLAG_DROP` and `winBefore ≥ 10`. That second condition means already-lost positions don't spam moments.
2. **Pass 2** runs on each candidate:
   - **Better move:** `analyse(fenBefore, {depth: deepDepth, multiPv: 3})`. Among the lines whose win% is within 10 of the best line (best first), take the first one where `detectMotif(ctx, {rootWin})` is non-null. If none is, try `detectStopsThreat(ctx, threatLine)` on the same lines. `threatLine` is the top line of `analyse(nullMoveFen(fenBefore), {depth: quickDepth})`, and it's skipped when `nullMoveFen` returns null. If none qualifies but the best line is `≥ FLAG_DROP` better than the played move, the better line is the best line with `motif: null`.
   - **Punishment:** `analyse(fenAfter, {depth: deepDepth})`. Run `detectMotif` from the opponent's side.
   - **Ignored threat:** run `nullMoveFen(fenBefore)`. If the previous opponent move created a hanging user piece (`isHanging` true after their move, false before it) and the punishment's first move captures on that square → `ignored-threat`.
3. **Findable filter.** Keep the candidate only if the punishment motif or the better motif is non-null, **or** `drop ≥ 40` with a punishment that gains material ≥ 3 within 3 opponent moves (the "plain hung piece" case). Otherwise, drop it.
4. **`mistakeType` priority:**
   - `ignored-threat`
   - else a punishment motif: `mate` → `walked-into-mate`, `hanging-piece` → `hung-piece`, else `walked-into-tactic`
   - else a better motif: `mate` → `missed-mate`, `fork`/`pin`/`skewer`/`discovered-attack` → the matching `missed-*`, `hanging-piece` → `missed-free-material`, positional → `missed-positional`
   - else `unexplained`
5. **`punished`:** the opponent's actual next move equals `punishment.uci[0]`, **or** the user's win% after the opponent's reply stays below `winBefore - FLAG_DROP/2`.
6. **`lowClock`:** `clockSec !== null && baseTimeSec !== null && clockSec < 0.15 * baseTimeSec`.

- [ ] **Step 1: Write the failing tests** (fake engine):
  - `flags a missed fork as White`: there's one moment with `mistakeType === 'missed-fork'`, `better.san[0] === 'Nc7+'`, and `better.stepNotes[0] === 'check, attacks the rook too'`.
  - `flags hung piece as Black`: the user's win% is computed with pov `b`, and the moment has `'hung-piece'` with `punished === true`.
  - `deep engine-only refutation is not flagged`: a drop of 25 where neither line has a motif and the material gain is outside 3 moves → 0 moments.
  - `prefers simple explainable alternative`: MultiPV line 1 has no motif, line 2 (within 10 win%) is a fork → `better.uci` is line 2.
  - `unpunished mistake`: the opponent played something else and the win% recovered → `punished === false`, and the explanation contains "next time someone will".
  - `lost position doesn't spam`: every user move after `winBefore < 10` → no moments.
  - `lowClock` is set from the clocks.
  - Every `MoveEval` for a user move has a label, and opponent moves have `'opponent'`.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Hand off for commit.** Do not run git. Report the changed files and suggest a commit description ("two-pass game analysis") — the user commits.

### Task 10: Cache and analysis queue

**Files:** Create `src/storage/cache.ts`, `src/analysis/queue.ts`. Test `tests/analysis/queue.test.ts` (with `fake-indexeddb/auto`).

**Interfaces — Produces:**
- `getCached(gameId: string): Promise<GameAnalysis | null>` — returns null when `analysisVersion !== ANALYSIS_VERSION`
- `putCached(a: GameAnalysis): Promise<void>`
- `runQueue(games: GameRecord[], engine: Engine, onProgress: (p: { done: number; total: number; current: string | null; finished: GameAnalysis | null }) => void, signal?: AbortSignal): Promise<GameAnalysis[]>`
  - Cached games are emitted first as `finished`. The rest are analysed sequentially, and each one is cached the moment it finishes.
  - Games with `userColor === null` are skipped; the UI resolves them first.

- [ ] **Step 1: Write the failing tests.**
  - `analyses uncached games and caches them`: the second run calls the engine 0 times.
  - `old version is re-analysed`.
  - `abort mid-run keeps finished games cached`: abort after game 1 of 3, and a re-run analyses only 2.
  - The progress `done` counts up to `total`.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Hand off for commit.** Do not run git. Report the changed files and suggest a commit description ("cached analysis queue") — the user commits.

### Task 11: Report aggregation

**Files:** Create `src/patterns/buildReport.ts`. Test `tests/patterns/buildReport.test.ts`, using hand-built `GameRecord`/`GameAnalysis` objects (no engine).

**Interfaces — Produces (in `types.ts`):**

```ts
export interface ExampleRef { gameId: string; ply: number }
export interface Weakness { key: string; kind: 'mistake-type' | 'repeated-situation'; title: string; summary: string;
  count: number; gamesDecided: number; cost: number; examples: ExampleRef[]; typical: ExampleRef }
export interface OpeningStat { family: string; color: Color; games: number; wins: number; losses: number; draws: number; moments: number }
export interface Report { gamesAnalysed: number; skippedCount: number; weaknesses: Weakness[];
  byPhase: Record<Phase, { count: number; cost: number }>; timeTrouble: { count: number; cost: number } | null; byOpening: OpeningStat[] }
```

- `buildReport(games: GameRecord[], analyses: GameAnalysis[], filter: TimeClass | 'all', skippedCount?: number): Report`

**Rules:**
- **Decided the game:** in a lost game, the moment with the largest drop, provided the user's win% never got back above 50 after it.
- **Cost of a weakness:** `Σ (drop × shortness)` over its moments, plus `50 × gamesDecided`, where `shortness = 1 / (1 + 0.15 × (userMoves − 1))` and `userMoves` comes from the better line, or 1 if there isn't one.
  - The weaknesses are sorted by cost, descending.
  - `typical` is the highest-cost example.
- **Mistake-type weaknesses:**
  - Only types with `count ≥ 2`, and never `unexplained`.
  - Titles, keyed by `MistakeType`:
    - "Missed checkmates"
    - "Missed forks"
    - "Missed pins"
    - "Missed skewers"
    - "Missed discovered attacks"
    - "Not taking free material"
    - "Missed strong positional moves"
    - "Not checking what your opponent's last move attacks"
    - "Leaving pieces hanging"
    - "Walking into tactics"
    - "Walking into checkmate"
  - The summary reads "Happened {count} times · decided {gamesDecided} of your losses" plus " · mostly in the {phase}", using the most common phase.
- **Repeated situations:**
  - (a) **Same position, same mistake:** the same `fenBefore` (the first 4 FEN fields) with a moment in ≥ 2 games. Title: "Same position, same mistake ({family} as {White/Black})".
  - (b) **Same opening, same kind of mistake:** within `opening.family + userColor`, the same `mistakeType` in the opening phase in ≥ 3 games. Title: "{family} as {White/Black}". Summary: "You played it {games} times. In {n} of them: {mistake title lowercased}."
  - (a) takes priority over (b) for the same moments.
- **Time trouble:** `timeTrouble` is null when no analysed game has clocks.
- **Filtering:** `filter` applies to the games before anything else.

- [ ] **Step 1: Write the failing tests.**
  - `ranks by cost not count`
  - `decided only when no recovery above 50`
  - `count 1 types excluded, unexplained excluded`
  - `same-position repeat detected across 2 games`
  - `opening-family repeat needs 3 games`
  - `filter 'bullet' excludes rapid games`
  - `timeTrouble null without clocks`
  - `byPhase counts`
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Hand off for commit.** Do not run git. Report the changed files and suggest a commit description ("report aggregation") — the user commits.

### Task 12: UI — import, progress, report

**Files:**
- Create `src/ui/App.tsx`, `ImportPanel.tsx`, `ProgressBar.tsx`, `ReportView.tsx`, `WeaknessCard.tsx`, `MiniBoard.tsx`
- Modify `src/main.tsx`
- Test `tests/ui/ReportView.test.tsx`, `tests/ui/ImportPanel.test.tsx`

**Interfaces — Consumes:** `parseGames`, `withUserColor`, `fetchRecentPgn`, `createStockfishEngine`, `runQueue`, `buildReport`.

**Interfaces — Produces:**
- The app state in `App.tsx`: `{ games: GameRecord[]; analyses: Map<string, GameAnalysis>; filter: TimeClass | 'all'; view: { name: 'report' } | { name: 'examples'; key: string } | { name: 'walkthrough'; gameId: string; ply: number } }`
- `MiniBoard({ fen, orientation, highlight?: string[], good?: string[], size?: number })`
- `ReportView({ report, onOpenExamples(key), onOpenExample(ref) })`

**Behaviour:**
- **Import panel:** a username box ("Fetch my games") plus a PGN drop zone / file picker (both inputs are always there). For PGN uploads there's also an optional username field.
- **Unknown side:** if parsed games have `userColor === null`, show one prompt listing the most frequent player names: "Which one is you?" The answer is applied with `withUserColor` to every game where that name appears.
- **Import errors** show plain messages:
  - not-found: "No Chess.com user with that name."
  - no-games: "That account has no games yet."
  - rate-limited: "Chess.com is busy, try again in a minute."
  - network: "Couldn't reach Chess.com."
- **Skipped games:** the count shows as "Skipped 3 games we can't analyse (variants, daily, or too short)."
- **Progress:** "Analysing game 12 of 87". The report re-renders as games finish.
- **Report header:** "{n} games analysed" plus the filter chips All / Rapid / Blitz / Bullet.
- **Weakness cards** follow the layout in the spec mockup (`.superpowers/brainstorm/*/content/report-and-walkthrough.html`). Each card has:
  - a mini board of `typical`, oriented to the user
  - the key squares highlighted
  - a cost bar, with width = cost / max cost
  - the title and summary
  - "See all {count} examples →"
- **Secondary sections** follow the cards: by phase, time trouble (hidden when null), and by opening.

- [ ] **Step 1: Write the failing tests.**
  - `ReportView renders weaknesses in order with summaries`
  - `filter chip click calls onFilter`
  - `time trouble section hidden when null`
  - `ImportPanel shows not-found message`
  - `unknown side prompt applies chosen name`
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Browser check.** Run `npm run dev` and import `tests/fixtures/sample.pgn`. The progress bar advances, real Stockfish results appear (proving the worker engine from Task 4), the report renders, and nothing shows in the console.
- [ ] **Step 6: Hand off for commit.** Do not run git. Report the changed files and suggest a commit description ("import and report UI") — the user commits.

### Task 13: UI — example list and walkthrough

**Files:**
- Create `src/ui/ExampleList.tsx`, `src/ui/Walkthrough.tsx`
- Test `tests/ui/Walkthrough.test.tsx`

**Interfaces — Consumes:** `Moment`, `MoveEval`, `GameRecord`, `calmSummary`, `momentExplanation`, `MiniBoard`.

**Interfaces — Produces:**
- `ExampleList({ weakness, games, analyses, onOpen(ref) })` — one row per example: a mini board, the opponent, the time class, "move {n}", and the result
- `Walkthrough({ game, analysis, startPly, onBack })`

**Walkthrough behaviour:**
- It opens at `startPly`, with the board **oriented to `game.userColor`**.
- **Move list:** colour-coded by label (good green, inaccuracy amber, blunder red). Opponent moves are uncoloured.
- **Calm stretches:** stretches with no `inaccuracy`/`blunder` labels before the moment collapse into `calmSummary`, which can be clicked to expand.
- **Explanation panel:** `momentExplanation`.
- **"What you could have played":**
  - `better.san` as steps with their `stepNotes`
  - ◀ ▶ buttons (and the ←/→ keys) step through the line on the board
  - key squares are highlighted
  - `better.summary` shows below
- **"What he could do to you":** shown when `punishment` exists, with the same stepper.
- **The real game:** the user can also step through the actual game, with a toggle for "The game" / "Better line".

- [ ] **Step 1: Write the failing tests.**
  - `board oriented black for black user`
  - `calm moves collapsed into summary text`
  - `stepping better line advances board fen and shows step note`
  - `punishment stepper hidden when null`
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Hand off for commit.** Do not run git. Report the changed files and suggest a commit description ("walkthrough") — the user commits.

### Task 14: Threshold tuning on real games + end-to-end check

**Files:**
- Create `scripts/tune-report.ts` (run with `npx tsx`). It loads a PGN, runs `analyzeGame` with a Node Stockfish (the `stockfish` package's Node entry, or a local `stockfish` binary via `child_process`, whichever works), and prints moments per game and the distribution of mistake types.
- Modify `src/analysis/winprob.ts` constants if needed. If you change them, bump `ANALYSIS_VERSION`.

- [ ] **Step 1: Get real games.** Export ≥ 30 of the user's real games (rapid + blitz). Ask the user for the PGN or their username, and save it as `tests/fixtures/user-games.pgn`, gitignored.
- [ ] **Step 2: Measure.** Run `npx tsx scripts/tune-report.ts tests/fixtures/user-games.pgn`. Expected output: mean moments/game, plus a histogram.
- [ ] **Step 3: Tune.** Adjust `FLAG_DROP` (range 12–25) until the mean is within **3–6 moments per game**. Record the chosen value and the measured mean in a comment next to the constant.
- [ ] **Step 4: Spot-check.** Read 10 random moments in the browser walkthrough. Each one must:
  - have a real, visible motif or a plainly described big swing
  - have no engine numbers
  - point the "his/your" wording the right way

  Fix any wrong detector before continuing.
- [ ] **Step 5: Run `npm test && npm run build`.** Expected: all tests pass, and the build succeeds with `public/engine/` copied into `dist/`.
- [ ] **Step 6: Hand off for commit.** Do not run git. Report the changed files and suggest a commit description ("tune flag threshold on real games") — the user commits.
