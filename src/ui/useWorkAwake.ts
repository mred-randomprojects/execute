import { useEffect, useRef } from "react";
import type { Task } from "../types";
import { runningSince } from "../store/work";

/**
 * Closes the running session at the first moment nobody was there — the Mac
 * asleep or locked, the app not running (electron/awake.cjs knows when) — and
 * leaves the task in progress, paused. Asked on load and on every wake/unlock.
 * Desktop only: without the bridge (the browser dev build) it does nothing.
 */
export function useWorkAwake(
  loaded: boolean,
  current: Task | null,
  pauseAt: (at: number) => void,
): void {
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  useEffect(() => {
    const bridge = window.execute;
    if (!loaded || bridge?.workOffSince == null) return;
    const ask = bridge.workOffSince;
    let alive = true;
    const check = async () => {
      const task = currentRef.current;
      const since = task == null ? null : runningSince(task);
      if (since == null) return;
      const off = await ask(since).catch(() => null);
      // Still the same session? A stop or a restart in the meantime wins.
      const now = currentRef.current;
      if (!alive || off == null || now == null || runningSince(now) !== since) return;
      pauseAt(off);
    };
    void check();
    const unsubscribe = bridge.onAwake?.(() => void check());
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [loaded, pauseAt]);
}
