// pi-wrapper: HTTP server that runs pi in RPC mode, streams every notification
// to a web page (Server-Sent Events) and accepts commands from that page.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig, ConfigError, type WrapperConfig } from "./config.ts";
import { PiProcess, type PiRecord } from "./pi-process.ts";

interface Envelope {
  seq: number;
  ts: number;
  record: PiRecord;
}

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = join(ROOT_DIR, "public");
// Bundled pi extension that publishes the tool registry (see pi-extension/wrapper-bridge.ts).
const BRIDGE_EXTENSION = join(ROOT_DIR, "pi-extension", "wrapper-bridge.ts");
const TOOLS_STATUS_KEY = "pi-wrapper:tools"; // must match wrapper-bridge.ts
const MAX_BODY_BYTES = 1024 * 1024;
const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);
// Per-command response timeouts (ms). Long-running commands get generous limits.
const LONG_COMMANDS = new Set(["bash", "compact", "abort", "export_html", "new_session", "switch_session", "fork", "clone"]);

function commandTimeout(type: string): number {
  return LONG_COMMANDS.has(type) ? 30 * 60_000 : 60_000;
}

class Hub {
  private seq = 0;
  private history: Envelope[] = [];
  private inflight: Envelope[] = []; // message_update deltas of the message currently streaming
  private clients = new Set<ServerResponse>();
  readonly pendingDialogs = new Map<string, Envelope>();
  isStreaming = false;
  /** Latest tool registry snapshot published by the bridge extension. */
  tools: { tools: unknown[]; active: string[] } | null = null;
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  publish(record: PiRecord): void {
    const env: Envelope = { seq: ++this.seq, ts: Date.now(), record };
    this.track(env);
    const payload = `id: ${env.seq}\ndata: ${JSON.stringify(env)}\n\n`;
    for (const c of this.clients) c.write(payload);
  }

  private track(env: Envelope): void {
    const r = env.record;
    switch (r.type) {
      case "agent_start": this.isStreaming = true; break;
      case "agent_settled": this.isStreaming = false; break;
      case "wrapper": if (r.event === "exited") { this.isStreaming = false; this.pendingDialogs.clear(); } break;
    }
    if (r.type === "extension_ui_request" && typeof r.id === "string" && DIALOG_METHODS.has(String(r.method))) {
      this.pendingDialogs.set(r.id, env);
    }
    // High-volume streaming records are kept only while their message is in flight;
    // the authoritative message_end / tool_execution_end is kept in history.
    if (r.type === "message_update" || r.type === "tool_execution_update" || r.type === "bash_execution_update") {
      this.inflight.push(env);
      return;
    }
    if (r.type === "message_end" || r.type === "agent_settled") this.inflight = [];
    this.history.push(env);
    if (this.history.length > this.limit) this.history.splice(0, this.history.length - this.limit);
  }

  attach(res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const replay = [...this.history, ...this.inflight].sort((a, b) => a.seq - b.seq);
    res.write(`event: replay\ndata: ${JSON.stringify({ events: replay, isStreaming: this.isStreaming, tools: this.tools })}\n\n`);
    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
  }

