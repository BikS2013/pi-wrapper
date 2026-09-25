# Issues - Pending Items

## Pending

1. **No authentication on the HTTP server.** This is acceptable only for a localhost bind. Add a token if remote access is ever needed.
2. **Image attachments are not supported from the text box.** The RPC `prompt` supports `images` (base64), but the UI has no upload control yet.
3. **The tool registry depends on the bridge extension's private channel.** RPC has no tool-list command, so `pi-extension/wrapper-bridge.ts` reports the list through `setStatus` key `pi-wrapper:tools`. Replace it with a native RPC command if pi adds one. If `PI_WRAPPER_PI_ARGS` ever stops pi from loading `-e` extensions, the stripe stays empty until tools execute; chips are still created on first use.

## Completed

- **Answers invisible: every block collapsed to a thin line** (2025-09-25).
  - *Cause:* `#feed` is a `display:flex; flex-direction:column` scroll container, and flex items may shrink by default. The LLM Call and Tool Invocation blocks use `overflow:hidden`, which makes their automatic minimum height 0. Once the conversation grew taller than the window, the browser shrank each block to its 2px border. The earlier verification used a 2600px-tall viewport where everything fit, so it didn't catch this.
  - *Fix:* first `#feed > * { flex-shrink: 0; }`, then made structural: `#feed` is now a plain block-flow container (no flexbox), so entries cannot be compressed. They keep their natural height, and the feed scrolls upwards as new entries arrive. Verified against the live session at 1560×890 and 1560×700: no entry is at or below 4px, the feed scrolls (5,844px of content in a 497px viewport), and there is no horizontal overflow.
  - *Lesson:* verify UI changes with a realistic viewport size and a feed that overflows it.

- **"I don't see any tool stripe" — stale browser tab** (2025-09-25).
  - *Cause:* the tab had been opened with the first version of the page. After the server restart, `EventSource` reconnected automatically without reloading the page. The old JavaScript then rendered the new events: old tool cards and no stripe. Server and disk were current.
  - *Fix:* a hard reload fixes it right away. To prevent it recurring, the server now sends `pageVersion` in every SSE `replay`, and the page reloads itself when the version differs from the one it loaded (`src/server.ts` `pageVersion()`, `public/index.html` `loadedPageVersion`).

- **Two parallel tool-strip implementations (consistency)** (2025-09-25).
  - *Issue:* another session had added a `#toolstrip` that showed only the tools *used so far*. The request is that *every* tool is represented.
  - *Fix:* merged into one implementation. The existing `#toolstrip` / `.tool-chip` markup and the per-tool active counter were kept. Chips are now pre-built from the full registry published by the new bridge extension, inactive tools are dimmed, and the "on" state is a solid fill with a glow. No duplicate code remains.

- **Azure model failed with `400 API version not supported`** (2025-09-25).
  - *Cause:* the shell exports `AZURE_OPENAI_API_VERSION=2025-04-01-preview`. pi's `azure-openai-responses` provider always targets the `/openai/v1` endpoint and forwards that variable as `api-version`. The v1 endpoint rejects dated preview versions; pi's own default is `v1`.
  - *Fix:* added the optional `PI_WRAPPER_PI_ENV` setting (env overrides applied only to the pi child process) and set `PI_WRAPPER_PI_ENV=AZURE_OPENAI_API_VERSION=v1` in `.env` / `.env.example`. The shell env is untouched, so other apps that need the dated version keep working. Verified: `gpt-5.5` answers `PONG`.

## Dependency vetting log

- 2025-09-25: no runtime or dev dependencies (Node built-ins only). Nothing to vet.
