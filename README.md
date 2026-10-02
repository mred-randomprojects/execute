# execute

A keyboard-first, **inbox-zero** todo app. Local-first desktop (Electron).

The idea: a task you commit to **today** should be finished today. If it isn't,
the app makes you reckon with it the next day — finish it, or **break it into a
smaller piece you can actually complete today**. You can't silently carry work
forward. The smallest version of a task is the one that gets done.

## The loop

1. **Capture** — every line is a checkbox. Type a task and press `Enter` for the
   next one, `Tab` to make it a subtask. Pasting `[] thing`, `- thing`, or
   `[x] done` just works.
2. **Plan** — `⌘k` → "today" commits a task to today. **Today** shows only what
   you've committed to.
3. **Organize** — create colored project dividers and move tasks through them;
   each task keeps its project when it later appears in Today or Backlog.
4. **Finish** — clear Today to reach **inbox zero**.
5. **The Reckoning** — open the app on a new day with unfinished commitments and
   a gate blocks Today until each leftover is resolved:
   - **`e` done** — it was actually finished
   - **`t` keep for today** — re-commit to it unchanged
   - **`b` break down** — split it; the small step you'll finish today goes to Today
   - **`s` postpone** — a deliberate "not today" that has to **name the day**
   - **`d` drop** — delete it

   Deferring is allowed — that's the whole point of a mindful postpone — but it
   is **counted**. Keeping bumps `carried N×`; postponing bumps `postponed N×`,
   and both badges follow the task around the app, not just inside the gate. Past
   a threshold the gate stops taking the cheap answer for free: the third keep
   offers to break the task down instead, and the fourth postpone asks whether
   it's ever going to happen (with "won't do" as the default answer). Neither is
   a block — the escape is always one deliberate key away, because a gate you
   can't pass just moves the dodge somewhere the app can't see.

## Keyboard

Press **`?`** anywhere for the full, always-current list (it's generated from the
keymap). Highlights:

| Key | Action |
|-----|--------|
| `↑` / `↓` | move cursor (`↑` at the top jumps to the capture bar; `↓` there drops into the list) |
| `⇧ ↑` / `⇧ ↓` | extend multi-selection |
| `⌥ ↑` / `⌥ ↓` | move task(s) up / down, including across project dividers |
| `⌘ ↑` / `⌘ ↓` | jump to first / last |
| `↵` | edit the **title inline** · `→` opens the details panel (**content**) |
| while editing a title: `↑`/`↓` jump tasks, `↵` new, `tab`/`⇧tab` indent, `⌘↵` done, `esc` save |
| in the panel: `←`/`esc` back to the list (title is read-only here) |
| `⌘ ↵` | complete / uncomplete |
| `n` | new task below · `/` capture bar |
| `p` | peek — unwrap title + notes in place |
| `tab` / `⇧ tab` | indent / outdent |
| `⌫` | won't do · press again to trash |
| `1` – `7` | Today / Backlog / All / Projects / Recurring / Habits / Trash · `[` `]` walk the period tabs |
| `⌘k` | **command palette — everything else lives here** |
| `⌘z` undo · `⌘⇧z` redo · `⌘y` history · `⌘f` find · `?` help |

**Bare letters are deliberately scarce.** A single unmodified letter fires while
you're *browsing*, so it lands on a real task with no warning — which is how `m`
used to drop you into a move mode with no visible way out, and how `t`, `w`, `b`
and `c` each rewrote the focused task on one keypress. So the outline keeps bare
letters only for things that change nothing you'd have to undo (`n`, `p`),
and everything that touches a task — schedule, won't-do, blocked, estimate,
project, repeat, plan, shutdown — goes through `⌘k`, which is searchable and
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

The exception is the **rituals** (the Reckoning, Shutdown, Plan, the planning
board). Those are modal takeovers that own the whole screen and print their
letters on the chips you're looking at — `e` done · `t` keep/carry · `b` break
down · `s` postpone · `d` drop · `w` won't do — so a stray press can't reach you
mid-browse. Because those letters are now unbound in the outline, each one has
exactly one meaning in the whole app. A test enforces both halves of this rule.

Task **titles** and **notes** render inline **markdown** (`` `code` ``, `**bold**`,
`*italic*`, `~~strike~~`, `[links](url)`). The detail panel shows a read-only,
rendered title and a created timestamp (in your local timezone).

