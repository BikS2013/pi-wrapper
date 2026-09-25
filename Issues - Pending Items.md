# Issues - Pending Items

## Pending

1. **No authentication on the HTTP server.** This is acceptable only for a localhost bind. Add a token if remote access is ever needed.
2. **Image attachments are not supported from the text box.** The RPC `prompt` supports `images` (base64), but the UI has no upload control yet.
3. **The tool registry depends on the bridge extension's private channel.** RPC has no tool-list command, so `pi-extension/wrapper-bridge.ts` reports the list through `setStatus` key `pi-wrapper:tools`. Replace it with a native RPC command if pi adds one. If `PI_WRAPPER_PI_ARGS` ever stops pi from loading `-e` extensions, the stripe stays empty until tools execute; chips are still created on first use.

## Completed

- **Two parallel tool-strip implementations (consistency)** (2025-09-25).
  - *Issue:* another session had added a `#toolstrip` that showed only the tools *used so far*. The request is that *every* tool is represented.
  - *Fix:* merged into one implementation. The existing `#toolstrip` / `.tool-chip` markup and the per-tool active counter were kept. Chips are now pre-built from the full registry published by the new bridge extension, inactive tools are dimmed, and the "on" state is a solid fill with a glow. No duplicate code remains.

- **Azure model failed with `400 API version not supported`** (2025-09-25).
  - *Cause:* the shell exports `AZURE_OPENAI_API_VERSION=2025-04-01-preview`. pi's `azure-openai-responses` provider always targets the `/openai/v1` endpoint and forwards that variable as `api-version`. The v1 endpoint rejects dated preview versions; pi's own default is `v1`.
  - *Fix:* added the optional `PI_WRAPPER_PI_ENV` setting (env overrides applied only to the pi child process) and set `PI_WRAPPER_PI_ENV=AZURE_OPENAI_API_VERSION=v1` in `.env` / `.env.example`. The shell env is untouched, so other apps that need the dated version keep working. Verified: `gpt-5.5` answers `PONG`.

## Dependency vetting log

- 2025-09-25: no runtime or dev dependencies (Node built-ins only). Nothing to vet.
