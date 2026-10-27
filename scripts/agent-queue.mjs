#!/usr/bin/env node
// The task review's queue, read from the desktop's store file, for Claude to
// go through with the owner (the writes go through scripts/agent.mjs).
// Sections, in the order the review takes them: today, overdue (newest
// first), this week without a day. Each line: id, date, project › path ::
// text, and the deferral counters and notes that say how stuck it is.
//
//   node scripts/agent-queue.mjs [--today 2026-10-27]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STORE = path.join(os.homedir(), "Library", "Application Support", "execute", "execute-store.json");
const arg = process.argv.indexOf("--today");
const today = arg > 0 ? process.argv[arg + 1] : new Date().toLocaleDateString("sv");

function isoWeek(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const raw = JSON.parse(fs.readFileSync(STORE, "utf8"));
const state = raw.state ?? raw;
const projects = new Map(state.projects.map((p) => [p.id, p.name]));
const live = (t) => !t.completed && !t.wontDo;
const thisWeek = isoWeek(today);
const sections = { today: [], overdue: [], week: [] };

(function walk(tasks, trail, inherited) {
  for (const t of tasks) {
    const planned = t.plannedFor ?? inherited;
    const openKids = (t.children ?? []).filter(live);
    if (live(t) && openKids.length === 0) {
      const row = { t, planned, trail };
      if (planned === today) sections.today.push(row);
      else if (planned != null && planned < today) sections.overdue.push(row);
      else if (planned == null && t.horizon?.unit === "week" && t.horizon.anchor <= thisWeek) sections.week.push(row);
    }
    walk(t.children ?? [], [...trail, (t.text ?? "").slice(0, 50)], planned);
  }
})(state.tasks, [], null);

sections.overdue.sort((a, b) => b.planned.localeCompare(a.planned));
const titles = { today: "HOY", overdue: "VENCIDAS (más nuevas primero)", week: "ESTA SEMANA, SIN DÍA" };
let n = 0;
for (const [key, rows] of Object.entries(sections)) {
  console.log(`\n== ${titles[key]} (${rows.length}) ==`);
  for (const { t, planned, trail } of rows) {
    n += 1;
    const where = [projects.get(t.projectId) ?? "?", ...trail].join(" › ");
    const stuck = `post=${t.postponedCount ?? 0} carry=${t.carriedCount ?? 0}`;
    const notes = (t.notes ?? "").replace(/\s+/g, " ").slice(0, 140);
    console.log(`${n}. [${t.id}] ${planned ?? "-"} ${where} :: ${t.text} | ${stuck}${notes ? ` | notas: ${notes}` : ""}`);
  }
}
