---
name: run-card
description: End-to-end card run for GovTok — runs `start-card` (ramp-up + implementation) in this session, then runs `review-card`, which hands the finished change to one fresh adversarial reviewer. Pings the user's phone via PushNotification whenever a stage needs their input. Use when the user wants to start a card and have it built and reviewed hands-off.
metadata:
  author: david
  version: "0.1.0"
---

# Run card

Chains `start-card` → implementation → `review-card` so a card can go from branch to reviewed change without the user watching. This skill only orchestrates — the per-stage instructions live in `.claude/skills/start-card/SKILL.md` and `.claude/skills/review-card/SKILL.md`; follow those, don't restate or drift from them.

## Ping rule (applies to every stage)

The user is assumed to be away from the terminal. Any time you need their input, **send `PushNotification` first, then ask** — `AskUserQuestion` blocks silently, so without the ping the run just stalls unseen.

- Message: one line, <200 chars, no markdown, lead with the card ID and what they need to decide. E.g. `US7 needs you: AC3 conflicts with spec §5.1.1 (autoplay vs tap-to-play) — pick one`.
- Ping only for things that genuinely need the user: an ambiguous AC, a decision the spec doesn't cover, a Definition of Ready failure, an unmerged dependency, a failing build/test you can't resolve from the code, or a review finding that needs their decision (step 4). Never ping for routine progress.
- Phone delivery requires Remote Control to be connected; a "not sent" result just means it was redundant or had nowhere to go — carry on and ask anyway.
- Subagents can't reach the user. Only this (main) session pings or asks.

## 1. Start the card

Invoke the `start-card` skill (via `Skill`, passing through any issue number/slug argument this skill received) and follow it through step 6.

- Its "ask, then start" step is where most pings come from — apply the ping rule there.
- Invoking `run-card` is the user's go-ahead to implement: write the plan to `tasks/<CardID>-todo.md` (e.g. `tasks/US4-todo.md`; one file per card so parallel cards never collide) and begin without waiting for plan approval, **unless** step 5/6 surfaced something that needs a decision — then ping and ask.

## 2. Implement and verify

Build the card per the plan, tracking progress in `tasks/<CardID>-todo.md`. Before handing off, prove it works per the global "Verification Before Done" rule: run the relevant build, type check and tests (and, for schema changes, `npm run db:generate` plus `npm run db:migrate` against the worktree's database). If something fails and the fix isn't determinable from the code/spec, ping and ask rather than pushing through.

Other `run-card` sessions may be running in sibling worktrees (see `dispatch-cards`). Each worktree has its own database and bucket in the shared compose stack: run `scripts/worktree-setup.sh` once, and never point a worktree at another's `DATABASE_URL` or bucket. Don't run `docker compose down -v`, which wipes every worktree's data.

Do **not** commit or push — git is manual for this user.

## 3. Review

Invoke the `review-card` skill in this session and follow it. It gathers the context, then launches **one** fresh `general-purpose` reviewer (not `fork`), so the review stays independent of your reasoning about the implementation. There's no separate coordinator agent: that layer re-read everything the reviewer reads and cost as much as a reviewer (2026-10-28, cut to save usage).

- Don't feed the reviewer your own account of the change beyond what `review-card` step 3 lists. Let it read the diff itself.
- The reviewer must **not** fix anything, ask the user anything, or commit. It also skips the full test/build gate you already ran in step 2 (see `review-card` step 4).
- Wait for its completion notification; don't poll and don't start reviewing in parallel yourself.

Then write the review-card report, ending with exactly one machine-readable line:
- `RUN-CARD-VERDICT: CLEAN` — every AC checked off with proof, no blocking findings.
- `RUN-CARD-VERDICT: NEEDS_INPUT — <one-line reason>` — any unchecked AC, or a blocking finding.

## 4. Fix what needs no decision

Sort every finding in the report, blocking or not, into one of two groups:

- **Fix:** a defect with one obviously correct fix inside the card's scope. Examples: a reproduced bug, a missing error path, a stale-state race, misleading error text, a doc comment, or matching a sibling card's text to avoid a merge conflict. Nothing about the product, spec or AC changes.
- **Decide:** anything that changes behavior the spec or AC defines, picks between reasonable options, widens scope, adds a prop or field another card will depend on, or would edit the spec. Also any finding that marks a spec inconsistency.

Fix the **Fix** group in this session without pinging. Add a regression test for each bug where one is practical, and re-run step 2's verification. Record each fix under a "Review fixes" heading in `tasks/<CardID>-todo.md`. Run one review round only. Re-review (step 3 again, with a fresh reviewer) only when a blocking finding needed a non-trivial change; otherwise step 2's re-verification is enough. If a blocking finding survives, treat it as **Decide**.

When unsure which group a finding belongs to, it's **Decide**.

## 5. Report

Relay the final review-card report to the user (it isn't shown to them automatically), meaning the AC checklist and findings, not a paraphrase that drops the evidence. Then list what you fixed in step 4 and what's left for them to decide.

- **Something still blocks, or a Decide item is open:** ping (`<ID> review: <reason>`), present the report and the Decide list, and stop. Don't act on Decide items yourself.
- `CLEAN`, or only fixed findings and non-blocking Decide items remain: ping once that it's ready for their manual commit (`<ID> done: all N ACs verified, review clean — ready to commit`), since the run can't finish without them either way. List any non-blocking Decide items in the message. Add the review section to `tasks/<CardID>-todo.md`.

Never declare the card ready for Todo or touch board status — that's a human call.
