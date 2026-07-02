# Next Features

- [ ] Sub-projects - arbitrarily nested _(model agreed: "a project is just a special task" — own refactor pass)_
- [x] Scheduling: sometime this week, next week, etc., exact scheduling _(done: `s` opens a scheduler — Today / this·next week / this·next month / Someday / Inbox / a specific date. The "Later" tab toggles **By date** (buckets with concrete labels "Week 25" / "June 2026", a time-elapsed donut, and % done) ↔ **By project**. Horizons are anchored, never reckon.)_
- [x] Current ("right now") task _(done: `c` toggles the focused task as **current** — a prominent accent card sits just below the view header (Today/Backlog/All), showing the **full title** (wraps, never truncated); the task stays put in the list and its row gets a "Now" marker + accent highlight. Persisted (`currentTaskId`, schema v6); retires itself when the task is completed or deleted. `c` was reclaimed from collapse/expand, which stays on ←/→.)_
- [ ] Calendar pairing -> reflect exact-date events into my calendar, connect by ID so that changes in the calendar flow back to the app if needed, 2-way sync: possibly increrdibly hard? _(out of scope for now)_

## Fixes

- [x] When you're editing, pressing enters creates a tab, it should instead just stop the edit mode _(done: Enter now just commits + leaves edit mode; it no longer spawns a new task below)_
- [x] Untitled tasks, whenever you move should be removed _(done: an empty, childless task is discarded when you move off it while editing — Esc / arrow to another row. Open: also discard on plain j/k navigation in normal mode?)_
- [x] Deleting tasks should probably require some kind of confirmation modal _(done: a keyboard-first confirm dialog — `↵` confirm / `esc` cancel — now guards the high-loss deletes only: Backspace on a task **with subtasks** (a leaf still trashes instantly, reversibly + undo), and **permanent purge / empty trash** in the Trash view. The threshold is deliberate, not final — see Q2 under Open questions.)_
- [x] Recurrent tasks _(done: a separate **Recurring** section (key `5`) holds recurrence definitions grouped by pattern ("Every day", "Every 2 weeks on Sat"…). Each is a task **template** (children supported) + an RRULE-ish repeat set via the `r` picker (presets + custom: every N days/weeks/… , weekday pills, ends never/on/after). Templates live in their own array — **never** in `tasks`, so they can't reckon or be counted. On days a rule fires they surface in Today under **"Recurring today"**; `t` **accepts** (materializes the whole subtree as a real, dated-for-today commitment that reckons like any task). On-completion is done as **suppression**: a recurrence won't re-suggest while an accepted instance is still open (or was already accepted today) — so pushing an unfinished instance forward never spawns duplicates. Deferred: "1st Sat"-style by-weekday-position monthly rules; a future-day preview; project assignment for templates.)_
- [~] "Everything for today is done." -> this appeared at a point where there were still some tasks that were not yet done, okay, I had a task that didn't have the "planned for today" flag, but it was a bit crazy because I can still see it in my list. Maybe we need a more visual way to see when a task is not meant for today? E.g. the main task is not main for today, but some of its subtasks _are_, how to deal with this case? slightly de-highlight? _(done: not-today scaffold tasks are now de-highlighted in Today. Open: should the "everything done" banner suppress while such tasks are visible?)_
- [x] Selecting a task should also move scrolling to that task! The scrollbar appeared when I had that "everything is done for today" and it was actually quite ugly to see! _(done: focused task scrolls into view; block:"nearest")_
- [ ] At the beginning of each day, I should probably be able to choose from the tasks for "this week" and choose if I want to do them today or not _(part of the commit/shutdown ritual below — needs design)_
- [x] Tasks should move automatically from "next week" into "this week" when the week changes, same for month, etc. _(done at the data layer: horizons are anchored to real ISO weeks/months, so the bucket is recomputed from the current date — a "next week" task surfaces in "this week" automatically. Becomes visible once the bucketed Later view ships.)_
- [ ] Maybe we should have some "commit" and "shutdown" actions: one to prepare the tasks for the day, and choose what I want to work on for the day, and the shutdown to move tasks for the next day, but leave smaller subtasks if there were things I wasn't able to do today. The big question here is: how to re-structure and break down tasks properly? -- Because I was thinking this flow could be something like a deck of cards that you analyze one by one "Task X", okay, couldn't do today, let's break down into "Task A" / "Task B" / "Task C", and tomorrow let's commit to doing A and B, but then, how to make this properly in the UX? Sounds like an interesting usability problem.

