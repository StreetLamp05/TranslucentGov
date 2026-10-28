# Decisions doc format

Modeled on `~/Desktop/Projects/hireharbor/HIREHARBOR_DECISIONS.md`, a finished example (~3k lines, §1–§12). Look at it for tone and density when unsure.

## Skeleton

```markdown
# <Project> — Design Decisions

Source of truth for design decisions made during the pre-build design pass.
Updated incrementally as decisions are locked in.

## Session state
- **Level:** 2 (subsystem decisions)
- **Last session:** 2026-10-05 — finished §1 Data model, started §2 Auth
- **Next up:** §2.2.1 Session lifetime
- **Mid-discussion:** (anything half-decided, with the options still on the table)

## Working agreement
- (how the user wants the pass run, e.g. terse; one decision at a time; cost tiers on all infra decisions)

## Scope
- **Pitch:** ...
- **Core problem:** ...
- **Primary users:** ... (usage pattern / scale)
- **Constraints:** timeline, team, budget, platforms
- **v1 =** ...
- **Non-goals (v1):** ...

### Scope addendum
- (dated scope changes: what moved in/out, why, which § it affects)

---

## 1. <Area>

### 1.1 <Subsection>

**1.1.1 <Topic> — <chosen option>**
- ...

---

## N. Deferred decisions (record, don't decide)

**<Group>:**
- <item> (§ where it came up)

---

## Design queue

### Level 2
**1.1 Identity and keys**
- ~~1.1.1 Primary key type~~ ✓
- ~~1.1.2 UUID version~~ ✓
- 1.1.3 URL identifier format

**2.2 Session management**
- 2.2.1 Session lifetime
- 2.2.2 Refresh strategy

### Level 3 (spawned, not started)
- 1.3.3a Interview round types (from §1.3.3)
```

Keep `Session state` and `Working agreement` near the top so a resume reads them first. Keep the `Design queue` at the bottom; it's the BFS frontier and gets edited constantly.

## Decision entry

Title states the topic and the choice, so scanning titles alone gives the design:

```markdown
**1.3.4 Non-linear transitions — warn, don't block**
- No DB-level transition CHECK. Any status → any status.
- UI shows a soft confirmation for terminal → non-terminal transitions.
- Rationale: real job search is non-linear (un-ghosting, rescinded offers).
```

Rules:
- Bullets are concrete: names, values, column lists, limits, defaults. A build agent should be able to act on them.
- **Rationale:** always present, one or two sentences. Include the user's counterexample if it drove the call ("user counter-example: real interview happened 60 days after OA").
- **Rejected:** list the alternatives that were seriously considered, with a few words on why they lost, when that'll stop someone re-litigating later.
- **Cost:** for infra/tooling/services, give tiers (free tier / beta / scale).
- Implementation notes go in a bullet labeled `Implementation note:`.

## Markers

| Marker | Meaning |
|---|---|
| `📌 **Deferred**: ...` | Good idea, not v1. Also add to § Deferred decisions. |
| `📌 **Forward reference (§X.Y)**: ...` | Affects another area; that area's queue item gets annotated. |
| `**Retcon (YYYY-MM-DD):** ...` | A later decision changed this one. Say what changed and why. |
| `(retconned from X to Y)` | Suffix on a retconned entry's title. |
| `✓ Recorded (YYYY-MM-DD) — ...` | Addition to an already-locked entry, e.g. a decision made later while building. |
| `~~item~~ ✓` | Queue item done. Annotate with a short note if the outcome was surprising: `~~4.6.5 Triage view~~ ✓ *(rejected; replaced by dashboard action item)*` |
| `— v1.1 (design locked, build deferred)` | Suffix on a section that's fully designed but scheduled after v1. |

## Completion block

When the queue empties, append after the last section:

```markdown
**SPEC COMPLETE.** All sections §1–§N locked. No open decisions remaining.

**Open forward-refs (deferred, not decisions):**
- 📌 ...

**Next steps when returning:**
1. ...
```
