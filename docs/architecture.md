# Architecture: one core, two shells

Execute runs as a local-first **Electron desktop app** and a **web companion**
(the read-mostly viewer at `mred-randomprojects.github.io/execute/`). They are
**not** separate codebases — they are two thin entry points over one shared
React core. Keep them that way.

## The doctrine (A → B)

Today the web build is a **companion** (view + light edits from the phone). The
longer-term option is **full parity** (edit anything, anywhere). We build the
companion now, *architected toward* parity, so getting there is a **convergence,
not a rewrite**. The rules that make that possible:

- **Shared, platform-agnostic core.** All domain logic — tree ops
  (`store/tasks.ts`), `selectors.ts`, `store/dates.ts`, capture parsing
  (`store/capture.ts`), recurrence, the sync **merge** (`sync/merge.ts`),
  markdown, `types.ts` — is pure and imports **neither** Electron
  (`window.execute`) **nor** Firebase. Both shells use it verbatim.
- **All platform IO behind one seam.** The only code that knows the platform is
  persistence/sync: `store/persistence.ts` (`loadRaw`/`saveRaw`: Electron file
  vs `localStorage`), the `ExecuteBridge` preload API, and the Firestore layer
  (`sync/v2/firestoreStore.ts` behind the `DocStore` port, wired by
  `sync/desktopSync.ts` and `viewer/ViewerRoot.tsx`). New platform differences
  go here — never into feature code.
- **No web-specific (or desktop-specific) _logic_.** Merge rules, scheduling
  rules, recurrence, capture parsing — exactly one implementation in the core,
  called from both shells. Only _UI and capabilities_ may differ.
- **Differ by capability flag, not by fork.** e.g. `canDrag`, `syncAvailable`.
  Desktop-only concerns (cloud sync, perhaps the Reckoning gate) and web/mobile
  concerns (touch affordances) are flags over the _same_ components.
- **Converge the UI when parity is wanted.** The end state is rendering the real
  `App` in the browser behind a Firestore persistence adapter and retiring the
  stripped `viewer/ReadOnlyApp`. The two-way merge already built is what makes a
  full web editor safe.

## Entry points — the only real divergence

- `src/main.tsx` branches on `VITE_VIEWER`: desktop/dev → `<App/>`; web →
  `<viewer/ViewerRoot/>`.
- `App` wires the full interactive editor (keyboard engine + every mutation).
  `viewer/ReadOnlyApp` wires a deliberately-stripped editor (view · complete ·
  capture) via a mostly-no-op `Editor` — an **MVP, not a fork**.
- Persistence: desktop = a local JSON file (via preload IPC), synced by the
  engine in `sync/v2/engine.ts`; web = no local copy — it shows the cloud
  through `sync/v2/viewer.ts` and writes its edits straight to it.

## Rule of thumb

Before adding code, ask: **is this domain logic, or platform IO/UI?**

- **Logic** → the shared core, with a unit test. (Ask: would the desktop want
  this too? If yes, it belongs in the core.)
- **IO / capability / touch UI** → the persistence-sync seam or a capability
  flag on a shared component.

If you're ever tempted to copy logic into the viewer, stop: put it in the core
and call it from both. That discipline is what keeps A→B a convergence.

## Sync: how it works

**Sync v2 (since 2026-09-25): one small Firestore document per item.** Under
`users/{uid}/`: `tasks/{id}` (own fields + `parentId`, `rank`, `movedAt`,
`trashedAt`), `projects/{id}`, `recurrences/{id}`, `tombstones/{id}`,
`log/{id}`, `days/{date}`, and `meta/state` · `meta/format` · `meta/heartbeat`.
The format is `sync/docs.ts` (`toDocs` / `fromDocs` / `diffDocs`, pure).

- **One merge.** Devices never merge documents one by one: they read the
  documents into a state (`fromDocs`) and merge it with their own through
  `mergeStates` (`sync/merge.ts`). Content is per task by `updatedAt`,
  placement per task by `movedAt` (siblings sorted by fractional `rank`,
  `store/rank.ts` / `store/placement.ts`), deletions by tombstones. Exact
  clock ties resolve by comparing the values, so every device picks the same
  winner — "keep local" on a tie makes two devices overwrite each other forever.
- **Clocks only move forward.** Every stamp is at least one past the version
  it replaces (`store.ts`), so an edit always beats what it edited, even when
  another device's clock runs ahead.
- **The desktop** (`sync/v2/engine.ts`, wired by `sync/desktopSync.ts`)
  listens to every collection except the log, and each round: read → merge →
  adopt → diff → commit. Commits to existing documents are **guarded**
  transactions that write only if each document is still what the device
  merged against (else `StaleViewError`: nothing written, merge first, retry).
  Transactions fail instead of queueing offline, so a waking laptop can't
  replay a stale write over a newer one. First-time uploads in bulk and log
  lines go out as plain batches. Log lines are write-only, past a per-device
  watermark (listening to thousands would eat the read quota).
- **The phone** (`sync/v2/viewer.ts`) keeps no local copy and doesn't merge:
  it loads open tasks and those completed in the last 14 days (plus projects
  and meta), and writes each edit as an idempotent intent in a guarded
  transaction, re-applied on a fresh view if the desktop got there first.
  Writes are field-level patches, so a subtask it shows detached (its parent
  wasn't loaded) is never written back as a move.
- **Reads are deterministic.** A cloud document reads the same every round —
  no "now" or random defaults — or it would look edited and be rewritten
  forever.

**Guards.** The engine never syncs before the local store loads; stops writing
if `meta/state.schemaVersion` is newer than its own (the web shows "Reload to
update"); halts if documents don't read back as written, or if it keeps
committing with no local edit behind it (quota protection); retries failures
with backoff and on wake/online/focus. The sidebar shows the state; the desktop
also writes `sync-status.json` (counts and states, no content) to its app-data
folder, so sync can be diagnosed from disk.

**Testing.** The engine and the viewer talk to a `DocStore` port
(`sync/v2/port.ts`); tests run them against `MemoryStore`, which mimics the
Firestore behaviour that matters (whole-collection snapshots, atomic batches,
guarded commits, lagging views via `hold()`/`release()`), including hundreds of
randomized two-device runs that must converge and then write nothing.

**Quota (Spark, free).** Cold start ≈ 1.3k reads on the desktop (collections
minus the log), ≈ 360 on the phone; a normal edit is one read + one small
write. The one-time migration was ≈ 3.6k writes.

### History: the v1 single document, and what broke

Until 2026-09-25 the whole `AppState` lived in one document,
`users/{uid}/data/appData` (now frozen at `schemaVersion: 1000` as a backup).
In September 2026 the desktop silently stopped writing it for nine days (a
hung transaction wedged the push loop), a v16 phone build stripped the v17
desktop's tombstones, and the ~785 KB document was approaching Firestore's
1 MiB cap — every edit rewrote all of it and every listener re-downloaded it.
Those failures are why v2 has timeouts and visible sync health, a schema guard,
small documents, and guarded writes. The plan and its phases are in the
"Execute sync v2 — per-task documents" doc.
