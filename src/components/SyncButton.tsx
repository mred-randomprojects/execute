import { useState } from "react";
import { pushNow, syncAvailable } from "../sync/desktopSync";

type Status = "idle" | "syncing" | "done" | "error";

/**
 * Desktop-only "Sync to cloud" control (sidebar footer). Hidden entirely unless
 * the loopback OAuth client is configured. On demand: signs in (system browser)
 * if needed, then pushes the whole store up. Read-only web viewer reflects it.
 */
export function SyncButton() {
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState<string | null>(null);

  if (!syncAvailable()) return null;

  async function run() {
    setStatus("syncing");
    setMsg(null);
    try {
      const { email } = await pushNow();
      setStatus("done");
      setMsg(email != null ? `Synced · ${email}` : "Synced");
    } catch (e: unknown) {
      setStatus("error");
      setMsg(e instanceof Error ? e.message : "Sync failed");
    }
  }

  const dot =
    status === "done"
      ? "bg-good"
      : status === "error"
        ? "bg-bad"
        : status === "syncing"
          ? "bg-mid"
          : "bg-line-strong";

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() => void run()}
        disabled={status === "syncing"}
        className="flex items-center justify-between rounded-sm px-2.5 py-1.5 text-[13px] text-ink-soft hover:bg-surface-2/60 hover:text-ink disabled:opacity-60"
      >
        <span>{status === "syncing" ? "Syncing…" : "Sync to cloud"}</span>
        <span className={`h-[9px] w-[9px] rounded-full ${dot}`} />
      </button>
      {msg != null && (
        <span
          className={`px-2.5 text-[11px] ${status === "error" ? "text-bad" : "text-ink-faint"}`}
        >
          {msg}
        </span>
      )}
    </div>
  );
}
