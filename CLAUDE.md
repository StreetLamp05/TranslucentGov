# GovTok — project & planning conventions

## Source of truth
- `GOVTOK_DECISIONS.md` is the design spec. Every locked decision lives there. Read its **Session state / handoff** block first when resuming.
- GitHub Project #19 (owner `StreetLamp05`, https://github.com/users/StreetLamp05/projects/19) is the execution board. Issues are the **work slice** of the spec, not a restatement of it (see the translation rule below).
- Stack (spec §1.1.1): Next.js (App Router) on Vercel, with Convex for the database, file storage, live updates, and server actions that call Claude.

## Card hierarchy
- **Feature** issues have the label `feature` and the title `F<N>: <name>`.
- **User story** issues have the label `user-story` and are linked as native GitHub sub-issues under their parent Feature (`gh issue create --parent <F-number>`).
  - **Title:** a short imperative name, e.g. `US1: Scaffold Next.js + Convex app`. Never the "As a developer..." phrasing.
  - **Body:** opens with the user-story sentence ("As a resident, I can..."), then the description and acceptance criteria.
- IDs are sequential (F1, F2, US1, US2…) and aren't tied to spec section numbers. Spec references live in the `Spec §` project field.
- A Feature gets as many stories as the work needs. Don't force an even split.

## The translation rule
The spec is written as **nouns describing a design** ("§1.1.1 Convex for file storage"). Cards must be **verbs against the codebase** ("As a resident, I can upload a video from my phone and watch it play back"). If a card title could be answered "yes, the spec says so" rather than "yes, I did it and can show you," it's wrong. Rewrite it or don't create it.

## Status flow (milestone-aware)
- **Backlog**: generated for a milestone that isn't current yet.
- **Refinement**: belongs to the current milestone but hasn't been human-verified.
- **Todo → In Development → Testing → Deployed**: the normal flow once verified.

Every generated card lands in **Backlog** or **Refinement**, never directly in **Todo**.

**Git is manual.** Agents never commit or push. Branches are named `<CardID>-<kebab-title>` (e.g. `US3-upload-a-video-to-convex-storage`), created with `gh issue develop` or the issue sidebar's "Create a branch" link.

**Task lists are per card.** Write the plan and progress to `tasks/<CardID>-todo.md` (e.g. `tasks/US4-todo.md`), never a shared `tasks/todo.md`. This overrides the global `tasks/todo.md` rule, so parallel cards can't collide on merge.

## Definition of Ready (Refinement → Todo)
A human confirms all of these:
1. The `Spec §` reference is correct: the cited section actually says what the card claims.
2. The acceptance criteria are checkable, not a restatement of the title.
3. The card ships on its own, or its dependency is linked (`blocked_by`).
4. `Size` is set and believed.

## Generation mechanics
1. **One spec section and one milestone per generation run.** Only generate cards for **locked** spec sections. Check that the queue item is struck (✓) in `GOVTOK_DECISIONS.md`.
2. **Write before you push.** Put proposed cards in `.planning/<milestone>-issues.json` for human review. Create real issues only in a separate, explicit step after approval.
3. **Check `.planning/manifest.json` first.** Skip any `Spec §` already listed there. After pushing, append `{specSection, issueNumber}` entries.
4. **Read field/option IDs from `.planning/project-fields.json`.** If the board changes, regenerate it with `gh project field-list 19 --owner StreetLamp05 --format json`.
5. **Push in batches of about 20,** with a short pause between batches, to stay under GitHub's secondary rate limit.

## Command reference
```bash
gh issue create --title "F1: ..." --body-file .planning/tmp-body.md --label feature --milestone "M1: Mableton demo day" -R StreetLamp05/TranslucentGov
gh issue create --title "US1: ..." --body-file .planning/tmp-body.md --label user-story --parent <F-issue-number> --milestone "M1: Mableton demo day" -R StreetLamp05/TranslucentGov
gh project item-add 19 --owner StreetLamp05 --url <issue-url>
# Field edits: IDs come from .planning/project-fields.json
gh project item-edit --id <item-id> --project-id <project.id> --field-id <fields["Spec §"].id> --text "§1.1.1"
gh project item-edit --id <item-id> --project-id <project.id> --field-id <fields.Status.id> --single-select-option-id <fields.Status.options.Refinement>
```

## Milestones
| # | Milestone | Due | Notes |
|---|---|---|---|
| 1 | M0: Cal Hacks submission | Sun 2026-10-25, morning PT | Working demo built from sample videos recorded in California. Team of 2 |
| 2 | M1: Mableton demo day | Fri 2026-10-30, 9am ET | Georgia 311 Challenge at Morehouse, with real Mableton posts |
