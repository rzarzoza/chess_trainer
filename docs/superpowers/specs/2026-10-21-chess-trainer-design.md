# Chess Trainer: Game Analysis & Weakness Report — Design

Date: 2026-10-21

## Intent and the why

The user plays on Chess.com (rapid/blitz ≈ 1000, bullet ≈ 1200). They make a lot of mistakes but don't know *which* ones matter most or *what to train*. They suspect they play very similar games every time and repeat the same mistakes without noticing.

The tool reads their games, finds the moments that actually decided them, groups those mistakes into recurring patterns, and tells them **what to train first**, backed by **concrete examples from their own games** that it can **walk them through step by step**.

It starts as a tool for the user, but it should be able to grow into a public website that anyone can use.

## Success looks like

- The feedback is **detailed** and highlights **important** things, not noise.
- Every flagged mistake is **human-findable**. A deep engine-only idea ("mate in 34") is never presented as a miss.
- The user can open an example and understand exactly where they went wrong, why, and what they should have played. They see the missed line played out move by move.

## Anti-goals (a failure even if it technically works)

- An engine dump: centipawn numbers, long lists of tiny inaccuracies, lines no 1000-rated player could follow.
- Made-up explanations. If the tool says "missed fork", there must actually be a fork in that line.
- A plain game-by-game replay with no patterns or priorities.

## Non-goals for v1

- AI/LLM-written explanations. They need a server and cost money per game, so they're a later option.
- User accounts, cloud storage, multiplayer, or social features.
- Lichess or OTB-specific import (a generic PGN upload covers these anyway).
- Puzzle/drill generation from mistakes. It's a natural v2, but not v1.

## Constraints and decisions made

- **Platform (my call, the user agreed with the direction):** a static website. Everything runs in the browser, including Stockfish compiled to WebAssembly in a Web Worker. No backend, so it costs nothing to host, the user's games never leave their computer, and it works for anyone later. The user is fine running terminal commands, so local dev tooling is fine.
- **Input:**
  - Upload one or more `.pgn` files (a Chess.com export).
  - **(My call)** Optional: type a Chess.com username to fetch recent games via Chess.com's public API (`api.chess.com/pub/player/{user}/games/archives`). This needs no auth and is CORS-enabled.
- **Which side the user played:** detected from the username. Ask once on PGN upload if it's ambiguous.
- **Time controls:** results are split and filterable by Rapid / Blitz / Bullet / All (from the PGN `TimeControl` tag).
- **Caching (my call):** per-game analysis results are stored in IndexedDB, keyed by a game hash, so each game is only analysed once. Show progress, and let the report fill in as games finish.
- **(My call) Analysis speed:** "10–15 min per ~100 games" is an estimate, not a promise. Use two passes:
  1. A quick pass over every move to find candidate swings.
  2. A deeper pass, with MultiPV, only on the candidate moments, to verify the tactic, find the reasonable alternative, and build the explained line.
  Pick depth for quality over speed, within reason.
