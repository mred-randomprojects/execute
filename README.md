# execute

A keyboard-first, **inbox-zero** todo app. Local-first desktop (Electron).

The idea: a task you commit to **today** should be finished today. If it isn't,
it stays in front of you, marked with how late it is, until you finish it,
move it on purpose, or **break it into a smaller piece you can actually
complete today**. Moving it is allowed and **counted**, so work can't drift
forward silently. The smallest version of a task is the one that gets done.

## The loop

1. **Capture** — every line is a checkbox. Type a task and press `Enter` for the
   next one, `Tab` to make it a subtask. Pasting `[] thing`, `- thing`, or
   `[x] done` just works.
2. **Plan** — `⌘k` → "today" commits a task to today. **Today** shows only what
   you've committed to.
3. **Organize** — create colored project dividers and move tasks through them;
   each task keeps its project when it later appears in Today or Backlog.
4. **Finish** — clear Today to reach **inbox zero**.
5. **Overdue stays in sight** — a task left on an earlier day stays in Today
   with a red "2d ago" chip, and a banner over Today counts them. Nothing
   blocks you: finish it, move it, or decline it right there in the list, or
   run the **task review** (below) to go through everything in one pass.

   Deferring is allowed — that's the whole point of a mindful postpone — but it
   is **counted**, wherever you do it. Moving an overdue task back to today
   bumps `carried N×`; moving it anywhere else bumps `postponed N×`; both
   badges follow the task around the app. In the review, past a threshold the
   cheap answer stops being free: the third keep offers to break the task down
   instead, and the fourth postpone asks whether it's ever going to happen
   (with "won't do" as the default answer). Neither is a block — the escape is
   always one deliberate key away.

## Task review

`⌘k` → **Review tasks…** (or the overdue banner over Today) opens one list of
every task waiting on a decision: what's **overdue**, what's still open
**today**, and what **this week** holds without a day. Each row shows where it
lives (project › parent) and takes the same keys:

`e` done · `t` today · `→` tomorrow · `b` break it down · `s` postpone to a
named day · `w` won't do · `d` drop · `l` later (set aside for this pass,
nothing counted) · `/` add an optional *why* to the next choice.

