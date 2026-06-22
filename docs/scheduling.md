# Scheduling for later — design spec

Status: **proposal, not yet built.** Captures the model for fuzzy "schedule for
later" so we can review before writing code.

## Goal

Let a task be committed with varying precision instead of the current binary
("today / a specific day" vs "backlog"):

- **Today** — do it today (a hard, dated commitment).
- **This week** — sometime in the next several days.
- **This month** — sometime soon-ish.
- **Someday / maybe** — low intent, no clock.
- **A specific date** — a real deadline ("June 30").
- **Inbox** — captured, not yet triaged.

Plus a one-key "not for today" that bumps a task down these tiers.

## Non-goals (for now)

- Recurring tasks / repeats.
- Times of day, reminders, notifications.
- Calendar sync.

## The crux: don't let fuzzy scheduling break the Reckoning

The Reckoning is the product's soul. Today it fires on **incomplete leaf tasks
whose `plannedFor` date is strictly before today** (`selectors.leftoverLeaves` /
`dates.isLeftover`). It hard-gates the Today view until each leftover is
resolved.

If "this week" were modelled as a date, every such task would become a leftover
the next morning and trip the gate — turning a flexible horizon into a daily
wall of guilt. **So horizons must be soft: they never feed the Reckoning.** Only
concrete dated commitments do.

This gives us a clean two-tier intent model:

| Tier            | Stored as            | Reckons when overdue? |
| --------------- | -------------------- | --------------------- |
| Today / a date  | concrete date        | **yes** (the gate)    |
| Week/Month/Some | soft horizon         | no                    |
| Inbox           | unscheduled (`null`) | no                    |

## Data model

Replace `Task.plannedFor: ISODate | null` with a discriminated `schedule`:

```ts
export type Horizon = "week" | "month" | "someday";

export type Schedule =
  | { kind: "date"; date: ISODate }       // hard commitment (Today == date===today)
  | { kind: "horizon"; horizon: Horizon } // soft, fuzzy
  | null;                                  // Inbox / untriaged

export interface Task {
  // …
  schedule: Schedule; // was: plannedFor
}
```

Notes:

- **"Today" is not a horizon** — it's `{ kind: "date", date: todayISO }`. Keeping
  Today concrete is what preserves the Reckoning unchanged.
- **`null` (Inbox) stays distinct from `someday`.** Inbox = "not yet decided"
  (inbox-zero pressure to triage); someday = "deliberately parked." Collapsing
  them would lose the inbox-zero ethos.

### Migration (schemaVersion 2 → 3)

In `persistence.coerceTask`, map legacy data forward:

- `plannedFor: "YYYY-MM-DD"` → `{ kind: "date", date }`
- `plannedFor: null` → `null`

Coercion already tolerates unknown shapes; add `coerceSchedule(raw)` and bump
`SCHEMA_VERSION`. No destructive migration — old files load cleanly.

## Reckoning rules (after the change)

`leftoverLeaves` becomes: incomplete leaves where
`schedule.kind === "date" && schedule.date < today`. Horizons and `null` are
never leftovers. Everything else about the gate is unchanged.

## Horizon aging — two options

A "this week" task eventually outlives its week. Two ways to handle it; **I
recommend A** (keeps a single ritual; honours the user's wish for flexibility):

### A. Soft surfacing (recommended)

- Horizons are **relative and anchored at creation**: store
  `since: ISODate` (when the horizon was set) so we can show "carried 3 weeks."
- They **never gate**. A horizon whose nominal period has elapsed (e.g. a
  "week" task older than ~7 days) just sorts to the top of its bucket with a
  quiet "stale" marker. Re-triage happens when the user visits the Later view.
- One ritual only (the Reckoning). Horizons stay pressure-free but visible.

### B. Anchored promotion

- Store the target period: `{ kind: "horizon", horizon, anchor: "2026-W25" }`.
- On rollover, elapsed-period horizons collect into a lightweight **Horizons
  review** (separate from, and gentler than, the Reckoning) where you re-bucket.
- More structure and "teeth," but a second daily ritual risks ritual fatigue and
  competes with the Reckoning for attention.

Recommendation: ship **A** first; revisit **B** if stale horizons pile up in
practice.

## Views & grouping

- **Today** — unchanged (`schedule.kind === "date" && date === today` leaves).
- **Backlog → rename "Later"** — everything not Today/Inbox, grouped by horizon
  in order: This week · This month · Someday. Stale items float to the top of
  each group.
- **Inbox** — could become its own surface (the `null` tasks) to drive triage,
  or stay folded into Later as a leading "Inbox" group. Open question below.
- Project grouping is orthogonal and still applies within each.

## Keyboard & capture

- **`s` (schedule / "send later")** in normal mode opens a tiny inline picker:
  `Today · This week · This month · Someday · Pick a date… · Inbox`. Single key
  per tier for power users (e.g. `s` then `w`/`m`/`d`).
- **`t`** keeps its meaning (toggle Today). "Not for today" = `s` then choose a
  lower tier, or a dedicated `Shift+T` that demotes one tier
  (Today → week → month → someday → inbox).
- **Capture tokens** (later): `~week`, `~month`, `~someday`, `@2026-06-30` parsed
  in `store/capture.ts` alongside the existing completion token.

## Code touch-points

- `types.ts` — `Schedule`, `Horizon`, `schedule` field, `SCHEMA_VERSION = 3`.
- `store/persistence.ts` — `coerceSchedule`, forward-migrate `plannedFor`.
- `store/dates.ts` — `currentWeekKey`, `currentMonthKey`, `horizonIsStale`.
- `store/store.ts` — `setSchedule`, `demoteSchedule`; update `setPlannedFor*`
  callers; `postponeToBacklog` becomes "demote to a horizon / inbox."
- `selectors.ts` — `leftoverLeaves`, view predicates, a `groupByHorizon`.
- `App.tsx` / `OutlineView` — Later view, the `s` picker, badges.
- `keyboard/keymap.ts` — `schedule.open`, `schedule.demote`.

## Test plan

- Migration: legacy `plannedFor` (date and null) → correct `schedule`.
- Reckoning: a past **dated** task reckons; a "week"/"month"/"someday"/`null`
  task never reckons even when old.
- Demote chain: Today → week → month → someday → inbox.
- Grouping/order in the Later view; stale-horizon sorting.

## Open questions for review

1. **Inbox vs Someday** — keep both distinct (recommended), or collapse `null`
   into `someday`?
2. **Aging** — soft surfacing (A, recommended) or anchored promotion (B)?
3. **Inbox surface** — its own tab, or a group inside "Later"?
4. **Rename** — is "Backlog" → "Later" the right word? (Things uses "Anytime"
   + "Someday".)
