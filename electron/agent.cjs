const fs = require("node:fs");
const net = require("node:net");

// ── The agent socket ──────────────────────────────────────────────────
// A Unix socket in the app-data folder that a local script (Claude, during a
// task review) writes commands to: one JSON request per line, one JSON reply
// per line. Owner-only (0600), so only processes running as this user reach
// it — the same ones that could already edit the store file. What a request
// may do is decided by `handle` (the renderer's allowlist), not here.

function createAgentSocket({ socketPath, handle }) {
  // A socket left behind by a crash would make listen() fail with EADDRINUSE.
  try {
    fs.unlinkSync(socketPath);
  } catch {
    /* none there */
  }
  const server = net.createServer((conn) => {
    let buffer = "";
    conn.setEncoding("utf8");
    conn.on("data", (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim() === "") continue;
        void reply(conn, line);
      }
    });
    conn.on("error", () => {
      /* the client went away; nothing to answer */
    });
  });

  async function reply(conn, line) {
    let response;
    try {
      response = await handle(JSON.parse(line));
    } catch (error) {
      response = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (!conn.destroyed) conn.write(`${JSON.stringify(response)}\n`);
  }

  const ready = new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      fs.chmodSync(socketPath, 0o600);
      resolve();
    });
  });

  return {
    ready,
    close() {
      server.close();
      try {
        fs.unlinkSync(socketPath);
      } catch {
        /* already gone */
      }
    },
  };
}

module.exports = { createAgentSocket };
