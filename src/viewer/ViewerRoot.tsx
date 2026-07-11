import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { AuthProvider, useAuth } from "../auth";
import { LoginPage } from "../components/LoginPage";
import type { AppState } from "../types";
import { loadAppState } from "./cloud";
import { ReadOnlyApp } from "./ReadOnlyApp";
import { SeedPanel } from "./SeedPanel";

// UX-level gate only. The REAL enforcement is the Firestore security rules,
// which reject any read whose auth token isn't this verified email — the client
// cannot grant itself access by editing this constant.
const AUTHORIZED_EMAIL = "maxiredigonda@gmail.com";

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-ink">
      {children}
    </div>
  );
}

function Gate() {
  const { user, loading, signOut } = useAuth();

  if (loading) {
    return (
      <Centered>
        <p className="text-sm text-ink-faint">Loading…</p>
      </Centered>
    );
  }

  if (user == null) {
    return <LoginPage />;
  }

  if (user.email !== AUTHORIZED_EMAIL) {
    return (
      <Centered>
        <h1 className="font-serif text-2xl font-medium">Not authorized</h1>
        <p className="max-w-sm text-sm text-ink-soft">
          <span className="font-medium text-ink">{user.email}</span> can't access
          this data. Sign in with the owner's Google account.
        </p>
        <button
          onClick={() => void signOut()}
          className="rounded border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2"
        >
          Sign out
        </button>
      </Centered>
    );
  }

  return <AuthedViewer user={user} onSignOut={() => void signOut()} />;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "ready"; state: AppState }
  | { kind: "error"; message: string };

function AuthedViewer({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  // ?seed → the one-time upload flow instead of the reader.
  const seedMode =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("seed");

  const [load, setLoad] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    if (seedMode) return;
    let cancelled = false;
    loadAppState(user.uid)
      .then((state) => {
        if (cancelled) return;
        setLoad(state == null ? { kind: "empty" } : { kind: "ready", state });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : "Failed to load your data.";
        setLoad({ kind: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [user.uid, seedMode]);

  if (seedMode) return <SeedPanel user={user} onSignOut={onSignOut} />;

  if (load.kind === "loading") {
    return (
      <Centered>
        <p className="text-sm text-ink-faint">Loading your tasks…</p>
      </Centered>
    );
  }

  if (load.kind === "error") {
    return (
      <Centered>
        <h1 className="font-serif text-2xl font-medium">Couldn't load</h1>
        <p className="max-w-sm text-sm text-ink-soft">{load.message}</p>
        <p className="max-w-sm text-[12px] text-ink-faint">
          If this says permission denied, re-publish the Firestore rules.
        </p>
        <button
          onClick={onSignOut}
          className="rounded border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2"
        >
          Sign out
        </button>
      </Centered>
    );
  }

  if (load.kind === "empty") {
    return (
      <Centered>
        <h1 className="font-serif text-2xl font-medium">No data yet</h1>
        <p className="max-w-sm text-sm text-ink-soft">
          Nothing has been synced to the cloud. Seed it once from the desktop
          store file at <code className="text-[12px]">?seed</code>.
        </p>
        <button
          onClick={onSignOut}
          className="rounded border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2"
        >
          Sign out
        </button>
      </Centered>
    );
  }

  return <ReadOnlyApp state={load.state} user={user} onSignOut={onSignOut} />;
}

export function ViewerRoot() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
