---
name: review-card
description: Adversarial review of the changes for a GovTok card by one fresh agent that checks both lenses — implementation vs. acceptance criteria (small picture) and scope/alignment with GOVTOK_DECISIONS.md (big picture). Use when a card's implementation is done (working tree has uncommitted changes, or the branch has commits ahead of main) and you want a skeptical pre-commit/pre-PR review, not a rubber stamp.
metadata:
  author: david
  version: "0.2.0"
---

# Review card

Pairs with `start-card`: that skill ramps up *before* writing code, this one reviews *after*. Never review your own work by re-reading your own diff and agreeing with yourself — the whole point is a fresh agent with no stake in the implementation.

One reviewer covers both lenses (2026-10-28, to cut usage: the earlier two-reviewer version paid for the same spec, diff and test runs twice).

## 1. Identify the card

Same as `start-card` step 1: use a passed-in issue number/slug, or extract the card ID (`US37`) from the current branch name. If the branch doesn't look like a card branch, ask which card is being reviewed.

## 2. Determine what to review

- `git status --short` and `git diff` for uncommitted working-tree changes.
- `git log --oneline main..HEAD` (or the actual base branch) for committed-but-unmerged commits on this branch.
- If both are empty, there's nothing to review — say so instead of inventing a review.
- If both are non-empty, review the union (uncommitted + branch commits) — that's the full set of changes that would land in the PR.

## 3. Gather context (once, before spawning)

Do this yourself, before spawning the reviewer, so it doesn't spend tokens re-deriving it:

- `gh issue list -R StreetLamp05/TranslucentGov --search "<ID> in:title" --state all --json number,title,body,parent` for the card's own acceptance criteria, and the parent Feature's body for the sibling list (`Children: ...`). Only the "Acceptance criteria" list counts as ACs. A "Manual test (human, …)" section holds phone checks the user runs after merge: list it in the report as "for the user", but never review it, and never leave a card unchecked or NEEDS_INPUT because of it.
- The card's `Spec §` reference(s) — read that full numbered subsection of `GOVTOK_DECISIONS.md`, not just the cited bullet.
- `git log --oneline -20` plus `git show --stat <sha>` for the most recent 1-2 merged sibling cards under the same Feature, to know the expected file footprint and established conventions (naming, test harness shape, comment style) this card should match or deliberately deviate from.
- Relevant bits of `CLAUDE.md` (already in context) — in particular whatever convention applies to this card's area (e.g. the translation rule for scope).

## 4. Launch one adversarial reviewer

Make **one `Agent` call**, `subagent_type: general-purpose` (fresh — not `fork`; independence from your own reasoning is the point of adversarial review). The prompt must be fully self-contained: repo path, branch, exact files changed (from step 2), the verbatim acceptance criteria, the relevant spec text, the sibling-story list, and the sibling-precedent commits' `--stat` output — a fresh agent has none of your conversation context. Instruct it to verify everything itself (read the actual diff) rather than trust anything in the prompt as ground truth about current file contents. Tell it to be skeptical: finding nothing wrong should require a genuinely hard look, not a skim.

**Don't re-run the full suite.** The implementer runs `npm test`, `build`, `lint` and `tsc` before handing off, and the merger runs them again before merging. The reviewer runs only the targeted commands it needs as proof: a single test file, a script, a codegen diff, one live call. It never re-runs the whole gate just to see it pass.

**Lens 1 — implementation/AC (small picture).** Ask it to:
- Check the change against every acceptance criterion literally, and against the exact spec text (field types, optional vs required, indexes, auth checks inside each query/mutation, or the equivalent precision for whatever the change actually is — function contract, UI behavior, etc.).
- Verify generated/derived artifacts actually match their source (e.g. run `npx drizzle-kit generate` and expect "No schema changes" when the card touches `server/db/schema.ts`) rather than assume they were regenerated correctly.
- Verify any new test actually tests what it claims — not tautological, not weakened relative to sibling tests covering the same shape.
- Where an AC is about runtime behavior, run the narrowest thing that proves it rather than review only statically.

**Lens 2 — scope/spec alignment (big picture).** Ask it to search `GOVTOK_DECISIONS.md` for other mentions of the entities this card touches (grep, then read the hits, not the whole file), and to:
- Check for scope creep (doing a sibling story's job early) or under-scoping (silently deferring something this card's own spec section requires now).
- Check the file footprint against the precedent commits — flag unexplained drift into unrelated areas.
- Check for contradictions with other locked decisions elsewhere in the spec (a later section that assumes a shape this change doesn't provide, or vice versa).
- Flag anything that creates avoidable schema/design debt, even if not strictly required by the acceptance criteria — and separately flag any *pre-existing* spec inconsistency it notices along the way (this card doesn't need to fix those, but they're worth surfacing).
- For anything touching user data: confirm the privacy/screening posture matches the spec (§7, §4.2) and how comparable existing functions handle it.

The reviewer ends with: findings ranked most-severe first, grouped by lens (say explicitly if none survive scrutiny — don't pad with nitpicks to seem thorough), and a one-line verdict per lens. It must also report, per acceptance criterion, exactly what it did to verify that criterion and what the result was (a command it ran and its output, a file/line it read and what it showed, a test it executed and its pass/fail) — not just "looks correct."

## 5. Report

When the notification arrives, turn it into one concise report for the user:

1. **Acceptance criteria checklist** — one line per AC from the issue, each checked off (`- [x]`) only if the reviewer's report actually substantiates it, with the proof inline or immediately below it (the command/output, file:line, or test result it cited). An AC the reviewer couldn't verify, or verified only partially, stays unchecked (`- [ ]`) with a note of what's missing — never check a box the evidence doesn't support.
2. **Findings**, grouped by lens (implementation/AC, then scope/spec-alignment), most severe first, with the concrete failure scenario for each — not "best practice" hand-waving.
3. A one-line verdict: does the implementation satisfy its acceptance criteria, and is it correctly scoped.

If the reviewer surfaces a blocking finding, say so plainly and stop — don't silently patch it yourself. Fixing is a separate, explicit step the user asks for after seeing the review. (When `run-card` launched this review, its session fixes findings that need no decision afterwards, per `run-card` step 4. The reviewers still never fix.)
