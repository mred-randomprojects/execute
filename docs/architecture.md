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
  (`viewer/cloud.ts`, `sync/desktopSync.ts`). New platform differences go here —
  never into feature code.
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
- Persistence: desktop = a local JSON file (via preload IPC); web = Firestore
  (`viewer/cloud.ts`). The desktop pushes/merges through `sync/desktopSync.ts`.

## Rule of thumb

Before adding code, ask: **is this domain logic, or platform IO/UI?**

- **Logic** → the shared core, with a unit test. (Ask: would the desktop want
  this too? If yes, it belongs in the core.)
- **IO / capability / touch UI** → the persistence-sync seam or a capability
  flag on a shared component.

If you're ever tempted to copy logic into the viewer, stop: put it in the core
and call it from both. That discipline is what keeps A→B a convergence.

## Sync: how it works, and how it failed

The whole `AppState` lives in **one Firestore document**
(`users/{uid}/data/appData`). Every client writes it the same way:
`viewer/cloud.ts` `mergeAndSave` — a transaction that reads the document,
merges (`sync/merge.ts`, per-task last-write-wins + tombstones) and writes the
**cloud projection** (`sync/cloudDoc.ts` `toCloud`). The desktop also listens
(`onSnapshot`) and merges every remote change into its local store.

What went wrong in September 2026, and the guard for each:

- **The desktop stopped writing for nine days, and nothing showed it.** A
  transaction RPC can hang forever after a sleep or a network change, and the
  push loop waited behind it. → Every push has a timeout, failures retry with
  backoff, and online/focus/visibility events plus a 60s heartbeat retry
  anything outstanding. The sidebar shows *when* it last synced and whether
  local changes are still waiting (amber after 10 minutes).
- **An older client stripped a newer one's fields.** The phone ran a v16 build
  against a v17 document, coerced away `tombstones` and wrote the result back.
  → `mergeAndSave` refuses to write a document whose `schemaVersion` is newer
  than its own (`OutdatedClientError`); the web shows "Reload to update".
  Always ship both clients from the same commit.
- **The document is capped at 1 MiB.** It was ~785 KB and growing, mostly the
  append-only `log`. → The cloud carries only the last `CLOUD_LOG_DAYS` of the
  log (the desktop file keeps it all; the merge unions by id), and a write over
  budget fails with a clear `CloudDocTooLargeError` instead of an opaque one.
- **A stray `undefined` would reject every write** while the JSON file on disk
  hid it. → `ignoreUndefinedProperties`.
- **The phone's Today read as "no tasks".** Carrying yesterday's leftovers
  forward happens in the desktop's Reckoning; until then they're planned for a
  day that's gone. → The web's Today lists them under "Earlier", and its header
  says how old the cloud copy is.

**Known limit — the next architectural step.** One document means every edit
rewrites (and every listener re-downloads) the whole state, and the 1 MiB cap
is only pushed back, not removed. The durable fix is a document per task (or
per project) plus a small metadata doc; the merge rules in `sync/merge.ts`
already operate per task, so they carry over.
