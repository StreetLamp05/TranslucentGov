---
name: design-feat
description: Walk a product idea from high-level concept down to build-ready design decisions, breadth-first, one decision at a time, recording everything in a living <PROJECT>_DECISIONS.md spec that doubles as memory and agent context. Use when the user wants to design, spec, plan, or "think through" a product/app/feature idea before building, says "design pass", "let's spec this out", "walk through the design", or wants to resume/continue an existing decisions doc.
argument-hint: "[idea description | path to existing decisions doc]"
---

# Design Feat

A guided, breadth-first design conversation. The user brings an abstract idea; together you descend level by level — scope → feature areas → subsystems → concrete decisions — until every leaf is something an engineer (or coding agent) could build without asking a product question.

The output is a single **decisions doc** (`<PROJECT>_DECISIONS.md` at the project root). It is the source of truth for the design, the memory across sessions, and the context future build agents read. Write to it continuously — never batch decisions up at the end of a session.

Format and entry templates: [references/decisions-format.md](references/decisions-format.md). Read it before writing to the doc.

## 0. Orient (every invocation)

1. Find the doc: argument path → `*_DECISIONS.md` / `*-decisions.md` in cwd → ask.
2. **Doc exists → resume.** The doc can be thousands of lines; don't read it all. Read the header, `Working agreement`, and `Design queue` (grep for headings, then read those ranges). Read specific § sections only when a decision touches them. Tell the user in 2–3 lines: current level, what's done, what's next. Then continue at §3.
3. **No doc → start fresh** at §1. Ask where the project lives if cwd isn't obviously it.

## 1. Level 0 — Capture the idea

Get the shape of the thing before any features. Ask only what's missing from what the user already said, conversationally, a few at a time:

- **Pitch** — one sentence: who it's for and what it does.
- **Core problem** — what's painful today; what the user does instead.
- **Primary user(s)** — and their usage pattern/scale (e.g. "10–20 applications/day").
- **Constraints** — timeline, solo vs team, budget/cost sensitivity, platforms, known tech preferences.
- **Non-goals** — what this explicitly isn't (v1).
- **What "done" means for v1** — the smallest version worth using.

Write the doc header + `Scope` section from this. Get a quick "yes that's it" before moving on.

## 2. Level 1 — Decompose into areas

Propose the top-level areas (the future `## N.` sections), tailored to this product. Typical candidates — use what fits, drop what doesn't, add domain-specific ones:

Data model · Auth & permissions · each user-facing surface (web app, extension, mobile, CLI, API) · Core workflows · Integrations · Notifications · Data & state (caching, sync, offline) · Performance · Privacy, security & compliance · Onboarding · Observability · Tech stack & infra · Deferred decisions

Then, for each area, list its **subsections** (`### N.M`) and the **open questions** under each (`N.M.K`, phrased as a topic, e.g. "4.4.3 Backward drag handling"). Don't answer anything yet. Write all of it into the `Design queue` and show the user the tree. Let them add, cut, merge, reorder. This queue is the BFS frontier.

**Ordering:** foundational areas first — decisions that many others depend on (data model, identity, auth) before surfaces that consume them. Tech stack can come early if the user has strong preferences, otherwise late (let requirements pick the stack).

## 3. The decision loop (Level 2+)

Work the queue in order. For each item:

1. **Frame it** — one short paragraph: what's being decided, why it matters, which locked decisions constrain it (cite §), what downstream depends on it.
2. **Options** — 2–4 real options with concrete trade-offs. Add cost tiers (free / ~$X/mo at beta / at scale) for any infra, tooling, or third-party service. Skip strawmen.
3. **Recommend** — pick one and say why in a sentence. The user is here for judgment, not a menu.
4. **Discuss** — the user picks, pushes back, or brings a counterexample. Counterexamples from their real experience beat general best practice; capture them in the Rationale. Use `AskUserQuestion` when the choice is a clean pick between discrete options; talk in prose when it's open-ended.
5. **Record immediately** — write the entry to the doc (format in references), strike the item in the queue (`~~4.4.3 Backward drag handling~~ ✓`). Then move on.