## Open questions (need your input before I build these)

Everything above that I could safely do alone is done. These remaining items
each hinge on a decision only you can make. Numbered so we can refer to them.

1. **Sub-projects (arbitrarily nested).** The agreed slogan is "a project is just
   a special task," but the codebase keeps `Project` and `Task` as *separate*
   types (projects are a flat index; tasks carry a `projectId`). Truly nesting
   projects means one of:
   - **(a) Unify** — collapse `Project` into `Task` (a task with an
     `isProject`/divider flag can contain tasks _and_ sub-projects). Cleanest
     long-term, but it's a from-scratch data-model rewrite + migration and
     touches nearly every selector/view. ~A day of careful work.
   - **(b) Parent pointer** — keep `Project` but add `parentProjectId`, so
     projects form a tree while tasks stay as-is. Much smaller, ships fast, but
     projects and tasks remain two different things (the slogan stays aspirational).
   Which model do you want? (My lean: **(b)** first to get nesting now, **(a)**
   only if the two-type split actually bites us.)

2. **Delete-confirmation threshold.** I shipped: confirm on Backspace **only when
   the task has subtasks**, plus confirm on **permanent purge / empty trash**.
   Leaves still trash instantly (reversible + undo). Is that the right line, or do
   you want: confirm on **every** Backspace, **only** on purge (never on the
   reversible trash), or a different rule?

3. **Recurring tasks.** ✅ **Resolved & shipped.** (a) Calendar-style rules
   (every N days/weeks/months/years, weekday pills, ends never/on/after). (b)
   **On-completion**, implemented as *suggestion suppression* — a recurrence
   surfaces in Today as a passive suggestion and only becomes a real task when
   **accepted**; the next occurrence is withheld while an accepted instance is
   still open, which is what prevents the duplicate pile-up. (c) An **un-accepted**
   recurrence never touches the Reckoning (definitions live outside `tasks`); only
   an accepted instance can reckon, giving visibility without guilt. (d) Editing a
   definition in the Recurring view is edit-all-future; an accepted instance in
   Today is an independent, edit-one task. See NEXT_FEATURES top item for the
   as-built summary and the small deferred list.

4. **"Commit" / "shutdown" rituals (incl. the morning "pull from this-week").**
   Items above about (i) choosing each morning which this-week tasks to do today
   and (ii) the deck-of-cards shutdown breakdown are the *same* ritual pair. Open:
   is **shutdown** a new evening ritual, or just the existing Reckoning re-skinned
   as a one-card-at-a-time deck? Is **commit** a morning surface that lists
   `this week` horizon tasks with a one-key "→ today"? I can prototype the deck UX
   once you confirm the two rituals' scope and whether they replace or sit beside
   the Reckoning.

5. **"Everything for today is done" banner.** It fires when all today *leaves* are
   done — but an incomplete **container/scaffold** parent (whose today-children are
   done; its other work is for later) can still be on screen, which is what felt
   "crazy." It's now de-highlighted. Do you want to **also suppress the banner**
   while such a parent is visible, or is de-highlight enough? (My lean: keep the
   banner — it's literally true for today's commitments — but reword it to
   "Everything you planned for today is done." Say the word and I'll do the copy.)

6. **Discard empty task on plain `j`/`k` navigation.** Today an untitled, childless
   task is discarded when you leave it *while editing* (Esc / arrow). Should that
   also happen when you move off it with `j`/`k` in **normal** mode? (My lean:
   **no** — rows silently vanishing as you scroll past is jarring; the editing-exit
   discard already covers the real case.)

7. **Calendar two-way sync.** Currently marked out of scope. Confirm it stays
   parked, or tell me if you want me to spike a one-way (app → calendar) export
   for exact-date tasks as a first step.
