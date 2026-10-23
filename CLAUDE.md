# execute

What this is and how to run it: `README.md`. This file is for what is easy to get wrong.

## Shared browser origin

<!-- mred-randomprojects:shared-origin v1. This block is identical in every repo published under mred-randomprojects.github.io: change them all together. -->

Everything published under this GitHub account is served from
`https://mred-randomprojects.github.io` — the root site at `/` and each repo at
`/<repo>/`. A browser's *origin* is scheme and host, with no path, so all of
them (fulbito, execute, nutriapp, cuentas, dineros, candito-tool,
terrateniente, moonfall and the rest) run on **one origin**, and everything the
browser scopes by origin is a single pool they all share:

- **`localStorage` and `sessionStorage` are one namespace.** Prefix every key
  with this app's name and never use a generic one (`settings`, `data`,
  `history`): any other app can read it, overwrite it or delete it. Never call
  `localStorage.clear()` — it wipes every app's data, not only this one's.
- **So is the quota.** `localStorage` gets about 5 MB per *origin*, not per
  app. One app keeping photos as data URLs can make another app's save throw
  `QuotaExceededError`, and the bytes that filled it may not be this app's.
- **IndexedDB and Cache Storage are shared too.** Name databases and caches
  after the app, and when a service worker clears old caches it must delete
  only its own: `caches.keys()` returns every app's.
- **A service worker must be scoped to its app's own path** (`/<repo>/`). One
  registered at `/` controls every app that has not registered a more
  specific one.
- **Firebase sessions from every app sit side by side.** The Auth SDK keeps
  them all in one IndexedDB database, `firebaseLocalStorageDb`, one record per
  Firebase app, keyed `firebase:authUser:<apiKey>:[DEFAULT]`. Several sessions
  with different uids for the same Google account in there are several
  *apps*, not one account whose uid changed — fulbito's debugging went down
  exactly that wrong path in October 2026.
- **There is no isolation between the apps.** Any script in any of them can
  read every other app's storage and Firebase sessions. That is fine while all
  of the code is the owner's; it also means a bug or a compromised dependency
  in one app reaches all of them. An app that ever needs isolation needs an
  origin of its own (a custom domain), and moving it strands every user's
  local data — a data migration, not a tidy-up.

<!-- /mred-randomprojects:shared-origin -->

**In this repo:** Served at `/execute/`, where only the web viewer runs. localStorage: none of its own (the Firestore SDK can leave a transient `firestore_zombie_*` key when a tab closes). sessionStorage: none. IndexedDB: Firestore's persistent cache `firestore/[DEFAULT]/execute-todo-1d3bc/main`, deleted when you sign out of the viewer. Cache Storage: none, no service worker. Cookies: none. Uses Firebase, so its session is one of the records in `firebaseLocalStorageDb`. The code's two localStorage keys — `execute-store` (the `pnpm dev` browser fallback) and `execute.v2.logWatermark.<uid>` — are written only by the desktop app (Electron's own `file://` storage, apart from any browser's) and the localhost dev server, never on the shared site.

## The everyday views come first

The owner reviews and decides on tasks by hand in the ordinary views. The
rituals that asked at fixed moments (the Reckoning's morning gate, Shutdown,
Plan, the morning habits band, the notifications) went unused and were removed
in October 2026; the **task review** (⌘k → Review tasks) replaced them as a
screen you open when you want it, never on its own. So any capability added to
the review (a verb, a field, a note) must also be reachable from the everyday
views (the outline, the Habits view, `⌘k`), and that everyday path is the one
to build first. A feature that exists only inside the review is, in practice,
a feature nobody uses. Don't bring back a gate, a scheduled ritual or a
notification without being asked.
