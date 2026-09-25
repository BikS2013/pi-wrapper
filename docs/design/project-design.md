# pi-wrapper — Project Design

## Architecture

```
Browser (public/index.html)
   │  GET /events (SSE)          ▲ replay {events, isStreaming, tools} + records {seq, ts, record}
   │  POST /api/command|rpc|ui-response|restart
   ▼
Node HTTP server (src/server.ts)
   ├─ Hub: event history ring buffer (PI_WRAPPER_HISTORY_LIMIT) + in-flight deltas,
   │       SSE fan-out, isStreaming tracking, pending extension dialogs,
   │       latest tool-registry snapshot
   ├─ tool-registry interceptor: extension_ui_request setStatus key "pi-wrapper:tools"
   │       → wrapper event {event:"tools", tools, active} (never forwarded raw)
   └─ PiProcess (src/pi-process.ts)
         spawn `<PI_WRAPPER_PI_BIN> --mode rpc -e pi-extension/wrapper-bridge.ts <PI_WRAPPER_PI_ARGS>`
         in PI_WRAPPER_CWD, env = process.env + PI_WRAPPER_PI_ENV overrides
         stdin: JSONL commands (uuid id)   stdout: JSONL responses/events/extension_ui_request
                                              ▲
         pi-extension/wrapper-bridge.ts (runs inside pi): publishes pi.getAllTools() /
         pi.getActiveTools() on session_start, before_agent_start and /wrapper-tools
```

## Modules

| File | Responsibility |
|---|---|
| `src/config.ts` | Loads required settings (CLI flag > env > `.env`), with no fallbacks. `ConfigError` → exit code 2. Parses the optional `PI_WRAPPER_PI_ARGS` (whitespace separated; `--mode` is forbidden) and `PI_WRAPPER_PI_ENV` (`KEY=VALUE,...`). |
| `src/pi-process.ts` | Child-process lifecycle and strict LF JSONL framing. `send()` correlates a command with its response by `id` and has a timeout; `sendRaw()` sends fire-and-forget records. Emits `record`, `stderr`, `start`, `exit`. |
| `src/server.ts` | HTTP routes, the Hub (history/replay/SSE), busy tracking, dialog tracking, the tool-registry interceptor, and translation of text-box input into RPC commands. |
| `pi-extension/wrapper-bridge.ts` | pi extension loaded with `-e`. It publishes the tool registry, because RPC has no command that lists tools. |
| `public/index.html` | Single-page UI: plain JS, no build step. |

## Key decisions

- **Uses RPC mode instead of the in-process SDK.** This isolates the process, so pi can be restarted from the UI, and the wrapper works with whatever `pi` is installed.
- **Strict LF framing** is done with `StringDecoder`, not `readline`, because `readline` also splits on U+2028/U+2029 (pi docs requirement).
- **Uses SSE instead of WebSocket.** Events only flow server→client, and commands are plain POSTs. This needs no dependencies.
- **Replay:** new or reconnecting pages receive the history. High-volume delta records (`message_update`, `tool_execution_update`, `bash_execution_update`) are kept only while their message is in flight. The authoritative `message_end` / `tool_execution_end` records are kept. The latest tool registry is kept separately, so history truncation cannot drop it.
- **Stale-tab protection:** each `replay` carries `pageVersion` (the mtime and size of `public/index.html`). A tab remembers the version it was loaded with. If a later replay, after an SSE auto-reconnect, reports a different version, the tab reloads. Otherwise a long-lived tab would keep rendering new events with old UI code.
- **Busy handling:** the server tracks `agent_start` → `agent_settled`. While pi is busy, a prompt must carry `steer` or `followUp`. The UI sends the value of its selector.
- **Extension dialogs:** they are broadcast to all tabs. The first answer wins (other tabs close the dialog when they get `ui_resolved`), and late answers get HTTP 409.
- **Configuration:** every setting is required, with no fallbacks. `PI_WRAPPER_PI_ENV` exists so provider env vars can be corrected for pi only, without touching the user's shell (see the Azure issue in `Issues - Pending Items.md`).
- **Tool registry via a bridge extension.** RPC exposes tool *executions* but not the tool *list*. The bridge extension reports the list over the extension-UI `setStatus` sub-protocol, using a reserved key that holds a JSON payload. This needs no changes to pi. The server hides the channel from clients and republishes it as a first-class `tools` event. The registry is re-published before every agent run, because extensions can change the active tool set.

## UI (public/index.html)

- **Tools stripe.** It sits between the feed and the command box. There is one rounded chip (`.tool-chip`) per tool in the registry, in registry order, labelled with the tool name.
  - **On/off:** the chip turns on (`.active`: solid purple with a glow) at `tool_execution_start` and off at `tool_execution_end`. A per-tool counter handles parallel calls; `×n` is not shown, and the chip stays lit until every running call has ended.
  - **Inactive tools:** tools registered but not active for the model are dashed and dimmed (`.inactive`). The tooltip shows the name, active state, source and description.
  - **Unlisted tools:** a tool executed but missing from the registry still gets a chip.
  - **Reset:** every chip turns off when pi settles or exits (`interruptOpenBlocks`) and when the page replays.
- **Tool Invocation block.** It opens on `tool_execution_start` (`toolName`, `args`), is filled live by `tool_execution_update`, and closes on `tool_execution_end` (`result`, `isError`). Fields are Tool Name, Input Data, Result and Execution Time, where Execution Time = end ts − start ts. The badge shows running, success or error.
- **LLM Call block.** There is one block per assistant message.
  - **Message:** the inputs added to the context since the previous call, taken from `message_end` records of role `user`, `toolResult`, `custom` or `bashExecution`. The first call of a run therefore shows the user prompt, and follow-up calls show the tool results.
  - **Response:** streams from `message_update` deltas and is replaced by the authoritative `message_end` content (text, thinking, tool calls with arguments, or the error).
  - **Execution Time:** starts at the later of `turn_start` and the last input `message_end`, so it includes time-to-first-token. It ends at the assistant `message_end`.
  - **Extra fields:** Tokens (in, cache read, out, cost) and Model.
- **Feed layout.** `#feed` is a plain block-flow scroll container, deliberately not flexbox. Entries always keep their natural height, new entries append at the bottom, and older ones scroll upwards. Autoscroll keeps the view pinned to the bottom while you are at the bottom. User bubbles are right-aligned with `margin-left:auto`.
- **Timestamps.** All times use the server's receive timestamps (`envelope.ts`), so replayed history shows the same durations.
- **Unfinished blocks.** If pi settles or exits while a block is still open, the block is marked "interrupted".

## Security

The server has no authentication, and anyone who can reach the port can drive pi, including running shell commands. Bind to `127.0.0.1`.
