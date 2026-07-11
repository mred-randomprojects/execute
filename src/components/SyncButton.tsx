import { useState, useSyncExternalStore } from "react";
import { getStatus, signIn, subscribeStatus, syncNow } from "../sync/desktopSync";

/**
 * Desktop-only cloud-sync status (sidebar footer). Sync itself is automatic —
 * every change pushes on its own (see desktopSync). This just surfaces state
 * and offers the one-time interactive sign-in / a retry.
 */
export function SyncButton() {
  const status = useSyncExternalStore(subscribeStatus, getStatus);
  const [signingIn, setSigningIn] = useState(false);

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

  const dot =
    status.kind === "idle"
      ? "bg-good"
      : status.kind === "error"
        ? "bg-bad"
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
          : "Synced to cloud";

  const onClick =
    status.kind === "signedOut" ? () => void handleSignIn() : () => syncNow();

  return (
    <div className="flex flex-col gap-0.5">
      <button
        onClick={onClick}
        disabled={status.kind === "syncing" || signingIn}
        className="flex items-center justify-between rounded-sm px-2.5 py-1.5 text-[13px] text-ink-soft hover:bg-surface-2/60 hover:text-ink disabled:opacity-60"
      >
        <span>{label}</span>
        <span className={`h-[9px] w-[9px] rounded-full ${dot}`} />
      </button>
      {status.kind === "error" && (
        <span className="px-2.5 text-[11px] text-bad">{status.message}</span>
      )}
      {status.kind === "idle" && status.email != null && (
        <span className="px-2.5 text-[11px] text-ink-faint">{status.email}</span>
      )}
    </div>
  );
}
