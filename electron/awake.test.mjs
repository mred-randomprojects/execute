// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createAwake, RESTART_GRACE_MS } = require("./awake.cjs");

let dir;
let file;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "execute-awake-"));
  file = path.join(dir, "awake.json");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const clock = (t) => () => t.now;

describe("awake: when nobody was there", () => {
  it("names the first sleep or lock after the session began", () => {
    const t = { now: 1000 };
    const awake = createAwake({ file, now: clock(t) });
    awake.off(500); // before the session: irrelevant
    awake.off(5000);
    awake.off(3000);
    expect(awake.firstOffSince(2000)).toBe(3000);
    expect(awake.firstOffSince(6000)).toBeNull();
  });

  it("a launch after a long quit ends the session where the app was last alive", () => {
    const t = { now: 10_000 };
    createAwake({ file, now: clock(t) }).beat(); // alive at 10s, then quit
    t.now = 10_000 + RESTART_GRACE_MS + 1;
    const next = createAwake({ file, now: clock(t) });
    expect(next.firstOffSince(5000)).toBe(10_000);
    // A session that began after the app came back up isn't affected.
    expect(next.firstOffSince(t.now + 1)).toBeNull();
  });

  it("a quick relaunch (an update) still counts as working", () => {
    const t = { now: 10_000 };
    createAwake({ file, now: clock(t) }).beat();
    t.now = 10_000 + 30_000;
    expect(createAwake({ file, now: clock(t) }).firstOffSince(5000)).toBeNull();
  });

  it("with no record of the last run, it doesn't guess", () => {
    fs.writeFileSync(file, "not json");
    const awake = createAwake({ file, now: () => 99_999_999 });
    expect(awake.firstOffSince(1)).toBeNull();
    expect(awake.firstOffSince(Number.NaN)).toBeNull();
  });
});
