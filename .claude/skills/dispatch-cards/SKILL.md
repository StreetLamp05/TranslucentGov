---
name: dispatch-cards
description: Pick every mutually independent GovTok user story from Todo that isn't claimed by someone else (no fixed cap: everything that can run concurrently does), assign them to the user, move them (and their parent Features) to In Development, and launch one Remote Control–enabled Claude session per card — each in its own git worktree and tmux window — running `run-card`. Use when the user wants to start a parallel batch of cards.
metadata:
  author: david
  version: "0.1.0"
---

# Dispatch cards

Fans out a batch of cards to parallel `run-card` sessions. Each runner is a **separate top-level Claude session** (not a subagent) so the user can attach to it directly in tmux or from the Claude app via Remote Control, and so it can ask/ping on its own — subagents can't use `AskUserQuestion` or `PushNotification`.

Constants (IDs come from `.planning/project-fields.json`, never hardcoded here):
- No cap on stories in flight. Every Todo story that's independent of the others and of what's already in flight gets dispatched (the user's call, 2026-10-24).
- tmux session `gt-cards`, one window per card named by card ID.
- Worktrees at `../TranslucentGov-worktrees/<CardID>` (outside the repo, so root `eslint .` / `git status` never see them).
- Assignee = claim. Two people work this board, and an assigned card belongs to its assignee. The dispatcher is `gh api user --jq .login` (`StreetLamp05` for David). Every dispatched story gets assigned to them (step 6), and cards assigned to anyone else are never picked.

## 1. Preflight — stop and tell the user if any fails

- `command -v tmux` — not installed → tell the user to run `! sudo apt install tmux`.
- `git fetch origin main`, then `git cat-file -e origin/main:.claude/skills/run-card/SKILL.md`. Worktrees check out the branch's own `.claude/skills/`, so `run-card` (and this skill's edits to it) must be merged to main before a runner can use it.
- The Status options in `project-fields.json` include `Todo` and `In Development`.

## 2. List what's in flight

`gh project item-list 19 --owner StreetLamp05 --format json --limit 500` (keep the output — item IDs are needed in step 6).

User stories are items whose title matches `^US\d+:` — match on the title, not the `user-story` label, since some cards are missing labels. Collect the stories in **In Development or Testing**. They don't limit how many cards start, but new picks must not conflict with them (step 4).

## 3. Build the candidate list

Todo user stories, ordered by milestone (earliest due first), then issue number. For each, `gh issue view <n> -R StreetLamp05/TranslucentGov --json number,title,body,parent,milestone,assignees`. Drop and record a reason for:

- **Claimed by someone else**: `assignees` includes anyone other than the dispatcher. Unassigned cards and cards already assigned to the dispatcher stay in.
- **Not agent-doable** — the ACs are actions only the user can take (submitting an external application, clicking through a third-party console, purchasing something).
- **Open blocker** — `gh api repos/StreetLamp05/TranslucentGov/issues/<n>/dependencies/blocked_by` returns any `open` issue.

## 4. Check independence

Cards are independent when they could be built at the same time from current main and merged in any order without one needing the other's code or producing merge conflicts.

Launch one `Plan` agent (read-only; keeps the footprint research out of this context). Give it the repo path, every remaining candidate (number, title, body, Spec §), and every story already In Development/Testing with its branch's actual footprint (`git diff --stat origin/main...origin/<branch>`). Ask it to read each card's spec section and the merged sibling precedent, then return, per card: predicted files/directories touched, whether it changes `convex/schema.ts`, and whether it changes Convex function signatures (which regenerates `convex/_generated`). Then a list of conflicting pairs, each with its reason. Pairs conflict when they:
- touch the same files or the same component tree (siblings under one Feature often do — e.g. multiple kanban stories all editing the board component),
- both change `convex/schema.ts` (schema conflicts, and the dev deployment can only hold one schema),
- both change the same Convex functions (`convex/_generated` conflicts),
- have one building on behavior the other introduces, even with no dependency link.

