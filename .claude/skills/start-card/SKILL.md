---
name: start-card
description: Orient on the card currently being worked (from the branch name or an issue number arg), read its spec section and related cards, then begin work. Use when starting work on a new/existing GovTok user-story or feature card — the "read the card, read the spec, ask questions, then start" ramp-up.
metadata:
  author: david
  version: "0.1.0"
---

# Start card

Ramp-up sequence for beginning (or resuming) work on a GovTok card. Run every step below before writing any code.

## 1. Identify the card

- If an issue number or branch-style slug was passed as an argument, use that.
- Otherwise, use the current git branch (`git branch --show-current`) — branches are named after their card per CLAUDE.md's "Create a branch" convention (e.g. `US3-upload-a-video-to-minio-storage`). Extract the card ID (`US3`) from it.
- If the branch doesn't look like a card branch (e.g. `main`, or an unrelated name), ask the user which card they mean rather than guessing.
- Claim it. Two people work this board, and the assignee owns the card. Check `gh issue view <n> -R StreetLamp05/TranslucentGov --json assignees`. If it's assigned to someone other than you (`gh api user --jq .login`), stop and ask the user before doing anything, because their partner is likely already on it. If it's unassigned, run `gh issue edit <n> --add-assignee @me -R StreetLamp05/TranslucentGov`. `dispatch-cards` has usually done this already.
- If no branch exists yet for the card being started, create one — but **match this repo's naming convention exactly**: `<CardID>-<kebab-case-title>` (e.g. `US19-build-table-view-ui`), card ID first, title lowercased. `gh issue develop <issue-number> --checkout --name "<CardID>-<kebab-title>` based off of up-to-date main.

## 2. Read the card itself

- `gh issue list -R StreetLamp05/TranslucentGov --search "<ID> in:title" --state all --json number,title,body,parent` to get the issue body (acceptance criteria) and its parent Feature.
- Also pull the parent Feature issue's body for the "Children: ..." list — this tells you the card's siblings (already-done and still-open) without having to guess dependency order.

## 3. Read the spec

- Find the card's `Spec §` reference (in the issue body, or via `gh project item-list 19 --owner StreetLamp05 --format json` cross-referenced by issue number if not stated on the issue itself).
- Read that section of `GOVTOK_DECISIONS.md` in full — not just the referenced bullet, enough surrounding context (the whole numbered subsection) to catch adjacent constraints.

## 4. Read related/prior work

- Check recent `git log --oneline -20` for merged sibling cards under the same Feature (stories under one Feature usually build on each other). Read the actual diffs of the most relevant merged siblings (`git show <sha>` or `git diff <merge-base>...<sha>`) rather than assuming from the issue text alone — prior stories often establish a convention (naming, error handling, test harness shape) this card should follow, not reinvent.
- Skim `CLAUDE.md` for any convention that applies (e.g. the translation rule, status flow) — it's already in context automatically, but re-check it against this specific card's acceptance criteria.

## 5. Check readiness

Run through CLAUDE.md's Definition of Ready checklist for this card:
1. Spec § reference actually says what the card claims.
2. Acceptance criteria are checkable, not a restatement of the title.
3. It's independently shippable, or its dependency is linked and already merged.
4. Size is set and believed.

If something fails, surface it rather than silently working around it — the card may need to go back to Refinement.

## 6. Ask, then start

- If acceptance criteria are ambiguous, a design decision isn't covered by the spec, or a dependency looks unmerged/incomplete, ask the user (`AskUserQuestion`) before writing code.
- Otherwise, summarize the plan (per the global CLAUDE.md plan-mode default for non-trivial work) in `tasks/<CardID>-todo.md` (one file per card, never a shared `tasks/todo.md`) and begin.
