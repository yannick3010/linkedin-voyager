#!/usr/bin/env node
// Setup check for the LinkedIn Voyager kit.
// Usage: node scripts/doctor.mjs
// Checks each link in the chain (Chrome -> MCP -> LinkedIn tab -> session) and prints the fix for the first failure.
// Read-only: it never sends anything. It may open one background LinkedIn tab if none is open.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_NAME = "linkedin-chrome";
const SETUP_DOC = "docs/chrome-setup.md";

const ok = (msg) => console.log(`  ✓ ${msg}`);
const warn = (msg) => console.log(`  ! ${msg}`);
function fail(msg, fix) {
  console.log(`  ✗ ${msg}`);
  console.log(`\nFix: ${fix}\n`);
  process.exit(1);
}

// Minimal MCP client over stdio (newline-delimited JSON-RPC).
class Mcp {
  constructor(command, args) {
    this.child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], env: process.env });
    this.buf = "";
    this.stderr = "";
    this.id = 0;
    this.pending = new Map();
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      this.buf += chunk;
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        const p = this.pending.get(msg.id);
        if (!p) continue;
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message || "MCP error")) : p.resolve(msg.result);
      }
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (c) => { this.stderr = (this.stderr + c).slice(-4000); });
    this.child.on("exit", () => {
      for (const p of this.pending.values()) p.reject(new Error("MCP server exited"));
      this.pending.clear();
    });
  }
  request(method, params = {}, timeoutMs = 60_000) {
    const id = ++this.id;
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout waiting for ${method}`)); }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(t); resolve(v); },
        reject: (e) => { clearTimeout(t); reject(e); },
      });
    });
  }
  async start() {
    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "linkedin-voyager-doctor", version: "1.0.0" },
    }, 120_000);
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  }
  async call(name, args, timeoutMs) {
    const r = await this.request("tools/call", { name, arguments: args }, timeoutMs);
    const text = (r?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    if (r?.isError) throw new Error(text || `${name} failed`);
    return text;
  }
  close() { try { this.child.kill(); } catch {} }
}

const linkedInPages = (text) => text.split("\n")
  .map((l) => l.match(/^\s*(\d+):\s+.*?(https:\/\/www\.linkedin\.com\S*)/))
  .filter(Boolean)
  .map((m) => ({ id: Number(m[1]), url: m[2] }));

console.log("\nLinkedIn Voyager kit: setup check\n");

// 1. Node
const major = Number(process.versions.node.split(".")[0]);
if (major < 18) fail(`Node ${process.versions.node} is too old`, "Install Node.js 18 or newer (https://nodejs.org).");
ok(`Node ${process.versions.node}`);

// 2. Repo MCP config
let server;
try {
  server = JSON.parse(fs.readFileSync(path.join(REPO, ".mcp.json"), "utf8")).mcpServers[SERVER_NAME];
} catch {}
if (!server) fail(`.mcp.json has no "${SERVER_NAME}" server`, "Restore .mcp.json from the repo (git checkout .mcp.json).");
const browserUrl = server.args.find((a) => a.startsWith("--browser-url="))?.split("=")[1] || "http://127.0.0.1:9222";
ok(`.mcp.json defines "${SERVER_NAME}" -> ${browserUrl}`);

// 3. Claude Code config conflicts (only if Claude Code is installed)
const claudeJson = path.join(os.homedir(), ".claude.json");
if (fs.existsSync(claudeJson)) {
  try {
    const cfg = JSON.parse(fs.readFileSync(claudeJson, "utf8"));
    const project = cfg.projects?.[REPO] || {};
    if ((project.disabledMcpjsonServers || []).includes(SERVER_NAME)) {
      warn(`Claude Code has "${SERVER_NAME}" disabled for this repo (the approval prompt was declined).`);
      console.log(`    Re-enable it: run /mcp inside Claude Code in this folder, or run \`claude mcp reset-project-choices\` here and approve it next launch.`);
    }
    const overrides = [["local", project.mcpServers?.[SERVER_NAME]], ["user", cfg.mcpServers?.[SERVER_NAME]]]
      .filter(([, s]) => s && JSON.stringify(s.args) !== JSON.stringify(server.args));
    for (const [scope] of overrides) {
      warn(`A ${scope}-scope "${SERVER_NAME}" server exists with different settings${scope === "local" ? " and overrides this repo's config" : ""}.`);
      console.log(`    Remove it: claude mcp remove ${SERVER_NAME} -s ${scope}`);
    }
    if (!overrides.length && !(project.disabledMcpjsonServers || []).includes(SERVER_NAME)) ok("No conflicting Claude Code MCP config");
  } catch {
    warn("Could not read ~/.claude.json; skipping conflict check.");
  }
}