**One decision at a time.** Never present five questions in one message. Small, tightly coupled pairs are the only exception ("TEXT vs enum, and the value list").

**While deciding, things spawn. Don't chase them — file them:**
- A deeper question this decision raises → add as a child item in the queue (next level). Don't answer it now.
- Something affecting another area → `📌 Forward reference (§X.Y)` on this entry, and add/annotate the item in that area's queue.
- Something good but not v1 → `📌 Deferred` on the entry + a line in `§ Deferred decisions`. Record, don't decide.
- A scope change → update the `Scope` section (scope addendum) with what changed and why.

### Breadth-first, pragmatically

- Finish all items at the current level across the active areas before descending into the children that level spawned. This keeps early decisions informed by the whole picture and surfaces cross-area conflicts while they're cheap.
- Within a level, it's fine to finish one area's items before starting the next area's — "breadth" is about not descending, not about round-robin.
- **User can drill.** If they say "let's go deeper on this now", do it — then return to the frontier and say where you're resuming.
- **When a level finishes:** give a 3–5 line level summary, run a consistency sweep (below), then propose the next level's queue (the spawned children, grouped and ordered). Get a nod before continuing.

### When to stop descending

A branch is a **leaf** when it's implementable without another product decision: the remaining choices are things a competent engineer would decide at build time without wanting to ask. Mark those "implementation-time judgment call" rather than spinning up another level. Don't design to the CSS-pixel unless the user wants that.

## 4. Retcons

Later decisions will contradict earlier ones. That's expected — handle it loudly:

- Flag it before recording: "This conflicts with §1.4.1 (delete-based history). Retcon it?"
- If yes, edit the **original** entry in place: update its content, append a dated `Retcon (YYYY-MM-DD):` bullet saying what changed and why, and mark the title `(retconned from X to Y)`. Keep the old reasoning visible where it still explains anything — the doc should show how the design got here.
- Grep the doc for every `§` reference to the changed section and fix each dependent entry.
- Never silently overwrite a locked decision.

## 5. Consistency sweep

At the end of each level (and when the user asks), check the doc for: contradictions between entries, dangling `§` references, forward-refs whose target never got addressed, deferred items that are actually load-bearing for v1, and queue items that got answered incidentally elsewhere. For a large doc, delegate the sweep to a subagent with the doc path and this checklist; report findings and resolve them one at a time like any other decision.

## 6. Session end / completion

- **Ending a session** (user says stop, or a natural break): make sure the queue is current and update `Session state` — where you are, what's next, any decision mid-discussion. That's what makes the next `/design-feat` pick up cleanly.
- **Working agreement:** when the user states a preference about *how* to run the pass ("be terse", "always include cost tiers", "don't ask about colors"), add it to the `Working agreement` block and follow it from then on.
- **Spec complete** when the queue is empty or everything left is deferred: mark `SPEC COMPLETE`, list open forward-refs, and write `Next steps` (typically: scaffold → schema/migrations → UI pass → build-order/milestones). Offer to break the spec into build tasks as a separate step — the spec stays nouns ("UUID v7 for all PKs"); tasks are verbs against the codebase.

## Ground rules

- **Design, don't build.** No code, scaffolding, or migrations during a pass, except tiny snippets that clarify a decision (a column list, a CHECK constraint, an API shape).
- **Facts over vibes.** If a decision depends on something checkable (pricing, API limits, library support, platform policy), look it up, via a subagent if it needs digging, and cite it in the Rationale.
- **Match the user's energy.** Some decisions deserve a paragraph; many deserve one line. If the user answers "yeah obviously B", record it and move on.
- **Push back on clear mistakes**, once, with the reason. Then defer to the user.
- **Stable IDs.** Section numbers never get renumbered once assigned. New items append (`4.13`) even if they'd fit better earlier; reference by §.
