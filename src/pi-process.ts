// Manages the pi child process running in RPC mode (strict JSONL over stdio).
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";
import { randomUUID } from "node:crypto";

export type PiRecord = Record<string, unknown> & { type: string };

interface Pending {
  resolve: (r: PiRecord) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Events emitted:
 *  - "record" (PiRecord)            every JSON record pi writes on stdout
 *  - "stderr" (string)              diagnostic text from pi's stderr
 *  - "exit"   ({code, signal})      the child exited
 *  - "start"  ({pid})               the child started
 */
export class PiProcess extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, Pending>();
  private readonly bin: string;
  private readonly args: string[];
  private readonly cwd: string;
  private readonly envOverrides: Record<string, string>;

  constructor(bin: string, args: string[], cwd: string, envOverrides: Record<string, string>) {
    super();
    this.envOverrides = envOverrides;
    this.bin = bin;
    this.args = args;
    this.cwd = cwd;
  }

  get running(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  start(): void {
    if (this.running) throw new Error("pi is already running");
    const child = spawn(this.bin, ["--mode", "rpc", ...this.args], { cwd: this.cwd, env: { ...process.env, ...this.envOverrides }, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;

    // Strict LF framing (do NOT use readline: it splits on U+2028/U+2029).
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.trim()) this.handleLine(line);
      }
    });

    const errDecoder = new StringDecoder("utf8");
    child.stderr.on("data", (chunk: Buffer) => this.emit("stderr", errDecoder.write(chunk)));

    child.on("error", (err) => {
      this.emit("stderr", `Failed to start pi: ${err.message}\n`);
    });
    child.on("exit", (code, signal) => {
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error("pi process exited"));
      }
      this.pending.clear();
      this.child = null;
      this.emit("exit", { code, signal });
    });
    if (child.pid) this.emit("start", { pid: child.pid });
  }

  private handleLine(line: string): void {
    let record: PiRecord;
    try {
      record = JSON.parse(line);
    } catch {
      this.emit("stderr", `[unparseable stdout] ${line}\n`);
      return;
    }
    if (record.type === "response" && typeof record.id === "string") {
      const p = this.pending.get(record.id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(record.id);
        p.resolve(record);
      }
    }
    this.emit("record", record);
  }

  private write(obj: unknown): void {
    if (!this.child || !this.running) throw new Error("pi is not running");
    this.child.stdin.write(JSON.stringify(obj) + "\n");
  }

  /** Send an RPC command and wait for its correlated response. */
  send(command: Record<string, unknown>, timeoutMs: number): Promise<PiRecord> {
    const id = typeof command.id === "string" ? command.id : randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for response to "${String(command.type)}"`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ ...command, id });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e as Error);
      }
    });
  }

  /** Fire-and-forget record (used for extension_ui_response). */
  sendRaw(record: Record<string, unknown>): void {
    this.write(record);
  }

  stop(): void {
    if (this.child && this.running) this.child.stdin.end();
  }
}
