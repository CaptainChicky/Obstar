# Implementation plan

Work the tasks in order. Each task is self-contained: finish and verify one before starting the
next. Do not batch commits across tasks.

## Ground rules

- **Comments.** Only describe what the code is doing logically, right now. No history ("used to
  be", "was broken because"), no references to this file or any other plan/markdown file, no
  citation chains. Keep them short. If you touch a line whose existing comment violates this,
  fix that comment while you are there — but do not go hunting outside your task.
- **Tests.** Only add tests for logic that cannot be checked by playing the game: race
  conditions, ordering/permutation invariants, state-machine transitions, arithmetic. Never add
  a test for a colour, a layout, a sprite, a feel/tuning value, or anything visible in sandbox or
  tester mode. Each task below states exactly which tests (if any) to add. Add no others.
- **Wire index vs panel index.** These are two different numbering schemes and mixing them is the
  single most common bug in this area.
  - *Wire index* is `entities/Player.js`'s `this.up` key order and is what `upNb[]`, `statMax[]`,
    and the `upgrade` packet all use:
    `0 MSpeed, 1 Reload, 2 BSpeed, 3 BPene, 4 BDamage, 5 BodyDam, 6 HpUp, 7 HpRegan`.
    **This never changes. Do not touch the server's stat indices.**
  - *Panel index* is the row order the upgrade widget draws, and is what number keys 1..8 map to.
  - `CONST.UP_ORDER[panelIndex] === wireIndex` is the only bridge between them.

---

## Task 8 — Port boss features from the wiki

This is a research-then-diff task, not a free-form rewrite. Deliverable: a set of small, cited
edits, one boss at a time.

For each of **Guardian, Summoner, Defender, Fallen Overlord, Fallen Booster** (find the exact
filenames under [diep_wiki/](diep_wiki) first — some are titled differently, e.g. "Guardian of the
Pentagons"):

1. Read the wiki page and write down, as a scratch list you do **not** commit, every concrete
   mechanic it states: HP, body damage, size, movement speed and pattern, drone/bullet counts,
   reload, spawn conditions and interval, XP reward, target-selection rules (e.g. bosses ignore
   players under level 15 unless provoked — see [diep_wiki/Diep.io.txt](diep_wiki/Diep.io.txt#L88)).
2. Cross-check each against `diepcustom/src/Entity/Boss/` — where the two disagree, diepcustom's
   source wins for numbers and the wiki wins for behaviour it describes that diepcustom does not
   implement.
3. Compare against this repo's current values in
   [public/SHARE/TanksConfig.js](public/SHARE/TanksConfig.js) (the boss class entries) and
   [lib/gameAI.js](lib/gameAI.js) (`guardianUpdate`, `summonerUpdate`, `defenderUpdate`,
   `boosterUpdate`, and their `*Motion` counterparts).
4. Fix only real mismatches. Remember every diep game-unit length converts to this project's
   units by `× 0.56`; damage/HP figures are already carried raw in most places — check the
   neighbouring comment for which convention a given field uses before converting.

Handle each boss in sections. No tests — these are values and behaviours verifiable in tester mode.

**Explicit known gap to fix first:** the "bosses do not target players under level 15 unless
provoked" rule. `bossDetect()` in [lib/gameAI.js](lib/gameAI.js#L311) has no level filter at all.
Add one: skip any candidate with `p.level < 15` unless that player is in the boss's provoked set.
There is already a provoke-memory concept for base drones
(`config.BASE_DRONE_PROVOKE_MEMORY`); mirror its shape rather than inventing a second one.

---

## Task 9 — Comment pass

Do this **last**, as its own commit, and touch nothing but comments.

Delete or rewrite any comment that:
- narrates history ("used to be", "the old form", "this used to", "was broken because",
  "reverted", "no longer", "since PENDING #n", "plan.md step 4", "Batch F", "K1", "C3", "T5").
- cites a plan/task/markdown file by name — `plan.md`, `PENDING.md`, `HANDOFF.md`, `issues.md`,
  `PLAN.md`, `temp.md`, or any bare item code like `#30`, `A4`, `E3`, `G1`.
- restates the code on the line below it.
- runs longer than about four lines without being load-bearing.

**ALSO REMOVE** comments that record an external citation such as
(`diepcustom/src/...`, `diep_wiki/...`, `diepindepth/...`)

Suggested order (worst offenders first, by volume):
[public/SHARE/TanksConfig.js](public/SHARE/TanksConfig.js),
[entities/Player.js](entities/Player.js),
[rooms/Room.js](rooms/Room.js),
[public/client/ui.js](public/client/ui.js),
[public/client/config.js](public/client/config.js),
[lib/gameAI.js](lib/gameAI.js),
[entities/Bullet.js](entities/Bullet.js),
[lib/config.js](lib/config.js).

Run the full test suite after a few files of change. A comment pass must not change behaviour; if a test
breaks you deleted code, not a comment.
