# Chess Trainer: decisions made during the build

Every decision the build made on the user's behalf, in order, with what it costs if wrong. Copied from the build ledger (2026-10-21).

## Rulings
- Ruling R1: No git writes by anyone; review packages are snapshot diffs of the working tree — user's explicit rule — cost if wrong: none to code; reviews slightly less granular.
- Ruling R2: Work on main in place, no worktree/branch; don't pause per task, user commits at end with per-task file list I provide — user owns git and asked me to proceed — cost if wrong: user commits one big batch instead of per task.
- Ruling R3: Game id = synchronous inline hash (FNV-1a 64-bit hex or small SHA-1), not crypto.subtle — keeps parseGames sync as the plan's signature requires — cost if wrong: re-hash invalidates cache once.
- Ruling R4: Task 1 fixtures are hand-authored, realistic Chess.com-format PGNs (headers incl. TimeControl, ECO, ECOUrl, %clk) with username "fixture_user"; real games come in Task 14 — no username yet — cost if wrong: fixture drift from real exports, caught in T14.
- Ruling R5: Scaffold Vite in a temp dir and copy in, preserving README.md, docs/, and merging .gitignore — dir is non-empty — cost if wrong: none.
- Ruling R6: Task 8 adds MistakeType, ExplainedLine, MoveEval, Moment, GameAnalysis, ANALYSIS_VERSION to types.ts exactly as listed in Task 9's Produces block; Task 9 consumes them — T8 needs the types first — cost if wrong: none.
- Ruling R7: ignored-threat = a user piece hanging in fenBefore that was not hanging before the opponent's last move, AND punishment.uci[0] captures on that square. nullMoveFen is used only for threatLine (stops-threat) — matches the spec's "opponent threats the user didn't answer" — cost if wrong: misclassified type labels.
- Ruling R8: ReportView props = { report, filter, onFilter(f), onOpenExamples(key), onOpenExample(ref) } — test needs it — cost if wrong: none.
- Ruling R9: Task 14 Step 1 asks the user for their Chess.com username (only they know it); tasks 1–13 run first — cost if wrong: brief wait at the end.
- Task 4: Ruling: onerror handling elevated Minor→Important — missing engine file would freeze app silently — cost if wrong: small extra code
- Task 5: Ruling: mockup FEN had a black pawn on c7 (so Nxc7+, not quiet fork). Changed plan FEN to r3k2r/pp3ppp/8/3N4/8/8/PPP2PPP/R3K2R w - - 0 1 (no c7 pawn) everywhere; briefs 5–14 regenerated — keeps the spec's "Nc7+ check, attacks the rook too" example exact — cost if wrong: none
- Task 6: Ruling: accept implementer's added "payoff" rule (fork/pin/skewer/discovered need a later mover capture on a motif keySquare within cap) — enforces spec anti-goal "never invent a reason" — cost if wrong: some real motifs fall back to plain "this wins material" copy
- Task 6: Ruling: recapture-as-"free piece" elevated Minor→Important; add LineContext.prevMove? + Motif.recapture? so Task 8 says "take back" — user-facing wording accuracy — cost if wrong: small type addition
- Task 6: Ruling: callers (Task 9) pass LineContext.prevMove ONLY when the previous move was a capture — recapture flag otherwise ambiguous — cost if wrong: "take back" wording on non-recaptures. CARRY TO TASK 9 DISPATCH.
- Ruling: discovered CHECK (moved piece then wins material, e.g. q3k3/8/8/8/4B3/8/8/4R1K1 w Bd5+ Kf8 Bxa8) gets no label — common 1000-level tactic, so fold the fix into Task 7's dispatch (when uncovered target is king, moved piece's attacked targets join payoff set) — cost if wrong: small scope creep in T7
- Task 7: Ruling: accept extra stops-threat rule (threat's first move now lands on a square where its piece is hanging and capturable, not hanging before) + never stops-threat when pv[0] gives check — literal brief rule cannot detect a defence by replaying the unchanged threat — cost if wrong: some real prophylaxis unlabelled
- Ruling: Task 8 open-file copy must distinguish rook/queen and open/half-open (use Motif.piece, non-empty targets = half-open) — CARRY TO TASK 8
- Task 7: Ruling: pawn-break requires king-shield pawn + enemy king off d/e files; add Motif.subtype 'king-attack'|'opens-file' — Task 8 copy needs it (CARRY TO TASK 8) — cost if wrong: fewer pawn-break labels
- Task 8: Ruling: Task 9 sets Moment.pieceInvolved = threatened piece 'x@sq' for ignored-threat; explain names it only if it matches punishment capture square, else generic — CARRY TO TASK 9 — cost if wrong: generic wording more often
- User username for Task 14: neymessiz (Ruling R9 resolved)
- Task 9: Ruling: accept implementer calls — punishment null unless motif/ignored-threat/gains ≥1 material (avoids "wins material" on nothing); last-ply move counts as punished; winBefore≥10 kept as written (redundant with FLAG_DROP) — cost if wrong: fewer punishment lines shown
- Task 9: Ruling: drop candidate when deep MultiPV has played move within 10 of best — horizon disagreement means not a real mistake; reduces flooding — cost if wrong: a few real mistakes missed
- Task 9: Ruling: pieceInvolved names the USER's piece for all types (needed by T11 grouping) — elevated to Important — cost if wrong: none
- Ruling: fold Task 1 minors into Task 11 dispatch: opening family with >3 words → first 2 words (Ruy Lopez Morphy Defense → Ruy Lopez) and decodeURIComponent try/catch — repeated-situation grouping depends on stable families; malformed header must not crash — cost if wrong: coarser families
- Task 11: Ruling: same-position wording "...in {reached} games and made the same kind of mistake in {n} of them" when not every visit erred — literal truth — cost if wrong: none
- Ruling: Task 12 Step 5 (browser check) done by controller via Chrome after implementer finishes — subagent can't drive a browser — cost if wrong: none
- Ruling: real-world bug found in browser — Chess.com current-month {archive}/pgn returns 404 → importer said "not-found". Task 2 deferred minor promoted to Important; fix dispatched (task-2b): JSON archive endpoint, skip failing archives, partial on 429 — cost if wrong: none
- Ruling: real-game browser check found 3 false/cluttered copy issues → fix dispatched (task-copyfix): "He answered with" only when actual reply matches; hanging-piece defended flag ("free to take" only if undefended); trim shown lines after last noted ply (keep mate lines); ANALYSIS_VERSION bump — cost if wrong: cache recompute
- Ruling: "worth more than" clause only when victim value > capturer value — folded into Task 14 dispatch — cost if wrong: none
- Ruling pending user: 3–6/game target (my own spec call) unreachable via threshold — asking user whether to add a material-loss trigger
- USER DECISION: also flag clear material blunders in decided games (ranked lower). Ruling: material trigger via pass-1 PV gain ≥2 in 6 plies + avoidable check; Moment.trigger/materialLost; cost min(flagDrop−1, 4×materialLost)×shortness; decided only for swing — cost if wrong: retune
- Task 14 rounds 2–3 done: mean 1.30 moments/game (swing 1.05, material 0.24) on 37 games; 205 tests. Ruling: drop unexplained/lost-mate material moments (user wants habit examples) — cost: loses a few true-but-unmotivated losses (e.g. already-pinned knight won by pawn)
- Ruling: accept 1.30/game; the 3–6 target was my own spec estimate, superseded by real-data measurement + user's "important, human-noticeable" goal — cost if wrong: user wants more volume → lower threshold later
- Ruling: one fix wave incl. I1–I4, M1, M2, M5, M6, M8, version 5, README; leave M3 (materialLost line mismatch), M4 (silent failed games), M7-hosting impl — cost if wrong: small inaccuracies in rank weight / missing note
