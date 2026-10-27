// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createAgentSocket } = require("./agent.cjs");

let dir;
let socketPath;
let agent;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "execute-agent-"));
  socketPath = path.join(dir, "agent.sock");
});
afterEach(() => {
  agent?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function ask(line) {
  return new Promise((resolve, reject) => {
    const conn = net.connect(socketPath);
    let out = "";
    conn.setEncoding("utf8");
    conn.on("data", (d) => {
      out += d;
      if (out.includes("\n")) {
        conn.end();
        resolve(JSON.parse(out.trim()));
      }
    });
    conn.on("error", reject);
    conn.write(`${line}\n`);
  });
}

describe("agent socket", () => {
  it("answers each request line with the handler's reply, owner-only", async () => {
    agent = createAgentSocket({ socketPath, handle: async (req) => ({ ok: true, echo: req.n }) });
    await agent.ready;
    expect(fs.statSync(socketPath).mode & 0o777).toBe(0o600);
    expect(await ask(JSON.stringify({ n: 3 }))).toEqual({ ok: true, echo: 3 });
  });

  it("turns bad JSON and a throwing handler into an error reply", async () => {
    agent = createAgentSocket({
      socketPath,
      handle: async () => {
        throw new Error("window closed");
      },
    });
    await agent.ready;
    expect((await ask("{not json")).ok).toBe(false);
    expect(await ask("{}")).toEqual({ ok: false, error: "window closed" });
  });

  it("replaces a socket file left behind by a crash", async () => {
    fs.writeFileSync(socketPath, "");
    agent = createAgentSocket({ socketPath, handle: async () => ({ ok: true }) });
    await agent.ready;
    expect(await ask("{}")).toEqual({ ok: true });
  });
});
