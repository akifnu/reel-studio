// Local QA of the same Worker handler, with ephemeral storage and the built editor.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { handle } from "./index.js";
const root = resolve(import.meta.dirname, "../frontend/dist/client"),
  values = new Map();
const types = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".html": "text/html",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
};
const env = {
  BRIDGE: {
    get: async (key) =>
      values.has(key)
        ? { json: async () => JSON.parse(values.get(key)) }
        : null,
    put: async (key, value) => {
      values.set(key, value);
    },
    delete: async (key) => {
      values.delete(key);
    },
    list: async ({ prefix }) => ({
      objects: [...values.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ key })),
    }),
  },
  ASSETS: {
    fetch: async (request) => {
      let path = decodeURIComponent(new URL(request.url).pathname);
      if (path === "/") path = "/index.html";
      const file = resolve(root, "." + path);
      if (!file.startsWith(root + "/"))
        return new Response("Not found", { status: 404 });
      try {
        return new Response(await readFile(file), {
          headers: {
            "Content-Type": types[extname(file)] || "application/octet-stream",
          },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  },
};
createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request("http://127.0.0.1:8765" + req.url, {
      method: req.method,
      headers: req.headers,
      ...(["GET", "HEAD"].includes(req.method)
        ? {}
        : { body: Buffer.concat(chunks) }),
    });
    const response = await handle(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end("Preview error");
  }
}).listen(8765, "127.0.0.1", () =>
  console.log("Reel Studio tool preview: http://127.0.0.1:8765"),
);
