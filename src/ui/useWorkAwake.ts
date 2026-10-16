import { useEffect, useRef } from "react";
import type { Task } from "../types";
import { openSessionStarts } from "../store/work";

/**
 * Closes the running session at the first moment nobody was there — the Mac
 * asleep or locked, the app not running (electron/awake.cjs knows when) — and
 * leaves the task in progress, paused. Desktop only: without the bridge (the
 * browser dev build) it does nothing.
 *
 * Asked on load, on every wake/unlock, and again whenever the tasks change
 * while a session is still open: the cloud's copy of a task can hand back a
 * session this already closed, or one on a task the phone completed while the
 * Mac slept (no longer "in progress", but its stretch still has to end where
 * the Mac went to sleep, not when the phone was tapped). Every open session is
 * looked at, not only the current task's.
 */
export function useWorkAwake(loaded: boolean, tasks: Task[], pauseAt: (at: number) => void): void {
  const tasksRef = useRef(tasks);
  const checkRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const bridge = window.execute;
    if (!loaded || bridge?.workOffSince == null) return;
    const ask = bridge.workOffSince;
    let alive = true;
    let running = false;
    let again = false;
    // Session starts already asked about with no answer: nothing was off since
    // then. Only a wake or an unlock (which clears this) can change that.
    const quiet = new Set<number>();

    const once = async () => {
      const starts = openSessionStarts(tasksRef.current);
      if (starts.length === 0) return;
      const since = Math.min(...starts);
      if (quiet.has(since)) return;
      const off = await ask(since).catch(() => null);
      if (!alive) return;
      if (off == null) {
        quiet.add(since);
        return;
      }
      // Still open? A stop or a restart in the meantime wins.
      if (!openSessionStarts(tasksRef.current).some((start) => start <= off)) return;
      pauseAt(off);
    };
    const check = () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      void (async () => {
        try {
          do {
            again = false;
            await once();
          } while (again && alive);
        } finally {
          running = false;
        }
      })();
    };

    checkRef.current = check;
    check();
    const unsubscribe = bridge.onAwake?.(() => {
      quiet.clear();
      check();
    });
    return () => {
      alive = false;
      checkRef.current = null;
      unsubscribe?.();
    };
  }, [loaded, pauseAt]);

  useEffect(() => {
    tasksRef.current = tasks;
    checkRef.current?.();
  }, [tasks]);
}
