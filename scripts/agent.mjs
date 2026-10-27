#!/usr/bin/env node
// Send commands to the running desktop app through its agent socket
// (electron/agent.cjs → src/store/agent.ts) and print the reply.
//
//   node scripts/agent.mjs '[{"type":"setText","id":"…","text":"…"}]'
//   echo '[…]' | node scripts/agent.mjs
import net from "node:net";
import os from "node:os";
import path from "node:path";

const SOCKET = path.join(os.homedir(), "Library", "Application Support", "execute", "agent.sock");

async function readInput() {
  if (process.argv[2] != null) return process.argv[2];
  let s = "";
  for await (const chunk of process.stdin) s += chunk;
  return s;
}

const commands = JSON.parse(await readInput());
const conn = net.connect(SOCKET);
let out = "";
conn.setEncoding("utf8");
conn.on("error", (e) => {
  console.error(`Can't reach Execute (${e.code}): is the app running?`);
  process.exit(2);
});
conn.on("data", (d) => {
  out += d;
  if (!out.includes("\n")) return;
  conn.end();
  const reply = JSON.parse(out.trim());
  console.log(JSON.stringify(reply, null, 2));
  process.exit(reply.ok ? 0 : 1);
});
conn.write(`${JSON.stringify({ commands: Array.isArray(commands) ? commands : [commands] })}\n`);
