# Firebase Setup

This app follows the same Firebase pattern as `candito-tool`, `nutriapp`, and
`dineros`, adapted to Execute's plan (see the "Execute → Firebase" plan of
action):

- Google Authentication for sign-in.
- Cloud Firestore document per user at `users/{uid}/data/appData`.
- **One-way sync (phase 1):** the Electron desktop app is the single source of
  truth and *pushes* its `AppState` up. The web build is a **read-only viewer**.
  There is no merge step and no web→desktop write path yet — that is a
  deliberate later phase, only after the viewer is trusted.

## 1. Create Or Select The Firebase Project

1. Open [Firebase Console](https://console.firebase.google.com/).
2. Create a **new** project — named `execute-todo` (Firebase assigned the id
   `execute-todo-1d3bc`). Keep it separate
   from nutriapp/dineros/candito; there is no reason to share one project across
   unrelated data.
3. Analytics is optional; it is not required for auth or Firestore sync.

## 2. Register The Web App

1. In the project overview, click the Web app icon (`</>`).
2. App nickname: `execute`.
3. Do **not** enable Firebase Hosting — this app deploys via GitHub Pages.
4. Click **Register app**.
5. Firebase shows a config object. Copy these values into `.env.local`
   (create it from [.env.example](./.env.example)):

```bash
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

`.env.local` is gitignored (`*.local`) — never commit it.

## 3. Enable Google Authentication

1. In Firebase Console, go to **Build > Authentication**.
2. Click **Get started** if Authentication is not enabled yet.
3. Open **Sign-in method**.
4. Choose **Google**.
5. Toggle **Enable**.
6. Select a project support email.
7. Click **Save**.

## 4. Add Authorized Domains

In **Authentication > Settings > Authorized domains**, make sure these are listed:

- `localhost`
- `127.0.0.1`
- `maximilianoredigonda.github.io`

If you use another production domain later, add only the hostname, not the full
URL path. For the current GitHub Pages setup, the viewer URL is expected to be:

```text
https://maximilianoredigonda.github.io/execute/
```

## 5. Create Firestore

1. Go to **Build > Firestore Database**.
2. Click **Create database**.
3. Choose **Production mode**.
4. Pick the closest region you want to keep long term. You usually cannot change
   this later.
5. Finish creation.

## 6. Publish Security Rules

1. In **Firestore Database**, open the **Rules** tab.
2. Replace the rules with the contents of [firestore.rules](./firestore.rules).
3. Click **Publish**.

The important rule is:

```js
match /users/{userId}/data/appData {
  allow read, write: if request.auth != null &&
    request.auth.uid == userId &&
    request.auth.token.email == "maxiredigonda@gmail.com";
}
```

That means only your signed-in Google account can read and write its own app
data. Client-side checks are not security — this rule is the real enforcement,
and the read-only web viewer still requires sign-in to load anything.

## 7. Add GitHub Actions Secrets (when the web viewer ships)

Because the viewer deploys through GitHub Pages, the Vite Firebase environment
variables must exist in GitHub Actions too.

1. Open the GitHub repository.
2. Go to **Settings > Secrets and variables > Actions**.
3. Add these repository secrets (same values as `.env.local`):

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

The deploy workflow (added in a later step) passes these into the build.

## 8. First-Sync Verification (once the Electron push lands)

Under one-way sync the desktop app is always the source of truth, so migration
is simple and additive — no merge to get wrong:

1. In the desktop (Electron) app, sign in with Google.
2. Trigger **Sync now**.
3. Open Firebase Console > Firestore Database > Data.
4. Confirm this document exists:

```text
users/{yourFirebaseUid}/data/appData
```

5. Click the document and verify it contains `tasks`, `projects`, and
   `schemaVersion`.
6. Only then load the web viewer, sign in with the same Google account, and
   confirm the tasks render.
7. Confirm an account that is **not** `maxiredigonda@gmail.com` (a second
   phone / incognito tab) is refused.

## 9. Do Not Do This

- Do not publish permissive rules like `allow read, write: if true`.
- Do not commit `.env.local` or any file containing the Firebase config.
- Firestore is purely a mirror in phase 1 — nothing here deletes or overwrites
  the desktop app's local JSON. Keep it that way until a two-way sync is
  deliberately built.
