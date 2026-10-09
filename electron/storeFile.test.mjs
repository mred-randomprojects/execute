// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { readStoreFile } = require("./storeFile.cjs");

// Always a throwaway directory: never the real store in Application Support.
let dir;
let file;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "execute-storefile-"));
  file = path.join(dir, "execute-store.json");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const corruptCopies = () => fs.readdirSync(dir).filter((n) => n.startsWith("execute-store.json.corrupt-"));

describe("readStoreFile", () => {
  it("answers null when there is no file yet (first run)", () => {
    expect(readStoreFile(file)).toBeNull();
  });

  it("answers the parsed store", () => {
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 22, tasks: [] }));
    expect(readStoreFile(file)).toEqual({ schemaVersion: 22, tasks: [] });
    expect(corruptCopies()).toEqual([]);
  });

  it("marks a file that isn't valid JSON as corrupt, keeps a copy, and leaves the file as it was", () => {
    fs.writeFileSync(file, '{"tasks": [');
    const result = readStoreFile(file);
    expect(result.corrupt).toBe(true);
    expect(path.dirname(result.backup)).toBe(dir);
    expect(path.basename(result.backup)).toMatch(/^execute-store\.json\.corrupt-\d+$/);
    expect(fs.readFileSync(result.backup, "utf8")).toBe('{"tasks": [');
    expect(fs.readFileSync(file, "utf8")).toBe('{"tasks": [');
  });

  it("keeps one copy of a corrupt file however many times it is read", () => {
    fs.writeFileSync(file, "not json");
    const first = readStoreFile(file);
    const second = readStoreFile(file);
    expect(second.backup).toBe(first.backup);
    expect(corruptCopies()).toHaveLength(1);
  });

  it("throws on any other read error instead of answering 'no file'", () => {
    fs.mkdirSync(file); // a directory where the file should be: EISDIR
    expect(() => readStoreFile(file)).toThrow();
  });
});
