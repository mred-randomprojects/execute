// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { KEEP, backUpDaily, dailyBackupsToPrune, localDate } = require("./backups.cjs");

/** `n` consecutive daily backup names ending on 2026-10-09, oldest first. */
function dailyNames(n) {
  const names = [];
  for (let i = n - 1; i >= 0; i--) {
    names.push(`execute-store.${localDate(new Date(2026, 9, 9 - i))}.json`);
  }
  return names;
}

// The files Max already has in backups/: they must survive every prune.
const FOREIGN = [
  "execute-store.pre-sync-v2.20260925-083336.json",
  "cloud-v1-doc.pre-sync-v2.20260925-083336.json",
  "execute-store.2026-10-09.json.tmp",
  "execute-store.2026-1-9.json",
  "notes.txt",
];

describe("dailyBackupsToPrune", () => {
  it("keeps the newest 30 daily copies and returns the older ones", () => {
    const names = dailyNames(KEEP + 3);
    expect(KEEP).toBe(30);
    expect(dailyBackupsToPrune(names)).toEqual(names.slice(0, 3));
  });

  it("returns nothing while there are 30 or fewer", () => {
    expect(dailyBackupsToPrune(dailyNames(KEEP))).toEqual([]);
    expect(dailyBackupsToPrune([])).toEqual([]);
  });

  it("never returns a name that isn't exactly execute-store.YYYY-MM-DD.json", () => {
    const pruned = dailyBackupsToPrune([...FOREIGN, ...dailyNames(KEEP + 2)].reverse());
    expect(pruned).toHaveLength(2);
    for (const name of FOREIGN) expect(pruned).not.toContain(name);
  });
});

describe("localDate", () => {
  it("is the local calendar day, also late in the evening", () => {
    expect(localDate(new Date(2026, 9, 9, 23, 30))).toBe("2026-10-09");
    expect(localDate(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });
});

// Always a throwaway directory: never the real store in Application Support.
describe("backUpDaily", () => {
  let dir;
  let store;
  let backups;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "execute-backups-"));
    store = path.join(dir, "execute-store.json");
    backups = path.join(dir, "backups");
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const now = new Date(2026, 9, 9, 10, 0);

  it("copies the store to today's dated file", () => {
    fs.writeFileSync(store, '{"v":1}');
    const written = backUpDaily(store, backups, now);
    expect(written).toBe(path.join(backups, "execute-store.2026-10-09.json"));
    expect(fs.readFileSync(written, "utf8")).toBe('{"v":1}');
  });

  it("makes one copy a day: a later save the same day leaves the first copy alone", () => {
    fs.writeFileSync(store, '{"v":1}');
    backUpDaily(store, backups, now);
    fs.writeFileSync(store, '{"v":2}');
    expect(backUpDaily(store, backups, new Date(2026, 9, 9, 22, 0))).toBeNull();
    expect(fs.readFileSync(path.join(backups, "execute-store.2026-10-09.json"), "utf8")).toBe('{"v":1}');
  });

  it("does nothing when there is no store file yet", () => {
    expect(backUpDaily(store, backups, now)).toBeNull();
    expect(fs.existsSync(backups)).toBe(false);
  });

  it("prunes old daily copies to 30 and leaves every other file in backups/", () => {
    fs.mkdirSync(backups);
    for (const name of [...FOREIGN, ...dailyNames(KEEP + 5).slice(0, -1)]) {
      fs.writeFileSync(path.join(backups, name), "old");
    }
    fs.writeFileSync(store, '{"v":1}');
    backUpDaily(store, backups, now);

    const left = fs.readdirSync(backups);
    for (const name of FOREIGN) expect(left).toContain(name);
    const daily = left.filter((n) => /^execute-store\.\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
    expect(daily).toEqual(dailyNames(KEEP));
    expect(daily.at(-1)).toBe("execute-store.2026-10-09.json");
  });
});
