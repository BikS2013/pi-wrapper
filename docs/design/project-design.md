# pi-wrapper — Project Design

## Architecture

```
Browser (public/index.html)
   │  GET /events (SSE)          ▲ records {seq, ts, record}
   │  POST /api/command|rpc|ui-response|restart
   ▼
Node HTTP server (src/server.ts)
   ├─ Hub: event history ring buffer (PI_WRAPPER_HISTORY_LIMIT) + in-flight deltas,
   │       SSE fan-out, isStreaming tracking, pending extension dialogs
   └─ PiProcess (src/pi-process.ts)
         spawn `<PI_WRAPPER_PI_BIN> --mode rpc <PI_WRAPPER_PI_ARGS>` in PI_WRAPPER_CWD
         stdin: JSONL commands (uuid id)   stdout: JSONL responses/events/extension_ui_request
```

## Key decisions

- **Uses RPC mode instead of the in-process SDK.** This isolates the process, so pi can be restarted from the UI, and the wrapper works with whatever `pi` is installed.
- **Strict LF framing** is done with `StringDecoder`, not `readline`, because `readline` also splits on U+2028/U+2029 (pi docs requirement).
- **Uses SSE instead of WebSocket.** Events only flow server→client, and commands are plain POSTs. This needs no dependencies.
- **Replay:** new or reconnecting pages receive the history. High-volume delta records (`message_update`, `tool_execution_update`, `bash_execution_update`) are kept only while their message is in flight. The authoritative `message_end` / `tool_execution_end` records are kept.
- **Busy handling:** the server tracks `agent_start` → `agent_settled`. While pi is busy, a prompt must carry `steer` or `followUp`. The UI sends the value of its selector.
- **Extension dialogs:** they are broadcast to all tabs. The first answer wins (other tabs close the dialog when they get `ui_resolved`), and late answers get HTTP 409.
- **Configuration:** every setting is required, with no fallbacks (see README).

## UI blocks (public/index.html)

- **Tool strip.** A compact stripe above the command input lists every unique agent tool observed in `tool_execution_start` / `tool_execution_end` events. A tool chip is highlighted while one or more invocations of that tool are currently running, and remains in the strip after completion.
- **Tool Invocation.** Opened by `tool_execution_start` (with `toolName` and `args`), filled live by `tool_execution_update`, and closed by `tool_execution_end` (with `result` and `isError`). Execution Time = end ts − start ts.
- **LLM Call.** One block per assistant message. *Message* holds the inputs added to the context since the previous call: `message_end` records of role `user`, `toolResult`, `custom` or `bashExecution`. So the first call of a run shows the user prompt, and follow-up calls show the tool results. *Response* streams from `message_update` deltas and is replaced by the authoritative `message_end` content. The start time is the later of `turn_start` and the last input `message_end`, so Execution Time includes time-to-first-token. It ends at the assistant `message_end`.
- **Timestamps.** All times use the server's receive timestamps (`envelope.ts`), so replayed history shows the same durations.
- **Unfinished blocks.** If pi settles or exits while a block is still open, the block is marked "interrupted".

## Security

The server has no authentication, and anyone who can reach the port can drive pi, including running shell commands. Bind to `127.0.0.1`.
