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
2. **Plan** — press `t` to commit a task to today. **Today** shows only what
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
| `j` / `k` · `↑` / `↓` | move cursor (`↑` at the top jumps to the capture bar; `↓` there drops into the list) |
| `⇧ ↑` / `⇧ ↓` | extend multi-selection |
| `⌘ ↑` / `⌘ ↓` | move task(s) up / down, including across project dividers |
| `↵` | edit the **title inline** · `→` opens the details panel (**content**) |
| while editing a title: `↑`/`↓` jump tasks, `↵` new, `tab`/`⇧tab` indent, `⌘↵` done, `esc` save |
| in the panel: `←`/`esc` back to the list (title is read-only here) |
| `space` or `⌘↵` | complete / uncomplete |
| `t` | plan / unplan for today |
| `a` / `n` / `o` | new task below |
| `/` | add a task (capture bar) |
| `m` then `↵`/`⌘↵` | move mode (re-parent) |
| `⌫` | move to trash |
| `1` / `2` / `3` / `4` | Today / Backlog / All / Trash |
| `⌘k` | command palette · `⌘z` undo · `⌘⇧z` redo |
| `⌘y` | history — everything you just did (`↵` rewinds to a point) |
| `?` | keyboard help |

Task **titles** and **notes** render inline **markdown** (`` `code` ``, `**bold**`,
`*italic*`, `~~strike~~`, `[links](url)`). The detail panel shows a read-only,
rendered title and a created timestamp (in your local timezone).

In **the Reckoning** and at completion you can attach an optional **reason**;
these are recorded in an event log (and shown in a task's History panel) so the
data can later be analysed.

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

Press **`b`** on a task that's blocked, and name who you're waiting on. It stays
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
days. Past a fortnight it turns red. `b` again unblocks it; finishing or
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

**`⇧q`** opens the day. Everything asking for it in one place — work you put on
*this week* but never gave a day, and the recurrences firing today — with `t` to
take one on and `s` to name a different day.

The capacity meter sits **above** the list, not below it. That's the whole point:
a day nobody chose is the day that over-commits, because one more yes costs
nothing when you can't see the total. Work you already dated isn't re-offered —
re-asking a decision you've made is how a ritual becomes a chore.

## Shutdown — decide tonight, not tomorrow morning

Press **`q`** when you stop working. Shutdown walks today's still-open
commitments one at a time, with the Reckoning's verbs pointed at tomorrow:
`e` done · `t` carry to tomorrow · `b` break it into something you'd actually do
· `s` postpone to a named day · `w` won't do · `d` drop. `⇧t` carries everything
left in one move.

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
  "nothing committed yet" — the one empty day worth interrupting for) and an
  evening "N left, close the day?", silent at zero. Each fires only *during* its
  hour, so a laptop opened at 3pm doesn't get a stale good-morning;
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
  CDN (fonts are bundled). Optional cloud sync (Firebase) mirrors the store to a
  read-mostly **web companion** — see [FIREBASE_SETUP.md](./FIREBASE_SETUP.md).
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
