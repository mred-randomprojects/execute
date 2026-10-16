import { useEffect, useState } from "react";

/** The wall clock, re-read every `ms` while `on` — for the running timers. */
export function useTicking(on: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [on, ms]);
  return on ? now : Date.now();
}
