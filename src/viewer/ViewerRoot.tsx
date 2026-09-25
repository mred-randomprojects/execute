import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { AuthProvider, useAuth } from "../auth";
import { LoginPage } from "../components/LoginPage";
import type { Task, TaskId } from "../types";
import { findById, makeTask } from "../store/tasks";
import { setCompleted, updateTask } from "./intents";
import type { TaskPatch } from "./TaskSheet";
import { parseCapture } from "../store/capture";
import { todayISO } from "../store/dates";
import { firebaseConfigured } from "../firebase";
import { firestoreDocStore } from "../sync/v2/firestoreStore";
import { ViewerSync, type ViewerSnapshot } from "../sync/v2/viewer";
import { ReadOnlyApp } from "./ReadOnlyApp";

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
  const [snap, setSnap] = useState<ViewerSnapshot>({ phase: "loading" });
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  // A write that failed. Shown until the next one succeeds, so a check-off that
  // didn't save can't quietly disappear.
  const [saveError, setSaveError] = useState<string | null>(null);
  const syncRef = useRef<ViewerSync | null>(null);

  useEffect(() => {
    setPhase("loading");
    setErrorMsg("");
    let painted = false;
    const sync = new ViewerSync(
      firestoreDocStore(user.uid),
      (s) => {
        setSnap(s);
        if (s.phase !== "loading") {
          painted = true;
          setPhase("ready");
        }
      },
      (e) => {
        // A live-stream hiccup after we've shown data shouldn't blank the page.
        if (painted) return;
        setErrorMsg(e instanceof Error ? e.message : "Failed to load your data.");
        setPhase("error");
      },
    );
    syncRef.current = sync;
    sync.start();
    // Backstop: never spin forever. If nothing has painted, offer a retry.
    const timer = setTimeout(() => {
      if (painted) return;
      setErrorMsg("This is taking longer than usual — check your connection and try again.");
      setPhase("error");
    }, 10_000);
    return () => {
      clearTimeout(timer);
      sync.stop();
      syncRef.current = null;
    };
  }, [user.uid, reloadKey]);

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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="rounded border border-line bg-ink px-4 py-2 text-sm font-medium text-bg hover:opacity-90"
          >
            Try again
          </button>
          <button
            onClick={onSignOut}
            className="rounded border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2"
          >
            Sign out
          </button>
        </div>
      </Centered>
    );
  }

  if (snap.phase === "notMigrated") {
    return (
      <Centered>
        <h1 className="font-serif text-2xl font-medium">Moving your data</h1>
        <p className="max-w-sm text-sm text-ink-soft">
          Your tasks are moving to a new sync format. Open Execute on your Mac to
          finish — this page updates by itself when it's done.
        </p>
      </Centered>
    );
  }

  if (snap.phase !== "ready") {
    return (
      <Centered>
        <p className="text-sm text-ink-faint">Loading your tasks…</p>
      </Centered>
    );
  }

  const state = snap.state;
  const run = (edit: Parameters<ViewerSync["apply"]>[0]) => {
    const sync = syncRef.current;
    if (sync == null) return;
    sync.apply(edit).then(
      () => setSaveError(null),
      (e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("cloud sync failed", e);
        setSaveError(e instanceof Error ? e.message : "Couldn't save that change.");
      },
    );
  };

  const onToggle = (taskId: TaskId) => {
    const task = findById(state.tasks, taskId);
    if (task == null) return;
    const completed = !task.completed;
    run((s) => ({ ...s, tasks: setCompleted(s.tasks, taskId, completed) }));
  };

  // Capture from the phone. Reuses the shared parser + makeTask (no viewer-only
  // logic); a new task lands in the Inbox project, planned for today when the
  // Today tab is active, otherwise undated. Created once, so a retry adds the
  // same task rather than a second one.
  const onAdd = (text: string, today: boolean) => {
    const parsed = parseCapture(text);
    if (parsed.text.trim() === "") return;
    const task: Task = {
      ...makeTask(parsed.text),
      completed: parsed.completed,
      completedAt: parsed.completed ? Date.now() : null,
      plannedFor: today ? todayISO(state.devDateOverride) : null,
    };
    run((s) => (findById(s.tasks, task.id) != null ? s : { ...s, tasks: [...s.tasks, task] }));
  };

  const onUpdate = (taskId: TaskId, patch: TaskPatch) => {
    run((s) => ({ ...s, tasks: updateTask(s.tasks, taskId, patch) }));
  };

  return (
    <ReadOnlyApp
      state={state}
      cloudUpdatedAt={snap.updatedAt}
      notice={
        snap.outdated
          ? { text: "A newer version of Execute saved this data. Reload to update before editing.", action: "Reload", onAction: () => window.location.reload() }
          : saveError != null
            ? { text: `Couldn't save: ${saveError}`, action: "Dismiss", onAction: () => setSaveError(null) }
            : null
      }
      email={user.email}
      onSignOut={onSignOut}
      onToggle={onToggle}
      onAdd={onAdd}
      onUpdate={onUpdate}
    />
  );
}

export function ViewerRoot() {
  // Unlike the desktop — which just runs local-first with sync switched off —
  // the viewer IS the cloud, so an unconfigured build has nothing to show. Say
  // that plainly and above AuthProvider, whose effect would otherwise construct
  // the SDK and throw. A deploy missing one GitHub secret used to land here as
  // a blank page.
  if (!firebaseConfigured()) {
    return (
      <Centered>
        <h1 className="font-serif text-2xl font-medium">Not configured</h1>
        <p className="max-w-sm text-sm text-ink-soft">
          This build has no Firebase credentials, so there's no cloud to read.
          Set the <code className="text-[12px]">VITE_FIREBASE_*</code> values in{" "}
          <code className="text-[12px]">.env.local</code> (or the deploy's GitHub
          secrets) and rebuild.
        </p>
      </Centered>
    );
  }
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