  heartbeat(): void {
    for (const c of this.clients) c.write(`: ping\n\n`);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Body must be a JSON object");
  return parsed as Record<string, unknown>;
}

/** Translate the text box content into an RPC command. */
function buildCommand(text: string, behavior: unknown, isStreaming: boolean): Record<string, unknown> {
  if (text.startsWith("!!")) return { type: "bash", command: text.slice(2).trim(), excludeFromContext: true };
  if (text.startsWith("!")) return { type: "bash", command: text.slice(1).trim() };
  const cmd: Record<string, unknown> = { type: "prompt", message: text };
  if (isStreaming) {
    if (behavior !== "steer" && behavior !== "followUp") {
      throw new Error('pi is busy: choose "steer" or "followUp" delivery for this message');
    }
    cmd.streamingBehavior = behavior;
  }
  return cmd;
}

async function main(): Promise<void> {
  let config: WrapperConfig;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`Configuration error: ${e.message}`);
      process.exit(2);
    }
    throw e;
  }

  if (!existsSync(BRIDGE_EXTENSION)) {
    console.error(`Bridge extension missing: ${BRIDGE_EXTENSION}`);
    process.exit(2);
  }
  const hub = new Hub(config.historyLimit);
  const piArgs = ["-e", BRIDGE_EXTENSION, ...config.piArgs];
  const pi = new PiProcess(config.piBin, piArgs, config.piCwd, config.piEnv);
  const wrapperEvent = (event: string, extra: Record<string, unknown> = {}) =>
    hub.publish({ type: "wrapper", event, ...extra });

  pi.on("record", (r: PiRecord) => {
    // Intercept the bridge extension's tool-registry channel; never forward it as a status entry.
    if (r.type === "extension_ui_request" && r.method === "setStatus" && r.statusKey === TOOLS_STATUS_KEY) {
      try {
        const payload = JSON.parse(String(r.statusText));
        hub.tools = { tools: payload.tools ?? [], active: payload.active ?? [] };
        wrapperEvent("tools", hub.tools);
      } catch (e) {
        wrapperEvent("stderr", { text: `Invalid tool registry payload from bridge extension: ${(e as Error).message}\n` });
      }
      return;
    }
    hub.publish(r);
  });
  pi.on("stderr", (text: string) => wrapperEvent("stderr", { text }));
  pi.on("start", ({ pid }) => wrapperEvent("started", { pid, cwd: config.piCwd, args: ["--mode", "rpc", ...piArgs], envOverrides: Object.keys(config.piEnv) }));
  pi.on("exit", ({ code, signal }) => wrapperEvent("exited", { code, signal }));

  const startPi = () => {
    pi.start();
    // Announce initial state to the page.
    pi.send({ type: "get_state" }, 60_000).catch((e) => wrapperEvent("stderr", { text: `get_state failed: ${e.message}\n` }));
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    try {
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        const html = await readFile(join(PUBLIC_DIR, "index.html"));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      if (req.method === "GET" && url.pathname === "/events") {
        hub.attach(res); // replay includes unanswered extension dialogs
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/status") {
        sendJson(res, 200, { running: pi.running, isStreaming: hub.isStreaming, pendingDialogs: [...hub.pendingDialogs.keys()] });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/command") {
        const body = await readJson(req);
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) return sendJson(res, 400, { error: "text is required" });
        const cmd = buildCommand(text, body.behavior, hub.isStreaming);
        wrapperEvent("user_command", { text, command: cmd.type, behavior: cmd.streamingBehavior });
        const response = await pi.send(cmd, commandTimeout(String(cmd.type)));
        return sendJson(res, response.success ? 200 : 422, response);
      }
      if (req.method === "POST" && url.pathname === "/api/rpc") {
        const body = await readJson(req);
        if (typeof body.type !== "string") return sendJson(res, 400, { error: "type is required" });
        const response = await pi.send(body, commandTimeout(body.type));
        return sendJson(res, response.success ? 200 : 422, response);
      }
      if (req.method === "POST" && url.pathname === "/api/ui-response") {
        const body = await readJson(req);
        if (typeof body.id !== "string") return sendJson(res, 400, { error: "id is required" });
        if (!hub.pendingDialogs.has(body.id)) return sendJson(res, 409, { error: "dialog is no longer pending" });
        hub.pendingDialogs.delete(body.id);
        pi.sendRaw({ ...body, type: "extension_ui_response" });
        wrapperEvent("ui_resolved", { id: body.id });
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/restart") {
        if (pi.running) {
          await new Promise<void>((resolve) => {
            pi.once("exit", () => resolve());
            pi.stop();
          });
        }
        startPi();
        return sendJson(res, 200, { ok: true });
      }
      sendJson(res, 404, { error: "not found" });
    } catch (e) {
      sendJson(res, 400, { error: (e as Error).message });
    }
  });

  setInterval(() => hub.heartbeat(), 15_000).unref();
  startPi();
  server.listen(config.port, config.host, () => {
    console.log(`pi-wrapper listening on http://${config.host}:${config.port} (pi cwd: ${config.piCwd})`);
  });

  const shutdown = () => {
    pi.stop();
    server.close();
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