// 4. Chrome remote debugging
try {
  const r = await fetch(`${browserUrl}/json/version`, { signal: AbortSignal.timeout(3000) });
  const v = await r.json();
  ok(`Chrome is listening on ${browserUrl} (${v.Browser})`);
} catch {
  fail(`Nothing is answering on ${browserUrl}`,
    `Start the dedicated Chrome with --remote-debugging-port=${new URL(browserUrl).port} and --user-data-dir. See ${SETUP_DOC}, step 1.`);
}

// 5. npx
const npx = spawnSync(server.command, ["--version"], { encoding: "utf8" });
if (npx.status !== 0) fail(`"${server.command}" is not available`, "Install Node.js (it includes npx) and make sure it is on your PATH.");
ok(`${server.command} ${npx.stdout.trim()}`);

// 6. MCP server connects and reaches Chrome
const mcp = new Mcp(server.command, server.args);
process.on("exit", () => mcp.close());
try {
  await mcp.start();
  ok("chrome-devtools-mcp started");
} catch (e) {
  fail(`chrome-devtools-mcp did not start (${e.message})`,
    `Run \`${server.command} ${server.args.join(" ")}\` by hand to see the error. Last output:\n${mcp.stderr.trim().split("\n").slice(-5).join("\n")}`);
}
let pagesText;
try {
  pagesText = await mcp.call("list_pages", {}, 60_000);
  ok("MCP is attached to Chrome");
} catch (e) {
  fail(`MCP could not attach to Chrome (${e.message})`,
    `If Chrome shows an "Allow remote debugging?" prompt, click Allow. Otherwise quit every window of the dedicated Chrome profile and relaunch it (${SETUP_DOC}).`);
}

// 7. LinkedIn tab
let page = linkedInPages(pagesText)[0];
if (!page) {
  try {
    pagesText = await mcp.call("new_page", { url: "https://www.linkedin.com/feed/", background: true }, 60_000);
    page = linkedInPages(pagesText)[0];
  } catch {}
  if (!page) fail("No LinkedIn tab, and opening one failed", "Open https://www.linkedin.com/ in the dedicated Chrome window and run this again.");
  ok(`Opened a background LinkedIn tab (page ${page.id})`);
} else {
  ok(`Found a LinkedIn tab (page ${page.id})`);
}
if (/\/(login|checkpoint|authwall|uas)/.test(page.url)) {
  fail("The LinkedIn tab is on a login or security page", "Sign in to LinkedIn in the dedicated Chrome window, clear any security check by hand, then run this again.");
}

// 8. Voyager session
const meFn = fs.readFileSync(path.join(REPO, "snippets/me.js"), "utf8").replace(/^\/\/.*\n/gm, "");
let me;
try {
  const text = await mcp.call("evaluate_script", { pageId: page.id, function: meFn, waitForStableDom: false }, 60_000);
  me = JSON.parse(text.match(/```json\n([\s\S]*?)\n```/)?.[1] ?? "null");
} catch (e) {
  fail(`Session check could not run (${e.message})`, "Reload the LinkedIn tab in the dedicated Chrome window and run this again.");
}
if (!me?.ok) {
  fail(`LinkedIn session check failed (${me?.reason || `HTTP ${me?.status}`})`,
    "Sign in to LinkedIn in the dedicated Chrome window. If you are signed in and see HTTP 429, LinkedIn is rate limiting: wait a day.");
}
ok(`Signed in to LinkedIn as ${me.name} (${me.publicIdentifier})`);

console.log(`\nAll good. Open Claude Code in this folder and ask it to check your LinkedIn session.\n`);
process.exit(0);