- **Target level:** tuned for a ~1000-rated player, focusing on big swings.
- **Language:** English only (user's decision). No translation layer is needed.

## What counts as a mistake (decided with the user)

1. **Only flag moves where the user's position got noticeably worse.** These are the big swings, not small inaccuracies. **(My call)** Tune the threshold so a typical game yields roughly **3–6 flagged moments**. Use win-probability drop rather than raw centipawns, so that dropping from +8 to +6 isn't flagged but dropping from +1 to −2 is.
2. **The better move must be human-findable.** Two kinds are allowed:
   - **Tactics:** forks, pins, skewers, hanging/undefended pieces, missed mates, discovered attacks, and **opponent threats the user didn't answer**. The user said the missed line can be **up to about 9 moves deep**, but that is a **broad, soft limit, not a hard cut-off**. What matters is that the move clearly and understandably improves the position, not how many moves the line takes. Don't restrict it to 3–4-move tactics. **(My call)** Treat about 9 of the user's own moves as the outer edge. Shorter tactics still rank higher in the report, because those are what a 1000 player should be spotting now.
   - **Clear positional improvements** with an understandable reason: rook to an open file, a pawn break against the king, trading into a won endgame, stopping the opponent's attack before it starts, etc.
   - **Exclude** engine-only ideas with no explainable reason, and very long lines.
3. Also track **what the user actually did wrong**, not just what they missed: hung a piece, walked into a fork, ignored a threat, and so on. Both sides of the mistake matter.
4. **(My call) How "human-findable" applies to both sides of a mistake:**
   - A move is flagged if **either** the punishment of the user's move **or** the better move is human-findable under the rules above.
   - If the user's move only loses to a deep engine refutation, **and** no findable better move existed, it is **not** flagged.
   - When the engine's best move is an engine-only idea but a simple, explainable good move exists, the tool shows the **simple move** as "what you could have played", not the engine's top choice. This needs a "reasonable alternative" search (e.g. MultiPV).
   - The "3–6 moments per game" target is measured **after** this filtering.
   - If the opponent didn't actually punish the mistake, say so ("he didn't take advantage, but next time someone will").

## Explanations

- **(My call)** Explanations are generated **from the real position**, using rule-based detectors (fork, pin, skewer, hanging piece, undefended piece, mate threat, open file, pawn break, king safety, material trade into a won endgame). The engine finds the moves. The detectors say *why*. If no detector can explain a move, the tool describes it plainly ("this wins material" / "this was much stronger"). It never invents a reason.
- Plain chess language: "his knight was attacking your rook and you didn't move it," never "−3.2".
- Tactical explanations will be stronger than positional ones in v1. That's accepted.

## Pattern finding

- **Mistake types:** count each type, and rank by **how much it cost** (how many games it decided, plus win-probability lost), not just by how often it happened.
- **Repeated situations:** group games by opening (ECO / opening name from the PGN, or from the move sequence) and by the side played. Find openings and positions where the **same mistake recurs**. Example: "Italian Game as White: 19 games, in 7 of them you took on e5 too early and lost the e4 pawn." **(My call)** Start with opening + first-mistake-in-opening grouping. Similar-structure matching later in the game is a stretch goal.
- **Game phase:** opening / middlegame / endgame breakdown of where mistakes happen.
- **Time trouble:** if clock data is in the PGN (Chess.com includes `%clk`), flag mistakes made with little time left so they can be separated out.

## Screens (user saw and liked a mockup)

### 1. Report

- Header: number of games analysed, plus a time-control filter (All / Rapid / Blitz / Bullet).
- **"Train these first"**: a ranked list of weaknesses. Each card has a small board showing a typical example, a cost bar, a count ("happened 23 times · decided 9 of your losses"), a one-line note on when it tends to happen, and "See all examples →".
- Repeated-situation cards appear in the same list ("Italian Game as White…" → "Walk me through it").
- Secondary sections: mistakes by phase, by time pressure, and by opening.

### 2. Example list

All examples for one weakness, each with a mini board, the opponent, the time control, the move number, and the result. Click one to open the walkthrough.

### 3. Walkthrough (the core experience)

- Board plus a move list colour-coded **good / inaccuracy / blunder**.
- **Fast-forwards through the calm part** ("Moves 1–17: solid") and stops at the turning point.
- An explanation panel says what was fine, then what went wrong at the key move and why ("His king just went to e8 and his rook is on a8, both a knight's jump from c7. Missed: knight fork.").
- **"What you could have played":** the better line, with ◀ ▶ step controls that play it on the board and annotate each move ("18. Nc7+ check, and it attacks the rook too… 18…Kd7… 19. Nxa8, you win a rook").
- Highlight the key squares and pieces on the board.
- The user can also step through the rest of the actual game.

## Left to the builder

- Framework, build tooling, chess libraries (chess.js / chessground or similar), and Stockfish WASM build choice.
- Engine depth/time per position, and the exact win-probability formula and thresholds (within the "3–6 moments per game" target).
- Exact detector implementations and the mistake-type taxonomy beyond the types listed above.
- Visual styling. The mockup sets layout and content, not the final look.
- Testing approach.
