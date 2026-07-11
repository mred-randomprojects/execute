import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { AuthProvider, useAuth } from "../auth";
import { LoginPage } from "../components/LoginPage";
import type { AppState, Task, TaskId } from "../types";
import { mapById } from "../store/tasks";
import { mergeAndSave, subscribeAppState } from "./cloud";
import { ReadOnlyApp } from "./ReadOnlyApp";
import { SeedPanel } from "./SeedPanel";

/** Flip completion on one task (pure), stamping updatedAt so the LWW merge
 * treats this edit as the newest for that task. */
function toggleCompleted(tasks: Task[], id: TaskId): Task[] {
  return mapById(tasks, id, (t) => {
    const completed = !t.completed;
    return {
      ...t,
      completed,
      completedAt: completed ? Date.now() : null,
      wontDo: completed ? null : t.wontDo,
      updatedAt: Date.now(),
    };
  });
}

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

function AuthedViewer({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  // ?seed → the one-time upload flow instead of the reader.
  const seedMode =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("seed");

  const [state, setState] = useState<AppState | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (seedMode) return;
    // Live subscription: reflects desktop edits and our own writes as they land.
    const unsub = subscribeAppState(
      user.uid,
      (s) => {
        setState(s);
        setPhase("ready");
      },
      (e) => {
        setErrorMsg(e instanceof Error ? e.message : "Failed to load your data.");
        setPhase("error");
      },
    );
    return unsub;
  }, [user.uid, seedMode]);

  if (seedMode) return <SeedPanel user={user} onSignOut={onSignOut} />;

  if (phase === "loading") {
    return (
      <Centered>
        <p className="text-sm text-ink-faint">Loading your tasks…</p>
      </Centered>
    );
  }

  if (phase === "error") {
    return (
      <Centered>
        <h1 className="font-serif text-2xl font-medium">Couldn't load</h1>
        <p className="max-w-sm text-sm text-ink-soft">{errorMsg}</p>
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

  if (state == null) {
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

  // Checking a task off: apply optimistically, then push through the merge
  // (per-task LWW) so a concurrent desktop edit can't clobber it. onSnapshot
  // then reconciles to the server truth (which includes this change).
  const onToggle = (taskId: TaskId) => {
    const next: AppState = { ...state, tasks: toggleCompleted(state.tasks, taskId) };
    setState(next);
    void mergeAndSave(user.uid, next).catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.error("cloud sync failed", e);
    });
  };

  return <ReadOnlyApp state={state} user={user} onSignOut={onSignOut} onToggle={onToggle} />;
}

export function ViewerRoot() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