In **the Reckoning** and at completion you can attach an optional **reason**;
these are recorded in an event log (and shown in a task's History panel) so the
data can later be analysed.

## Habits

Things you keep rather than finish live in their own view (`6`), never in the
task tree, so a habit can't reckon or change the day's counts. Each habit has a
weekly target ("Run 3x" when you name it sets 3× a week), an optional cue
("after my morning coffee"), a two-week strip, a forgiving **strength** score
and a streak that survives a single miss (*never miss twice*). `space` checks
in, `←`/`→` pick an earlier day to backfill, and `⌘k` marks a rest day, which
costs nothing. You're asked at the moments the app already owns, so a habit
doesn't go unlogged: Shutdown ends with "did each one happen today?"
(`y` / `r` / `x`), Today shows a band for anything left unlogged yesterday,
and the evening nudge counts habits too. Chips under Today's tabs and
"Check in: …" in `⌘k` work from anywhere, and the phone has the same chips,
plus a yes/no for anything left unlogged yesterday. The design, the lessons behind it
and what comes next: [`docs/habits.md`](docs/habits.md).

## Your week, read back to you

Click the heatmap (or `⌘k` → "review"). Everything in there was already being
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
open and stays yours eventually — it just steps out of the Reckoning and out of
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

## Coming back after a while

The gate exists to stop work carrying forward *silently* — not to punish
absence. But after a week away that's exactly what it does: twenty overdue
commitments standing between you and starting, at the moment your motivation is
lowest. That's where people quit, and a strict app you've stopped opening
enforces nothing at all.

So past ten overdue tasks (or three days unopened) the Reckoning offers a door:
**Start clean** moves the pile to the Inbox. It's still a decision, still
confirmed, still recorded — and every task keeps its `postponed N×`. That's the
difference between an amnesty and a leak.

## Capacity you didn't have to guess

Over-commitment is the *cause*; the Reckoning is only the symptom — so the app
says something at the moment you commit, not the next morning. Push Today past
your daily budget and a strip appears: **"16 of 12 blocks committed — something
here isn't going to happen."**

The budget itself stops being a number you typed. Day records track the
estimated minutes you actually finish, and `⌘k` → "calibrate" offers the median
of your last two weeks. It stays silent until there are at least three usable
days, and silent when your setting is already about right — an app that always
has a correction for you gets tuned out.

## Plan — decide what today is

`⌘k` → "plan" opens the day. Everything asking for it in one place — work you put on
*this week* but never gave a day, and the recurrences firing today — with `t` to
take one on and `s` to name a different day.

The capacity meter sits **above** the list, not below it. That's the whole point:
a day nobody chose is the day that over-commits, because one more yes costs
nothing when you can't see the total. Work you already dated isn't re-offered —
re-asking a decision you've made is how a ritual becomes a chore.

## Shutdown — decide tonight, not tomorrow morning

`⌘k` → "close the day" when you stop working, or click the notification that
arrives at your **shutdown time**. Shutdown is one list: today's still-open
tasks, each shown with where it lives (project › parent), then today's habits.
`↑`/`↓` walk all of it. On a task, the Reckoning's verbs point at tomorrow:
`e` done · `t` carry to tomorrow · `b` break it into something you'd actually do
· `s` postpone to a named day · `w` won't do · `d` drop. On a habit: `y` did it ·
`r` rest day · `x` not today. `⇧t` carries every waiting task in one move, and
`/` adds an optional *why* to the next choice.

On anything, **`l` means later today**: not done yet, but still today's. It isn't
counted as a carry and isn't logged; the row just steps aside so the pass can
move on. A pass where everything left is "later" ends as **Done for now**, not
closed. That's the honest ending for a 14:15 shutdown, and the next run asks
again.

**Your shutdown time** is when you actually stop, set separately for weekdays
and weekends: type it into `⌘k` ("shutdown 14:15", "shutdown weekends 11am",
"shutdown every day 6pm"), and switch either kind of day off with "Shutdown on
weekends … turn off". At that time a notification arrives ("Shutdown · 14:15",
with what's left and any habits to log), and its **Start shutdown** button (or a
click on it) opens the ritual. Today's banner says so too. The time only
*prompts*: Shutdown runs whenever you like, from `⌘k`, the menu bar's
**Start shutdown…**, or the banner, at 14:15, at 19:00, or not at all.

The Reckoning hasn't moved or softened — it just has nothing to catch when you've
been here first. That's the trade: the gate stays, and you earn your way past it
the night before. It sits at the worst hour of the day (cold, before you've
started, wanting to *begin*) and it asks you at 9am why yesterday went the way it
did, when at 6pm you still remember. Shutdown is the same accounting at the hour
you can actually answer it.

Carrying to tomorrow still bumps `carried N×`. Facing a task at 6pm is better
behaviour and it's rewarded where rewards belong — the day closes, the run grows,
the morning gate never fires — but the counter measures the task, not your
virtue: it really is the third day running that you've promised to do it.

## Closing the day

Inbox zero is the goal; **closing** is the habit. A day is closed when every
commitment it carried has an outcome — finished, consciously declined, or faced
in the Reckoning and moved on purpose. Deliberately *not* "you did everything":
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

- a **menu-bar count** of what's left today (`✓` at zero) — passive, pull not push;
- a **dock badge** with the same number;
- **`⌘⇧space`** from anywhere: shows the window with the cursor already in the
  capture bar, so a stray thought never has to wait;
- **two notifications a day** and only two — a morning "here's your day" (or
  "nothing committed yet" — the one empty day worth interrupting for) and the
  **shutdown** at your shutdown time (above), which opens straight into the
  ritual. Neither goes stale: the morning one fires only during its hour, the
  shutdown one up to 90 minutes after its time, so a laptop opened at 3pm
  doesn't get a stale good-morning;
- **Start shutdown…** in the menu-bar menu, any time;
- optional **launch at login**, off until you ask for it (`⌘k` → "launch at login").

All of it toggles from the command palette; closing the window on macOS leaves
the count and the shortcut alive, which is the point.

## Develop

```bash
pnpm install
pnpm dev      # renderer in the browser at http://localhost:5173 (fast iteration)
pnpm start    # the real Electron desktop app (Vite + Electron)
pnpm test     # vitest (tree ops, keyboard engine, capture, full app flows)
pnpm typecheck
```

In `pnpm dev`/`pnpm start` a **Dev · time travel** panel appears in the sidebar so
you can jump days and exercise the Reckoning without waiting. It's hidden in
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
  atomically (temp file + rename), debounced, schema-versioned. Local-first; no
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
electron/        main.cjs (window + persistence IPC) · preload.cjs (bridge)
src/
  types.ts                      core domain types
  store/  tasks.ts (pure tree ops) · dates.ts · capture.ts · persistence.ts · store.ts
  keyboard/  types.ts (engine) · useKeyboard.ts · keymap.ts
  selectors.ts                  view filters + Today/leftover computations
  ui/editor.tsx                 interaction context shared by rows
  components/  TaskRow · CaptureBar · Sidebar · HelpOverlay · CommandPalette · …
  views/  OutlineView · ReckoningView
```
