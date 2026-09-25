// Configuration loading. No fallbacks: every required setting must be provided
// explicitly (env var, .env file loaded by `node --env-file`, or CLI flag).
// CLI flags (--port=, --host=, --cwd=, --pi-bin=, --pi-args=) override env vars.

export interface WrapperConfig {
  port: number;
  host: string;
  piCwd: string;
  piBin: string;
  piArgs: string[];
  piEnv: Record<string, string>;
  historyLimit: number;
}

export class ConfigError extends Error {}

function cliFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const m = /^--([a-z-]+)=(.*)$/s.exec(arg);
    if (m) flags.set(m[1], m[2]);
  }
  return flags;
}

function required(flags: Map<string, string>, flag: string, env: string): string {
  const value = flags.get(flag) ?? process.env[env];
  if (value === undefined || value.trim() === "") {
    throw new ConfigError(`Missing required configuration: set ${env} (env/.env) or pass --${flag}=<value>`);
  }
  return value.trim();
}

function positiveInt(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new ConfigError(`${name} must be a positive integer, got "${value}"`);
  return n;
}

export function loadConfig(argv: string[] = process.argv.slice(2)): WrapperConfig {
  const flags = cliFlags(argv);
  const port = positiveInt(required(flags, "port", "PI_WRAPPER_PORT"), "PI_WRAPPER_PORT");
  const host = required(flags, "host", "PI_WRAPPER_HOST");
  const piCwd = required(flags, "cwd", "PI_WRAPPER_CWD");
  const piBin = required(flags, "pi-bin", "PI_WRAPPER_PI_BIN");
  const historyLimit = positiveInt(required(flags, "history-limit", "PI_WRAPPER_HISTORY_LIMIT"), "PI_WRAPPER_HISTORY_LIMIT");
  // Optional: extra arguments passed verbatim to pi (whitespace separated). Absent = none.
  const rawArgs = flags.get("pi-args") ?? process.env.PI_WRAPPER_PI_ARGS ?? "";
  const piArgs = rawArgs.split(/\s+/).filter(Boolean);
  if (piArgs.includes("--mode")) throw new ConfigError("PI_WRAPPER_PI_ARGS must not contain --mode (the wrapper forces --mode rpc)");
  // Optional: environment overrides applied ONLY to the pi child process,
  // comma separated KEY=VALUE pairs (e.g. AZURE_OPENAI_API_VERSION=v1). Absent = none.
  const rawEnv = flags.get("pi-env") ?? process.env.PI_WRAPPER_PI_ENV ?? "";
  const piEnv: Record<string, string> = {};
  for (const pair of rawEnv.split(",").map((s) => s.trim()).filter(Boolean)) {
    const eq = pair.indexOf("=");
    if (eq <= 0) throw new ConfigError(`PI_WRAPPER_PI_ENV entry "${pair}" must be KEY=VALUE`);
    piEnv[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return { port, host, piCwd, piBin, piArgs, piEnv, historyLimit };
}
