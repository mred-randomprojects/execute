import { nanoid } from "nanoid";
import type { Command } from "../core/commands";
import { dispatch, getLoaded, getState, saveNow } from "./store";

// ─── Commands from the agent socket ──────────────────────────────────
//
// A local script (Claude, going through a task review with the owner) sends a
// list of commands through electron/agent.cjs. They run through the same
// `dispatch` as the keyboard — so each one shows on screen, is one ⌘Z step,
// and syncs like any edit — but only the review's verbs are allowed: editing,
// scheduling, completing and dropping tasks. Nothing that purges, empties the
// trash or touches habits and settings.

const ALLOWED = new Set<Command["type"]>([
  "setText",
  "setNotes",
  "addChild",
  "addTaskAfter",
  "addTaskAtProjectStart",
  "setCompleted",
  "setCompletedMany",
  "markWontDo",
  "markWontDoMany",
  "clearWontDo",
  "setWontDoReason",
  "markWaiting",
  "clearWaiting",
  "setPriority",
  "setEstimatedMinutesMany",
  "setPlannedFor",
  "setPlannedForMany",
  "setHorizonMany",
  "postponeMany",
  "carryMany",
  "dropManyWithLog",
  "setProjectForMany",
  "moveAsChild",
  "logBreakdown",
]);

/** Commands that create a task: the id is the caller's, or a fresh one. */
const CREATES = new Set<string>(["addChild", "addTaskAfter", "addTaskAtProjectStart"]);

function isAllowedCommand(x: unknown): x is Command {
  if (typeof x !== "object" || x == null || !("type" in x)) return false;
  const type = x.type;
  return typeof type === "string" && ALLOWED.has(type as Command["type"]);
}

export interface AgentStep {
  type: string;
  /** False when the command changed nothing (an unknown id, already true). */
  changed: boolean;
  /** The new task's id, for commands that create one. */
  id?: string;
}

export type AgentResult =
  | { ok: true; steps: AgentStep[]; saved: boolean }
  | { ok: false; error: string };

/** Run a request's `commands` in order. All are checked before any runs. */
export async function runAgentRequest(request: unknown): Promise<AgentResult> {
  if (!getLoaded()) return { ok: false, error: "The store hasn't loaded." };
  const raw =
    typeof request === "object" && request != null && "commands" in request
      ? request.commands
      : null;
  if (!Array.isArray(raw)) return { ok: false, error: "Expected { commands: [...] }." };
  const commands: Command[] = [];
  for (const item of raw) {
    const withId =
      typeof item === "object" && item != null && "type" in item && CREATES.has(String(item.type)) && !("id" in item)
        ? { ...item, id: nanoid() }
        : item;
    if (!isAllowedCommand(withId)) {
      const type = typeof item === "object" && item != null && "type" in item ? String(item.type) : "?";
      return { ok: false, error: `Command not allowed: ${type}. Nothing ran.` };
    }
    commands.push(withId);
  }
  const steps: AgentStep[] = commands.map((command) => {
    const before = getState();
    dispatch(command);
    const step: AgentStep = { type: command.type, changed: getState() !== before };
    if ("id" in command && CREATES.has(command.type)) step.id = command.id;
    return step;
  });
  return { ok: true, steps, saved: await saveNow() };
}
