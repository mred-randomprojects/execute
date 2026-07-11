import { useState } from "react";
import type { User } from "firebase/auth";
import { countAll } from "../store/tasks";
import { coerceState } from "../store/persistence";
import { saveAppState } from "./cloud";

type Status =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; tasks: number; projects: number }
  | { kind: "error"; message: string };

/**
 * One-time seed (reached via ?seed). Reads the desktop app's exported store
 * JSON — the file at ~/Library/Application Support/Execute/execute-store.json —
 * runs it through the same coerceState the app uses, and writes it to the
 * user's cloud document. The write is authorized purely by being signed in as
 * the owner; no service-account key involved.
 */
export function SeedPanel({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function handleFile(file: File) {
    setStatus({ kind: "working" });
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setStatus({ kind: "error", message: "That file isn't valid JSON." });
      return;
    }
    const state = coerceState(raw);
    const taskCount = state.tasks.reduce((n, t) => n + countAll(t).total, 0);
    try {
      await saveAppState(user.uid, state);
      setStatus({ kind: "done", tasks: taskCount, projects: state.projects.length });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Write failed.";
      setStatus({ kind: "error", message });
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-bg px-6 text-center text-ink">
      <div className="flex flex-col items-center gap-1.5">
        <h1 className="font-serif text-3xl font-medium">Seed the cloud</h1>
        <p className="max-w-md text-sm text-ink-soft">
          Upload the desktop app's store file to copy it up once. It lives at{" "}
          <code className="rounded-sm bg-surface-2 px-1 py-0.5 text-[12px]">
            ~/Library/Application Support/Execute/execute-store.json
          </code>
          .
        </p>
      </div>

      <label className="cursor-pointer rounded border border-line bg-surface px-6 py-3 text-sm font-medium shadow-soft transition-colors hover:bg-surface-2">
        {status.kind === "working" ? "Uploading…" : "Choose store JSON…"}
        <input
          type="file"
          accept="application/json,.json"
          className="hidden"
          disabled={status.kind === "working"}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f != null) void handleFile(f);
          }}
        />
      </label>

      {status.kind === "done" && (
        <p className="text-sm text-good">
          Seeded {status.tasks} task{status.tasks === 1 ? "" : "s"} across {status.projects}{" "}
          project{status.projects === 1 ? "" : "s"}. Open the viewer without <code>?seed</code> to
          see them.
        </p>
      )}
      {status.kind === "error" && <p className="text-sm text-bad">{status.message}</p>}

      <button
        type="button"
        onClick={onSignOut}
        className="text-[12px] text-ink-faint underline-offset-2 hover:underline"
      >
        Sign out ({user.email})
      </button>
    </div>
  );
}
