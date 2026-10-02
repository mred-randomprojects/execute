# Habits

A habit is not a task. You finish a task once. A habit never finishes: you
keep it, one day at a time, and only the pattern counts. That is why habits
have their own array (`AppState.habits`), their own view (key `6`) and their
own keys. None of it reaches `tasks`, so a habit can't trip the Reckoning,
change the day's counts or turn up as a leftover. A missed habit tells you
something. It is not a debt the app makes you settle.

This doc covers what the first version does, the lessons from other habit
trackers behind each choice, and the ideas still to build, roughly in order.

## What shipped (v1, schema v19)

- **Habit** = name · optional **cue** ("after my morning coffee") ·
  **target in days a week** (1–7; 7 = daily) · a map of marked days
  (`done` / `skip`) · `archivedAt`.
- **Habits view** (`6`). One row per habit: a check box for today, a
  two-week strip (one week on a narrow window), this week's `done/target`,
  **strength** and **streak**. Under the name: the cue, the cadence and a
  single line of coaching about today.
- **Keys:** `↑/↓` move · `←/→` move the day cursor back through the last two
  weeks · `space` (or `⌘↵`) checks in on that day · `↵` renames, then `tab`
  moves on to the cue · `n` adds a habit · `⌫` archives (on an archived habit
  it deletes, after a confirm). `⌘k` has the rest: rest day, target (every
  day … once a week), cue, archive or restore, delete. Clicking a day cycles
  it: not done → done → rest day → not done.
- **Typing the cadence:** "Run 3x", "Lift 2x/wk", "Stretch daily" set the
  target when you name the habit.
- The sidebar badge counts habits still worth doing today: daily habits not
  yet marked, and weekly ones whose target isn't met yet.
- Every change is undoable and goes into the history (`⌘y`). Habits sync as
  `users/{uid}/habits/{id}`, newest `updatedAt` wins per habit, and deletes
  leave tombstones like everything else.
- Engine: `src/store/habits.ts`, pure and tested. It is the place to change
  how anything is scored.

## Lessons from other habit trackers, and what each one changed here

**1. All-or-nothing streaks backfire.** A counter that drops to zero after one
miss invites the "what-the-hell effect": the streak is gone, so why bother
today. Lally et al. (2010), the study behind "66 days to form a habit", found
that missing a single day did not measurably slow habit formation. Atomic
Habits sums it up as *never miss twice*.
→ **Strength** is an exponential moving average, after Loop Habit Tracker: a
miss costs a few points, a month of misses costs most of them. The **streak**
for a daily habit survives one missed day and only breaks on the second in a
row. The row says so: "Missed yesterday — don't miss twice".

**2. Daily targets break on normal life.** "Every day" fails on the first
trip. Loop, Streaks and Strides all support "N times per period".
→ The target is **days per week**, judged per ISO week. A weekly habit's
streak counts **weeks that met the target**. The week's target shrinks for
the days before a habit existed: a 5×/week habit created on a Saturday asks
for 2.

**3. Rest needs to be legitimate.** Duolingo's streak freeze and the "skip"
state in Way of Life point the same way: an approved way to miss keeps people
tracking, and with no such way they tend to quit.
→ A **rest day** (`skip`) leaves strength where it is, never breaks a streak,
and shrinks that week's target in proportion.

**4. Logging friction kills trackers before missed habits do.** A common way a
tracker dies: logging becomes a chore, or a few days go unlogged, while the
habit itself is still going.
→ One key checks in. The day cursor makes **backfill** cheap: forgetting to
log isn't the same as not doing it, and a tracker that can't tell the two
apart ends up recording fiction. *Next:* check-ins from the phone, and from the
shutdown ritual (see the roadmap).

**5. Starting with too many habits kills them all.** Streaks caps the list on
purpose. Fabulous starts everyone on one habit (drink water) and adds more
over weeks.
→ When there are no habits, the view says "Start with one" and "small enough
to do on your worst day — two minutes is plenty" (the two-minute rule). With
more than five active habits, the header warns, but nothing blocks you.

