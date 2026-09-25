// Smoke test: starts the wrapper on a spare port, verifies config validation,
// SSE replay, RPC pass-through, and a user bash command end-to-end.
// Set SMOKE_PROMPT=1 to also send a real LLM prompt (costs tokens).
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const PORT = 4399;
const base = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, PI_WRAPPER_PORT: String(PORT), PI_WRAPPER_HOST: "127.0.0.1", PI_WRAPPER_CWD: process.cwd(), PI_WRAPPER_PI_BIN: process.env.PI_WRAPPER_PI_BIN ?? "pi", PI_WRAPPER_HISTORY_LIMIT: "1000", PI_WRAPPER_PI_ARGS: process.env.SMOKE_PI_ARGS ?? "--no-session" };

async function run(): Promise<void> {
  // 1. Missing configuration must fail (no fallbacks).
  const bad = spawn(process.execPath, ["src/server.ts"], { env: { PATH: process.env.PATH } });
  let badErr = "";
  bad.stderr.on("data", (d) => (badErr += d));
  const code = await new Promise((r) => bad.on("exit", r));
  assert.equal(code, 2);
  assert.match(badErr, /Missing required configuration: set PI_WRAPPER_PORT/);
  console.log("✓ missing config rejected");

  // 2. Start the server.
  const srv = spawn(process.execPath, ["src/server.ts"], { env });
  srv.stderr.on("data", (d) => process.stderr.write(d));
  await new Promise<void>((resolve, reject) => {
    srv.stdout.on("data", (d) => { if (String(d).includes("listening")) resolve(); });
    srv.on("exit", () => reject(new Error("server exited early")));
  });
  try {
    const html = await (await fetch(base + "/")).text();
    assert.match(html, /<textarea id="input"/);
    assert.match(html, /<div id="toolstrip"/);
    console.log("✓ web page served");

    // 3. SSE stream: collect events.
    const events: any[] = [];
    const ctrl = new AbortController();
    const sse = await fetch(base + "/events", { signal: ctrl.signal });
    (async () => {
      const dec = new TextDecoder(); let buf = "";
      for await (const chunk of sse.body as any) {
        buf += dec.decode(chunk, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) !== -1) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = block.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
          if (!data) continue;
          const parsed = JSON.parse(data);
          if (block.startsWith("event: replay")) events.push(...parsed.events); else events.push(parsed);
        }
      }
    })().catch(() => {});
    const waitFor = async (pred: (e: any) => boolean, ms = 30_000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { const f = events.find(pred); if (f) return f; await new Promise((r) => setTimeout(r, 100)); }
      throw new Error("timeout waiting for event");
    };
    await waitFor((e) => e.record.type === "wrapper" && e.record.event === "started");
    console.log("✓ pi started, SSE replay received");

    // 4. RPC pass-through.
    const st = await (await fetch(base + "/api/rpc", { method: "POST", body: JSON.stringify({ type: "get_state" }) })).json();
    assert.equal(st.success, true);
    console.log(`✓ get_state ok (model: ${st.data.model ? st.data.model.provider + "/" + st.data.model.id : "none"})`);

    // 5. User bash command via the text-box endpoint.
    const r = await (await fetch(base + "/api/command", { method: "POST", body: JSON.stringify({ text: "!!echo hello-from-wrapper" }) })).json();
    assert.equal(r.success, true);
    assert.match(r.data.output, /hello-from-wrapper/);
    await waitFor((e) => e.record.type === "bash_execution_update" && /hello-from-wrapper/.test(e.record.delta));
    console.log("✓ bash command executed and streamed");

    // 6. Empty command rejected.
    const empty = await fetch(base + "/api/command", { method: "POST", body: JSON.stringify({ text: "  " }) });
    assert.equal(empty.status, 400);
    console.log("✓ empty command rejected");

    if (process.env.SMOKE_PROMPT === "1") {
      const p = await (await fetch(base + "/api/command", { method: "POST", body: JSON.stringify({ text: "Reply with exactly: PONG" }) })).json();
      assert.equal(p.success, true);
      await waitFor((e) => e.record.type === "agent_settled", 180_000);
      const end = events.filter((e) => e.record.type === "message_end" && e.record.message.role === "assistant").pop();
      console.log("✓ prompt round-trip:", JSON.stringify(end?.record.message.content).slice(0, 120));
    }
    ctrl.abort();
    console.log("ALL SMOKE TESTS PASSED");
  } finally {
    srv.kill("SIGTERM");
  }
}

run().then(() => process.exit(0), (e) => { console.error("FAILED:", e); process.exit(1); });
