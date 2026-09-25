# pi-wrapper

A Node.js server that runs the [pi](https://github.com/earendil-works/pi) coding agent as a child process in **RPC mode** and serves a web page that:

- streams **every notification** from the running pi session live: assistant text and thinking, tool calls and results, extension `notify` messages, status/widget updates, retries, compaction, queue changes, errors, and pi's stderr
- provides a **text box** for sending commands to pi
- shows a **Tool Invocation** block for every tool call: Tool Name, Input Data, Result, Execution Time (live timer while running)
- shows an **LLM Call** block for every model request: Message (the new input for that call: your prompt, or the tool results fed back), Response (text, thinking, tool calls), Execution Time, Tokens, Model
- answers extension dialogs (`select` / `confirm` / `input` / `editor`) in a modal

It has no runtime dependencies. Node ≥ 22.18 runs the TypeScript sources directly.

## Run

```bash
cp .env.example .env      # then edit PI_WRAPPER_CWD etc.
npm start                 # → http://127.0.0.1:4321
```

## Configuration (all required unless noted — no defaults)

| Env var | CLI flag | Purpose |
|---|---|---|
| `PI_WRAPPER_PORT` | `--port=` | HTTP port |
| `PI_WRAPPER_HOST` | `--host=` | Bind address (`127.0.0.1` recommended; there is **no authentication**) |
| `PI_WRAPPER_CWD` | `--cwd=` | Working directory the pi agent operates in |
| `PI_WRAPPER_PI_BIN` | `--pi-bin=` | pi executable |
| `PI_WRAPPER_HISTORY_LIMIT` | `--history-limit=` | Events kept in memory for replay to newly opened pages |
| `PI_WRAPPER_PI_ENV` (optional) | `--pi-env=` | Env overrides for the pi child only, `KEY=VALUE,KEY2=VALUE` (e.g. `AZURE_OPENAI_API_VERSION=v1`) |
| `PI_WRAPPER_PI_ARGS` (optional) | `--pi-args=` | Extra pi CLI args, e.g. `--provider anthropic --model claude-haiku-4-5` (`--mode` is forbidden) |

Priority: CLI flag > shell env > `.env`. If a required setting is missing, the server exits with code 2.

## Text box syntax

| Input | Sent to pi as |
|---|---|
| `some text` | `prompt` (when pi is busy, it is queued as **steer** or **follow-up**, depending on the selector) |
| `/name args` | `prompt` → extension command, skill (`/skill:x`) or prompt template |
| `!cmd` | `bash` (output goes into the context for the next prompt) |
| `!!cmd` | `bash` with `excludeFromContext: true` |

Enter sends the message. Shift+Enter inserts a newline. Header buttons: **Abort**, **New session**, **Restart pi**, **Clear view**. The **thinking** and **lifecycle** toggles show or hide detail.

## HTTP API

| Method & path | Body | Description |
|---|---|---|
| `GET /` | – | Web page |
| `GET /events` | – | SSE stream. The first `replay` event holds history; each later message is `{seq, ts, record}` |
| `GET /api/status` | – | `{running, isStreaming, pendingDialogs}` |
| `POST /api/command` | `{text, behavior?: "steer"\|"followUp"}` | Text-box command (see syntax above) |
| `POST /api/rpc` | any pi RPC command, e.g. `{"type":"set_model",...}` | Raw pass-through; returns pi's `response` |
| `POST /api/ui-response` | `{id, value?\|confirmed?\|cancelled?}` | Answer an extension dialog |
| `POST /api/restart` | – | Restart the pi process |

Records whose `record.type === "wrapper"` come from the wrapper itself (`started`, `exited`, `stderr`, `user_command`, `ui_resolved`). Every other record is passed through from pi unchanged.

## Test

```bash
npm test                                   # no LLM tokens used
SMOKE_PROMPT=1 SMOKE_PI_ARGS="--no-session --provider anthropic --model claude-haiku-4-5" npm test
```
