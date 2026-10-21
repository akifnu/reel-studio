import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "./index.js";
class Bucket {
  values = new Map();
  async get(key) {
    const value = this.values.get(key);
    return value === undefined ? null : { json: async () => JSON.parse(value) };
  }
  async put(key, value) {
    this.values.set(key, value);
  }
  async delete(key) {
    this.values.delete(key);
  }
  async list({ prefix }) {
    return {
      objects: [...this.values.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((key) => ({ key })),
    };
  }
}
const env = () => ({
  BRIDGE: new Bucket(),
  ASSETS: { fetch: async () => new Response("editor") },
});
const key = "a".repeat(64),
  other = "b".repeat(64);
async function browser(e, body, token = key) {
  return handle(
    new Request("https://editor.test/api/bridge", {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    e,
  );
}
async function rpc(e, method, params = {}) {
  return (
    await handle(
      new Request("https://editor.test/mcp", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
      e,
    )
  ).json();
}
const snapshot = () => ({
  project_id: "local-project",
  generation: 3,
  revision: 2,
  busy: false,
  approved_generation: null,
  frames: [{ role: "reference", t: 1, image: "data:image/jpeg;base64,YQ==" }],
  reels: [{ id: "r01" }],
});
async function call(e, name, args) {
  return rpc(e, "tools/call", {
    name,
    arguments: { session_key: key, ...args },
  });
}
test("MCP initializes and exposes actual editing tools without an inference API", async () => {
  const e = env(),
    init = await rpc(e, "initialize");
  assert.equal(init.result.serverInfo.name, "reel-studio");
  const list = await rpc(e, "tools/list");
  assert.deepEqual(
    list.result.tools.map((t) => t.name),
    ["reel_read_context", "reel_read_frames", "reel_run_tool"],
  );
  assert.equal(
    (await handle(new Request("https://editor.test/"), e)).status,
    200,
  );
  assert.equal(
    (
      await handle(
        new Request("https://editor.test/mcp", {
          method: "POST",
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
          }),
        }),
        e,
      )
    ).status,
    202,
  );
});
test("sessions isolate frames and report missing/expired browsers honestly", async () => {
  const e = env();
  await browser(e, { action: "snapshot", snapshot: snapshot() });
  const frames = await call(e, "reel_read_frames", { role: "reference" });
  assert.equal(frames.result.content[1].type, "image");
  assert.equal(frames.result.content[1].data, "YQ==");
  const denied = await rpc(e, "tools/call", {
    name: "reel_read_context",
    arguments: { session_key: other },
  });
  assert.equal(denied.result.isError, true);
  assert.equal((await browser(e, undefined, "bad")).status, 400);
  const context = await call(e, "reel_read_context", {});
  assert.equal(context.result.structuredContent.frames, undefined);
  assert.equal(context.result.structuredContent.generation, 3);
});
test("queues are generation guarded, single job at a time, and completed jobs cannot replay", async () => {
  const e = env();
  await browser(e, { action: "snapshot", snapshot: snapshot() });
  const stale = await call(e, "reel_run_tool", {
    tool: "apply_edit",
    generation: 2,
    args: {},
  });
  assert.equal(stale.result.isError, true);
  const queued = await call(e, "reel_run_tool", {
    tool: "sample_frames",
    generation: 3,
    args: { role: "source", times: [1] },
  });
  assert.equal(queued.result.structuredContent.status, "queued");
  const duplicate = await call(e, "reel_run_tool", {
    tool: "measure_reference",
    generation: 3,
    args: {},
  });
  assert.equal(duplicate.result.isError, true);
  const next = await (await browser(e)).json();
  assert.equal(next.command.tool, "sample_frames");
  await browser(e, {
    action: "result",
    id: next.command.id,
    status: "succeeded",
    result: { frames: 1 },
  });
  assert.equal((await (await browser(e)).json()).command, null);
  const context = await call(e, "reel_read_context", {});
  assert.equal(context.result.structuredContent.last_job.status, "succeeded");
});
test("FFmpeg requires explicit current browser approval and disconnect removes only that session", async () => {
  const e = env();
  await browser(e, { action: "snapshot", snapshot: snapshot() });
  await browser(e, { action: "snapshot", snapshot: snapshot() }, other);
  const blocked = await call(e, "reel_run_tool", {
    tool: "ffmpeg_render",
    generation: 3,
    args: { approved: true },
  });
  assert.equal(blocked.result.isError, true);
  assert.match(blocked.result.content[0].text, /approve/i);
  await browser(e, {
    action: "snapshot",
    snapshot: { ...snapshot(), approved_generation: 3 },
  });
  const approved = await call(e, "reel_run_tool", {
    tool: "ffmpeg_render",
    generation: 3,
    args: {},
  });
  assert.equal(approved.result.structuredContent.status, "queued");
  await browser(e, { action: "disconnect" });
  assert.equal((await call(e, "reel_read_context", {})).result.isError, true);
  assert.ok(e.BRIDGE.values.size > 0);
});