Candidates that conflict with an in-flight story are out. From the rest, greedily take candidates in step-3 order, skipping any that conflict with one already picked. Take every candidate that fits; never pick a conflicting card.

## 5. Confirm with the user

`AskUserQuestion` with the picks (ID, title, one-line footprint) and every skipped card with its reason. The user is at the terminal when they invoke this, so no ping is needed. Proceed only on approval; apply any swaps they ask for.

## 6. Claim and move cards on the board

First claim each picked story, right before moving it. Re-read its assignees, because the partner may have claimed it while step 5 waited. If someone else now holds it, drop it, tell the user, and don't create its worktree. Otherwise:

```bash
gh issue edit <n> --add-assignee @me -R StreetLamp05/TranslucentGov
```

Only stories get assigned. Parent Features stay unassigned, since both people work under them.

Then, for each claimed story, and for its parent Feature if it isn't already In Development:

```bash
gh project item-edit --id <item-id> --project-id <project.id> \
  --field-id <fields.Status.id> --single-select-option-id <fields.Status.options["In Development"]>
```

Item IDs come from the step-2 listing. If a parent Feature isn't on the board, `gh project item-add` it first. Apart from the assignee and Status, don't touch any other field, and don't move anything else.

## 7. Create branch + worktree per card

Run this from the main checkout, for each card:

```bash
branch="<CardID>-<kebab-title>"   # repo convention: ID first, title lowercased, non-alphanumerics → '-', e.g. US19-build-table-view-ui
gh issue develop <n> --list -R StreetLamp05/TranslucentGov   # if a linked branch already exists, skip the next line and
                                                          # instead: git fetch origin <it> && git worktree add <path> <it>
gh issue develop <n> --name "$branch" --base main --checkout \
  --worktree "../TranslucentGov-worktrees/<CardID>" -R StreetLamp05/TranslucentGov
```

The main checkout stays on whatever branch it's on.

Then prepare the worktree, which doesn't have the main checkout's untracked files:
- Copy every ignored env file: `git ls-files --others --ignored --exclude-standard | grep -E '(^|/)\.env(\.local)?$' | grep -v node_modules` → same relative path in the worktree.
- Install dependencies from the lockfile inside the worktree (`npm ci`, or the repo's package manager equivalent).
- Run `scripts/worktree-setup.sh` inside the worktree. The copied `.env.local` points at the main checkout's dev deployment; this swaps it for the worktree's own local one so parallel cards don't push schemas over each other. If it fails, don't launch that card's runner; report it with the skipped cards.

## 8. Launch the runners in tmux

```bash
tmux has-session -t gt-cards 2>/dev/null || tmux new-session -d -s gt-cards -n main -c "$PWD"
tmux set-option -t gt-cards remain-on-exit on
tmux new-window -t gt-cards -n <CardID> -c "<worktree-path>" \
  "scripts/with-node.sh claude --remote-control=<CardID> --permission-mode auto 'Run /run-card for issue #<n>'"
```

`scripts/with-node.sh` starts the runner on the repo's pinned Node (`.nvmrc`), so every `convex dev` it runs can push `"use node"` actions to the local backend.

Use the `--remote-control=<name>` form: the flag takes an optional value, so a space-separated name could swallow the prompt. The runner names itself after the card, so it's easy to find in the Claude app.

## 9. Report

A table with card ID, title, branch, worktree path, and tmux window, plus the skipped cards and their reasons. Then the user's next steps:
- `tmux attach -t gt-cards` (or open the named session in the Claude app). On a first launch in a new worktree directory, a runner may wait at the folder-trust prompt until the user accepts it.
- Each runner pings its own question or result, and commits nothing — the user commits from inside each worktree.
- After the PR merges: `git worktree remove ../TranslucentGov-worktrees/<CardID>`.
