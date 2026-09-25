# Issues - Pending Items

## Pending

1. **No authentication on the HTTP server.** This is acceptable only for a localhost bind. Add a token if remote access is ever needed.
2. **Image attachments are not supported from the text box.** The RPC `prompt` supports `images` (base64), but the UI has no upload control yet.

## Completed

- **Azure model failed with `400 API version not supported`** (2025-09-25).
  - *Cause:* the shell exports `AZURE_OPENAI_API_VERSION=2025-04-01-preview`. pi's `azure-openai-responses` provider always targets the `/openai/v1` endpoint and forwards that variable as `api-version`. The v1 endpoint rejects dated preview versions; pi's own default is `v1`.
  - *Fix:* added the optional `PI_WRAPPER_PI_ENV` setting (env overrides applied only to the pi child process) and set `PI_WRAPPER_PI_ENV=AZURE_OPENAI_API_VERSION=v1` in `.env` / `.env.example`. The shell env is untouched, so other apps that need the dated version keep working. Verified: `gpt-5.5` answers `PONG`.

## Dependency vetting log

- 2025-09-25: no runtime or dev dependencies (Node built-ins only). Nothing to vet.
