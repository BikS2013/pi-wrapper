# pi-wrapper — Functional Requirements Registry

| ID | Feature | Description | Implemented in |
|---|---|---|---|
| F-001 | Node wrapper for pi | Run pi as a managed child process (`--mode rpc`), with restart and graceful shutdown. | `src/pi-process.ts`, `src/server.ts` |
| F-002 | Web page | Serve a single page at `GET /`. | `src/server.ts`, `public/index.html` |
| F-003 | Live notifications | Collect and present every notification of the running pi session, live over SSE, with history replay for new or reconnecting pages. | `src/server.ts` (Hub), `public/index.html` |
| F-004 | Command box | Text box for sending commands to pi: prompts, `/commands`, `!bash`, `!!bash`, and steer/follow-up while pi is busy. Also Abort, New session and Restart pi. | `public/index.html`, `POST /api/command`, `/api/rpc`, `/api/restart` |
| F-005 | Extension dialogs | Answer extension `select` / `confirm` / `input` / `editor` requests in a modal. The first tab to answer wins. | `public/index.html`, `POST /api/ui-response` |
| F-006 | Required configuration | All settings are required (no fallbacks), set by CLI flag, env or `.env`. Optional pi args and pi-only env overrides. | `src/config.ts`, `.env.example` |
| F-007 | Tool Invocation block | For each tool call, a block with Tool Name, Input Data, Result and Execution Time. | `public/index.html` |
| F-008 | LLM Call block | For each LLM request, a block with Message, Response and Execution Time, plus Tokens and Model. | `public/index.html` |
| F-009 | Tools stripe | A stripe above the edit box with one rounded box per pi tool, labelled with the tool name. The box turns on while the tool executes and off when the call completes. | `pi-extension/wrapper-bridge.ts`, `src/server.ts`, `public/index.html` |
