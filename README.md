# pi-wrapper

A Node.js server that runs the [pi](https://github.com/earendil-works/pi) coding agent as a child process in **RPC mode** and serves a web page that:

- streams **every notification** from the running pi session live: assistant text and thinking, tool calls and results, extension `notify` messages, status/widget updates, retries, compaction, queue changes, errors, and pi's stderr
- shows an **LLM Call** block for every model request, with these fields:
  - **Message:** the new input for that call (your prompt, or the tool results fed back)
  - **Response:** text, thinking and tool calls
  - **Execution Time**, **Tokens** and **Model**
- shows a **Tool Invocation** block for every tool call: **Tool Name**, **Input Data**, **Result** and **Execution Time** (a live timer while the tool runs)
- shows a **tools stripe** just above the text box. It has one small rounded box per tool pi has, labelled with the tool name. The box **turns on** (solid purple with a glow) while the tool is executing and **turns off** when the call completes.
- provides a **text box** for sending commands to pi
- answers extension dialogs (`select` / `confirm` / `input` / `editor`) in a modal

It has no runtime dependencies. Node ≥ 22.18 runs the TypeScript sources directly.

## Run

```bash
cp .env.example .env      # then edit PI_WRAPPER_CWD etc.
npm start                 # → http://127.0.0.1:4321
```

Restart the server after changing `.env`, `src/` or `pi-extension/`. Changes to `public/index.html` only need a browser refresh, because the page is read from disk on every request. An open tab reconnects by itself after a server restart. If the page on disk changed since the tab loaded it, the tab reloads itself so it never runs stale UI code (this works from the first reload after this feature was added).

## Configuration (all required unless noted — no defaults)

| Env var | CLI flag | Purpose |
|---|---|---|
| `PI_WRAPPER_PORT` | `--port=` | HTTP port |
| `PI_WRAPPER_HOST` | `--host=` | Bind address (`127.0.0.1` recommended; there is **no authentication**) |
| `PI_WRAPPER_CWD` | `--cwd=` | Working directory the pi agent operates in |
| `PI_WRAPPER_PI_BIN` | `--pi-bin=` | pi executable |
| `PI_WRAPPER_HISTORY_LIMIT` | `--history-limit=` | Events kept in memory for replay to newly opened pages |
| `PI_WRAPPER_PI_ENV` (optional) | `--pi-env=` | Env overrides for the pi child only, `KEY=VALUE,KEY2=VALUE` (e.g. `AZURE_OPENAI_API_VERSION=v1`, see below) |
| `PI_WRAPPER_PI_ARGS` (optional) | `--pi-args=` | Extra pi CLI args, e.g. `--provider anthropic --model claude-haiku-4-5` (`--mode` is forbidden) |

Priority: CLI flag > shell env > `.env`. If a required setting is missing, the server exits with code 2.

> **Azure OpenAI note:** pi's `azure-openai-responses` provider calls the `/openai/v1` endpoint, which only accepts api-version `v1`/`preview`. If your shell exports a dated `AZURE_OPENAI_API_VERSION` (e.g. `2025-04-01-preview`), every call fails with `400 API version not supported`. The shipped `.env` sets `PI_WRAPPER_PI_ENV=AZURE_OPENAI_API_VERSION=v1`, which applies to the pi child only.

The wrapper always starts pi as `pi --mode rpc -e pi-extension/wrapper-bridge.ts <PI_WRAPPER_PI_ARGS>`. The bridge extension is part of the wrapper, not a setting; it reports pi's tool list (see below).

## The page

| Area | What it shows |
|---|---|
| Header | Connection, pi process, idle/working, model · toggles **thinking**, **lifecycle** (turn/agent events, stderr, raw records) and **autoscroll** · buttons **Abort**, **New session**, **Restart pi**, **Clear view** |
| Status bar / widgets | Extension `setStatus` / `setWidget` output |
| Feed | Your messages, **LLM Call** blocks (blue edge), **Tool Invocation** blocks (purple edge), notifications (also shown as toasts), errors, and system lines such as *agent settled*, retries and compaction |
| **Tools stripe** | Every tool pi has, as small rounded boxes. Lit = currently executing (it stays lit until every parallel call of that tool has finished). Dashed/dimmed = registered but not active for the model. Hover to see the tool description and source. |
| Text box | Commands for pi (syntax below) + the steer / follow-up selector |

### Text box syntax

| Input | Sent to pi as |
|---|---|
| `some text` | `prompt` (when pi is busy, it is queued as **steer** or **follow-up**, depending on the selector) |
| `/name args` | `prompt` → extension command, skill (`/skill:x`) or prompt template |
| `!cmd` | `bash` (output goes into the context for the next prompt) |
| `!!cmd` | `bash` with `excludeFromContext: true` |

Enter sends the message. Shift+Enter inserts a newline.

## HTTP API

| Method & path | Body | Description |
|---|---|---|
| `GET /` | – | Web page |
| `GET /events` | – | SSE stream. The first `replay` event holds `{events, isStreaming, tools, pageVersion}`; each later message is `{seq, ts, record}` |
| `GET /api/status` | – | `{running, isStreaming, pendingDialogs}` |
| `POST /api/command` | `{text, behavior?: "steer"\|"followUp"}` | Text-box command (see syntax above) |
| `POST /api/rpc` | any pi RPC command, e.g. `{"type":"set_model",...}` | Raw pass-through; returns pi's `response` |
| `POST /api/ui-response` | `{id, value?\|confirmed?\|cancelled?}` | Answer an extension dialog |
| `POST /api/restart` | – | Restart the pi process |

Records with `record.type === "wrapper"` come from the wrapper itself:

| `event` | Fields |
|---|---|
| `started` | `pid`, `cwd`, `args`, `envOverrides` (names only) |
| `exited` | `code`, `signal` |
| `stderr` | `text` |
| `user_command` | `text`, `command`, `behavior` |
| `ui_resolved` | `id` |
| `tools` | `tools: [{name, description, source}]`, `active: string[]` |

Every other record is passed through from pi unchanged, except the bridge extension's private `setStatus` channel (key `pi-wrapper:tools`). The server consumes that channel and republishes it as the `tools` event.

## Test

```bash
npm test                                   # no LLM tokens used
SMOKE_PROMPT=1 npm test                    # + one real prompt round-trip
SMOKE_PROMPT=1 SMOKE_PI_ARGS="--no-session --provider anthropic --model claude-haiku-4-5" npm test
```

`test_scripts/smoke-test.ts` checks:
- config rejection
- page serving
- SSE replay
- that the tool registry arrives and the private channel doesn't leak
- RPC pass-through
- the `!!bash` path
- empty-command rejection
- optionally, a prompt round-trip