On a task that came due (overdue or today's), a move is a deferral and is
counted on the task. On the week's undated work, `t` is a fresh commitment and
`s` plain rescheduling. It never opens on its own and nothing is gated on it:
it's the fast way through, and every verb in it also works from the list or
`⌘k` (break down is `⌘k` → "Break it down…" on any task). It replaced the
morning gate (the Reckoning), Shutdown and Plan, which asked the same question
at fixed hours and went unused.

## Keyboard## Keyboard

Press **`?`** anywhere for the full, always-current list (it's generated from the
keymap). Highlights:

| Key | Action |
|-----|--------|
| `↑` / `↓` | move cursor (`↑` at the top jumps to the capture bar; `↓` there drops into the list) |
| `⇧ ↑` / `⇧ ↓` | extend multi-selection |
| `⌥ ↑` / `⌥ ↓` | move task(s) up / down, including across project dividers |
| `⌘ ↑` / `⌘ ↓` | jump to first / last |
| `↵` | edit the **title inline** (caret at the end) · `→` opens the details panel with the caret in the **content** |
| while editing a title: `↑`/`↓` jump tasks, `↵` new, `tab`/`⇧tab` indent, `⌘↵` done, `esc` save |
| in the panel: `←`/`esc` back to the list (title is read-only here) |
| `⌘ ↵` | complete / uncomplete |
| `n` | new task below · `/` capture bar |
| `p` | peek — unwrap title + notes in place |
| `s` | **start working** on it — in progress, timer on · again: stop · when paused: resume |
| `tab` / `⇧ tab` | indent / outdent |
| `⌫` | won't do · press again to trash |
| `1` – `7` | Today / Backlog / All / Projects / Recurring / Habits & KPIs / Trash · `[` `]` walk the period tabs |
| in Trash: `↑`/`↓` move, `↵` restore, `⌫` delete forever (it asks first) |
| `⌘k` | **command palette — everything else lives here** |
| `⌘f` | filter this view (esc clears) · `⌘⇧f` find any task |
| `⌘z` undo · `⌘⇧z` redo · `⌘y` history · `?` help |

**Bare letters are deliberately scarce.** A single unmodified letter fires while
you're *browsing*, so it lands on a real task with no warning — which is how `m`
used to drop you into a move mode with no visible way out, and how `t`, `w`, `b`
and `c` each rewrote the focused task on one keypress. So the outline keeps bare
letters only for things that change nothing you'd have to undo (`n`, `p`) —
plus `s`, the timer, which has to cost one keystroke or it never gets started,
and shows the moment it lands (a banner, a ▶ on the row, a clock in the sidebar)
— and everything else that touches a task — schedule, won't-do, blocked, estimate,
project, repeat, break down, review — goes through `⌘k`, which is searchable and
impossible to hit by accident.

**Saying when, in words.** The schedule picker (and `⌘k` itself — type
"in two days", "next monday", "weekend", or lead with a verb: "reschedule sat",
"postpone end of month", "defer 2 weeks") reads plain language,
not mnemonics: a weekday by any prefix (`sat`, `satu`, `saturday`, `next fri`),
the fuzzy rungs (`today`, `next week`, `someday`), edges (`eow`, `end of month`,
`start of next week`, `midweek`, `end of year`), offsets (`in 3 days`,
`2 weeks`, `a fortnight`, `in 2 business days`), and dates (`aug 20`,
`late august`, `12/25`, `2027-03-15`, `the 20th`). When a phrase honestly means
more than one day — `weekend` is Saturday *or* Sunday, `4/5` is April 5 or May 4
— it offers each reading with the day it lands on, instead of guessing. The verb
tolerates a fat finger, so "reschedu sat" works. In `⌘k`, a verb puts the days
at the top of the list; a bare day ("in two days") sits below the commands whose
letters also match, so `mon` still runs a month command on `↵`.

The exception is the **task review**, which owns the whole screen while it's
open and prints its letters on the chips you're looking at — `e` done · `t`
today · `b` break down · `s` postpone · `d` drop · `w` won't do — so a stray
press can't reach you mid-browse. Because those letters are unbound in the
outline, each one has exactly one meaning in the whole app. A test enforces both
halves of this rule.

Task **titles** and **notes** render inline **markdown** (`` `code` ``, `**bold**`,
`*italic*`, `~~strike~~`, `[links](url)`). The detail panel shows a read-only,
rendered title and a created timestamp (in your local timezone).

In **the task review** and at completion you can attach an optional **reason**;
these are recorded in an event log (and shown in a task's History panel) so the
data can later be analysed.

## Habits

Things you keep rather than finish live in their own view (`6`), never in the
task tree, so a habit can't go overdue or change the day's counts. Each habit has a
weekly target ("Run 3x" when you name it sets 3× a week), an optional cue
("after my morning coffee"), a two-week strip, a forgiving **strength** score
and a streak that survives a single miss (*never miss twice*). `space` checks
in, `←`/`→` pick an earlier day to backfill, `⌥↑`/`⌥↓` reorder, and `⌘k` marks a rest day, which
costs nothing. `c` adds a note to the picked day ("Steamed broccoli!"), and the
focused row lists them all. The sidebar badge and the menu bar count what's
still unlogged today; chips under Today's tabs, "Check in: …" and "Log habits:
today / yesterday" in `⌘k` work from anywhere, and the phone has the same
chips, plus a yes/no for anything left unlogged yesterday. The design, the lessons behind it
and what comes next: [`docs/habits.md`](docs/habits.md).

**KPIs** sit in the same view, under the habits: a number to log instead of a
yes/no — a symptom count, a 0–10 rating, a monthly questionnaire score. `k`
adds one, and the range and cadence go after the name: "Dizzy spells 0-3+",
"Worst one 0-10", "DHI 0-100 monthly". `space` logs the picked day's number.
`⌘k` → "Log habits" asks for them too: type the number and press `↵`. A KPI has no
strength or streak, only its values, and the row shows the 7-day average beside
the 28-day one (the latest value beside the previous one for a weekly or monthly
KPI). The phone doesn't log KPIs yet.

## Your week, read back to you

Click the heatmap (or `⌘k` → "weekly look-back"). Everything in there was already being
recorded and shown nowhere: days closed, finished, declined, deferred — and the
**reasons**.

Reasons are the most interesting data the app holds and were the least looked at.
One at a time they're a shrug; in aggregate they're a diagnosis. *"no time ×9"*
is a capacity problem — calibrate the budget. *"waiting on Ana ×4"* is a
dependency problem — that's what `b` is for. Opposite fixes, and you can't tell
which you have from inside a single bad day. Spellings are folded, so *"No time"*
and *"no time"* stop hiding the pattern by splitting it.

It also names the tasks you keep putting off (carried + postponed) and what
you've been blocked on longest.

## Waiting on someone else

`⌘k` → "blocked" on a task that's waiting, and name who you're waiting on. It stays
open and stays yours eventually — it just never goes overdue and steps out of
the day's tally while the ball is in someone else's court.

Before this existed, a task waiting on a reply had nowhere honest to go. It
couldn't be finished, so it failed the day. It couldn't be declined, because you
still want it. So it got postponed, again and again, until it was a zombie in the
backlog with a `postponed 6×` badge blaming you for someone else's silence.
Holding you to a deadline you don't control just teaches you to ignore deadlines.

The obvious failure mode is a task that sits blocked forever — which is the
zombie this replaces — so blocked work never disappears: overdue and undated ones
trail Today under **Waiting on others**, oldest first, and the badge counts the
days. Past a fortnight it turns red. Running it again unblocks it; finishing or
declining clears it.

## In progress — and how long it took

`s` on a task puts it **in progress** and starts its timer. One task at a time:
starting another stops the last. The task gets a banner at the top of the list
(its clock, its time against the estimate, a bar that turns red past it), a ▶
on its row, a clock in the sidebar on every view, and a `▶ 25m` in the menu
bar, so the timer is never out of sight. `s` again stops it; the time stays on
the task, and the details panel (`→`) lists every stretch and the total.

**Currently: …** — click the line under the banner's title (or `⌘k` →
"currently") and say where you are in it. Each one is kept with its time, so
the details panel reads back as a trail of where you were.

**Time nobody was there for doesn't count.** When the Mac sleeps or the screen
locks, or the app quits for more than five minutes, the running stretch ends
right there and the task stays in progress, **paused** — what you were on
survives the night, and `s` (or the banner's ▶) resumes it. Completing, declining,
blocking or trashing the task takes it out of progress for good. Closing the
window doesn't stop anything: the app keeps running in the menu bar.

It syncs, so the phone shows which task is in progress. The timer itself runs
on the Mac.

## Coming back after a while

After a week away, twenty overdue commitments are waiting at the moment your
motivation is lowest. That's where people quit, and a strict app you've stopped
opening enforces nothing at all.

So past ten overdue tasks (or three days unopened) the task review offers a
door: **Move all to the Inbox**. It's still a decision, still
confirmed, still recorded — and every task keeps its `postponed N×`. That's the
difference between an amnesty and a leak.

## Capacity you didn't have to guess

Over-commitment is the *cause*; an overdue pile is only the symptom — so the app
says something at the moment you commit, not the next morning. Push Today past
your daily budget and a strip appears: **"16 of 12 blocks committed — something
here isn't going to happen."**

The budget itself stops being a number you typed. Day records track the
estimated minutes you actually finish, and `⌘k` → "calibrate" offers the median
of your last two weeks. It stays silent until there are at least three usable
days, and silent when your setting is already about right — an app that always
has a correction for you gets tuned out.

## Closing the day

Inbox zero is the goal; **closing** is the habit. A day is closed when every
commitment it carried has an outcome — finished, consciously declined, or moved
on purpose — and nothing is left overdue. Deliberately *not* "you did everything":
that's unreachable on a bad day, and a target you miss by having a bad day is one
you stop looking at.

The sidebar keeps a run counter and ten weeks of squares. Green is a closed day,
shaded by how much actually got **done** — so a day closed by declining
everything stays visibly paler than one you cleared. Red is a day left
unresolved. Grey asked nothing of you.

Two rules keep the number honest rather than merely flattering:

- **An empty day earns nothing.** If days with no commitments counted, the safest
  way to grow a run would be to stop committing to anything — the exact opposite
  of the point.
- **Absence is neutral, and one missed day doesn't end a run** (two in a row do).
  The grace is shown, never hidden: "11 days running · 1 missed". Coming back
  after a week away to a broken streak is a reason not to come back.

## Presence (desktop)

The loop above only runs if the app gets opened, so the app has a body while its
window doesn't:

- a **menu-bar count** of what's left today (`✓` at zero) — passive, pull not push —
  led by the **work clock** (`▶ 25m`) while a task is in progress;
- a **dock badge** with the same number;
- **`⌘⇧space`** from anywhere: shows the window with the cursor already in the
  capture bar, so a stray thought never has to wait;
- the menu-bar menu also says how many habits are still unlogged today;
- optional **launch at login**, off until you ask for it (`⌘k` → "launch at login").

No notifications: nothing here interrupts. All of it toggles from the command palette; closing the window on macOS leaves
the count and the shortcut alive, which is the point.

## Develop

```bash
pnpm install
pnpm dev      # renderer in the browser at http://localhost:5173 (fast iteration)
pnpm start    # the real Electron desktop app (Vite + Electron)
pnpm test     # vitest (tree ops, keyboard engine, capture, full app flows)
pnpm typecheck
pnpm lint     # eslint (react-hooks rules)
pnpm check    # typecheck + lint + tests: what CI and install.sh run first
```

In `pnpm dev`/`pnpm start` a **Dev · time travel** panel appears in the sidebar so
you can jump days and see overdue work without waiting. It's hidden in
packaged builds.

## Package

```bash
pnpm package  # → out/Execute-darwin-*/Execute.app
pnpm make     # → out/make/**/Execute.dmg  (+ .zip)
```

## How it's built

- **Renderer**: React + TypeScript (strict) + Vite + Tailwind. Theme tokens
  (Slate / Ivory / Carbon / Bordeaux) are CSS variables; switching `data-theme`
  re-themes instantly.
- **Shell**: a thin Electron main process — dev loads the Vite server, prod loads
  the built bundle. A `contextBridge` preload is the only path to disk.
- **Persistence**: one local JSON document in the OS app-data dir, written
  atomically (temp file + rename), debounced, schema-versioned. If it can't be
  loaded (a read error, or a file that isn't valid JSON) the app shows an error
  screen and writes nothing, so the file stays as it was. The first save of
  each day copies the file to `backups/execute-store.YYYY-MM-DD.json` beside it
  (the newest 30 are kept; nothing else in `backups/` is touched). `⌘k` →
  **Restore a backup…** puts one back: every task, project, recurring task and
  habit it holds goes back to how it was then, deleted ones included, on every
  device (the cloud follows instead of deleting them again); what's been added
  since stays. It keeps a copy of what you had in `backups/` first, and `⌘z`
  undoes it. Don't copy a backup over the store file by hand: the first sync
  would delete again whatever the cloud has a deletion record for. A save that
  fails shows a banner and is retried until one lands, and closing the window
  writes a save still waiting on its debounce. Local-first; no
  CDN (fonts are bundled). Optional two-way cloud sync (Firebase, one small
  document per task) keeps it in step with a light-edit **web companion** — see
  [FIREBASE_SETUP.md](./FIREBASE_SETUP.md) and the Sync section of
  [docs/architecture.md](./docs/architecture.md).
- **Keyboard**: a declarative, Zed-inspired engine — bindings are data, contexts
  decide when they fire, actions decide what they do. The `?` overlay is
  generated from the keymap, so it can never drift.
- **One core, two shells**: the desktop app and the web companion share a single
  platform-agnostic core; only persistence and a few capability flags differ.
  Read [docs/architecture.md](./docs/architecture.md) before adding features that
  touch both — it's the doctrine that keeps them from forking.

### Layout

```
electron/        main.cjs (window + persistence IPC) · preload.cjs (bridge) · storeFile.cjs (reading the store) · backups.cjs (daily copies, and listing/reading them for a restore) · awake.cjs (when the Mac slept or the app was quit, for the work timer)
src/
  types.ts                      core domain types
  store/  tasks.ts (pure tree ops) · dates.ts · capture.ts · persistence.ts · store.ts
  keyboard/  types.ts (engine) · useKeyboard.ts · keymap.ts
  selectors.ts                  view filters + Today/leftover computations
  ui/editor.tsx                 interaction context shared by rows
  components/  TaskRow · CaptureBar · Sidebar · HelpOverlay · CommandPalette · …
  views/  OutlineView · TaskReviewView · HabitsView · …
```
