import { useEffect, useState, useSyncExternalStore } from "react";
import { getStatus, signIn, subscribeStatus, syncNow } from "../sync/desktopSync";
import { sinceLabel } from "../store/dates";

/** Unsynced changes older than this turn the control amber: something is off. */
const STALE_MS = 10 * 60_000;

/** Re-render every 30s so "5m ago" keeps telling the truth. */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * Desktop-only cloud-sync status (sidebar footer). Sync itself is automatic —
 * every change pushes on its own (see desktopSync). This surfaces whether that
 * is actually working — when it last succeeded, and whether local changes are
 * still waiting — and offers the one-time interactive sign-in / a retry.
 */
export function SyncButton() {
  const status = useSyncExternalStore(subscribeStatus, getStatus);
  const [signingIn, setSigningIn] = useState(false);
  const now = useNow();

  if (status.kind === "off") return null;

  async function handleSignIn() {
    setSigningIn(true);
    try {
      await signIn();
    } catch {
      /* status surfaces the error */
    } finally {
      setSigningIn(false);
    }
  }

  const lastSyncedAt = status.kind === "signedOut" ? null : status.lastSyncedAt;
  const since = lastSyncedAt == null ? null : sinceLabel(lastSyncedAt, now);
  // Unsynced for a while with no error showing is the failure mode that used to
  // go unnoticed for days — make it look like one.
  const stale =
    status.kind === "idle" &&
    status.pending &&
    (lastSyncedAt == null || now - lastSyncedAt > STALE_MS);

  const dot =
    status.kind === "error"
      ? "bg-bad"
      : status.kind === "idle"
        ? status.pending
          ? "bg-mid"
          : "bg-good"
        : status.kind === "syncing"
          ? "bg-mid"
          : "bg-line-strong";

  const label =
    status.kind === "signedOut"
      ? signingIn
        ? "Signing in…"
        : "Sign in to sync"
      : status.kind === "syncing"
        ? "Syncing…"
        : status.kind === "error"
          ? "Sync error — retry"
          : status.pending
            ? "Unsynced changes — sync"
            : "Synced to cloud";

  let detail: string | null = null;
  if (status.kind === "error") {
    detail = [
      status.message,
      status.retryAt != null ? "Retrying automatically." : null,
      since != null ? `Last synced ${since}.` : null,
    ]
      .filter((x) => x != null)
      .join(" ");
  } else if (status.kind === "syncing" && status.detail != null) {
    detail = status.detail;
  } else if (status.kind === "idle" || status.kind === "syncing") {
    detail = [status.email, since != null ? `synced ${since}` : "not synced yet"]
      .filter((x) => x != null)
      .join(" · ");
  }

  const onClick =
    status.kind === "signedOut" ? () => void handleSignIn() : () => syncNow();

  return (
    <div className="flex flex-col gap-0.5">
      <button
        onClick={onClick}
        disabled={signingIn}
        className="flex items-center justify-between rounded-sm px-2.5 py-1.5 text-[13px] text-ink-soft hover:bg-surface-2/60 hover:text-ink disabled:opacity-60"
      >
        <span>{label}</span>
        <span className={`h-[9px] w-[9px] rounded-full ${dot}`} />
      </button>
      {detail != null && (
        <span
          className={`px-2.5 text-[11px] ${
            status.kind === "error" ? "text-bad" : stale ? "text-mid" : "text-ink-faint"
          }`}
        >
          {detail}
        </span>
      )}
    </div>
  );
}