**6. A cue beats motivation.** Implementation intentions ("when X, I will Y")
have one of the larger effects in behaviour-change research (Gollwitzer &
Sheeran, 2006). Habit stacking ("after I pour my coffee…") is the same idea.
→ Every habit has a **cue** field, shown under the name and reached with
`tab` right after naming it.

**7. Punishment and points wear off.** Habitica's lost HP and Fabulous's
nagging help some people, but for many the novelty fades and only the guilt
is left. Guilt piles up the same way in Todoist when a recurring task sits
overdue for weeks.
→ No points, no HP, no shaming notifications. The coaching line only talks
about what you can still do ("2 more this week", "every one still counts")
and never scolds about the past. Habits never reckon.

**8. Pausing must not erase history.** Users delete habits to get rid of
guilt, and the record goes with them.
→ **Archive** keeps the whole history and hides the habit from the active
list and the badge. Delete takes two steps and can still be undone with ⌘z.

## Known limits of v1

- **Merge is per habit, not per day.** If two devices mark the *same* habit
  inside one sync window, the older mark is lost. That's harmless while only
  the desktop marks habits. Before the phone gets check-ins, switch to
  per-day stamps (`checks: { [date]: { mark, at } }`, newest per day) and
  record a cleared day as a stamped "none" so undo still wins.
- **Desktop only.** The web viewer doesn't load the `habits` collection yet
  (it leaves the collection alone and never deletes from it).
- An archived habit that comes back counts the archived days as misses.
  The fix is real pause ranges (roadmap).
- Backfill reaches two weeks back from the keyboard. Older days need ⌘k or
  editing the data.
- Order is creation order. There is no reordering yet.

## Roadmap: ideas, roughly in order

**Next, cheap and high-leverage**
1. **Check in from the shutdown ritual.** Add one step tonight: "Did you
   meditate / run / read today?" The app already has a fixed evening moment,
   and logging at one is the best known cure for forgetting to log.
2. **Habits on Today.** A compact strip under the period tabs (✓ ✓ ○) with
   the check-in a key away, so habits sit next to the day's commitments
   without being tasks.
3. **⌘k check-in from anywhere.** "check meditate" works from any view, so
   there's no need to visit the view.
4. **Phone check-ins** (web viewer), after the per-day merge (see Known
   limits). This is the biggest friction win: the moment you do a habit is
   rarely the moment you're at the desk.
5. **The weekly review** (`ReviewPanel`) gets a habits section: strength
   trend per habit, the week's misses, and one honest question about the
   habit that is slipping.

**Then: shaping habits**
6. **The two-minute version.** Each habit gets a minimum version ("put on
   running shoes") that also counts on a bad day. Keep the floor low and let
   the ceiling rise.
7. **Graduate or level up.** After N weeks with strength above 90%, suggest
   either archiving it as automatic or raising the bar (two minutes → full
   version, 3× → 4×).
8. **Routines (habit stacks).** Order habits into a morning/evening chain and
   check off the chain in sequence, so each habit is the cue for the next.
9. **Per-habit reminder at the cue's time,** through the existing Presence
   nudges. Opt in per habit and keep it to one nudge a day at most. The
   two-nudges-a-day rule in `Presence` still applies.
10. **Specific weekdays** (Mon/Wed/Fri) as an alternative to N×/week, for
    habits tied to a schedule (gym classes).

**Later: other kinds of habit**
11. **Measurable habits:** a number with a daily target (pages, minutes,
    glasses), with partial credit counting toward strength.
12. **Quit / avoid habits:** "days since", logging slips instead of
    successes, the same forgiving strength, and no reset-to-zero shaming.
13. **Pause ranges** (vacation, illness) that strength skips entirely, a
    step up from marking single rest days.
14. **Year heatmap per habit** and a detail panel (`→`) with history, notes
    and stats: best run, completion rate per weekday ("you always miss
    Thursdays").
15. **A note on a check-in or a miss,** the same optional reason the
    Reckoning collects, to feed the AI analysis in `LogEntry` later.
16. **Identity line per habit** ("I'm someone who moves every day"), shown
    on the view. This is identity-based habits from Atomic Habits.
17. **Reorder and group habits** (`⌥↑/↓`, by time of day).

**Anti-goals:** points, levels, HP, leaderboards, social pressure,
streak-shaming notifications, and anything that makes a habit reckon.
