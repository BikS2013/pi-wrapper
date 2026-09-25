/**
 * pi-wrapper bridge extension.
 *
 * Loaded automatically by the pi-wrapper server (`pi --mode rpc -e <this file>`).
 * pi's RPC protocol has no command that lists tools, so this extension publishes the
 * tool registry (all tools + currently active tools) to the wrapper through the RPC
 * extension-UI sub-protocol: a `setStatus` request with the reserved key below whose
 * text is a JSON payload. The wrapper server intercepts that key (it is never shown
 * as a normal status entry) and re-publishes it to the web page as a `tools` event.
 *
 * Published: on session start, before every agent run (active tools may change),
 * and on demand via the `/wrapper-tools` command (sent by the server after startup).
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const TOOLS_STATUS_KEY = "pi-wrapper:tools";

export default function wrapperBridge(pi: ExtensionAPI) {
  function publish(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    const tools = pi.getAllTools().map((t) => ({
      name: t.name,
      description: typeof t.description === "string" ? t.description : "",
      source: t.sourceInfo?.source ?? "",
    }));
    const payload = { tools, active: pi.getActiveTools() };
    ctx.ui.setStatus(TOOLS_STATUS_KEY, JSON.stringify(payload));
  }

  pi.on("session_start", async (_event, ctx) => publish(ctx));
  pi.on("before_agent_start", async (_event, ctx) => {
    publish(ctx);
  });
  pi.registerCommand("wrapper-tools", {
    description: "pi-wrapper internal: publish the tool registry to the web UI",
    handler: async (_args, ctx) => publish(ctx),
  });
}
