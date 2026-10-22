// Local server for trying Trick Map with friends: serves the app and answers
// POST /api/friends from an in-memory database that's wiped when it stops.
// Run with: node tests/serve.mjs [port]   (default 8787)

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createFriendsApi } from "../server/friends.mjs";
import { fakeRedis } from "./fake-redis.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.argv[2]) || 8787;
const api = createFriendsApi(fakeRedis());
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".svg": "image/svg+xml",
};

const send = (res, status, body, type = "application/json") => {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/friends") {
    if (req.method === "GET") return send(res, 200, '{"service":"trick-map-friends","configured":true}');
    if (req.method !== "POST") return send(res, 405, '{"error":"post-only"}');
    let text = "";
    for await (const chunk of req) text += chunk;
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return send(res, 400, '{"error":"bad-json"}');
    }
    const out = await api(body, { ip: req.socket.remoteAddress });
    return send(res, out.status, JSON.stringify(out.body));
  }
  const file = normalize(join(root, decodeURIComponent(url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname)));
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) return send(res, 403, "Forbidden", "text/plain");
  try {
    send(res, 200, await readFile(file), TYPES[extname(file)] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found", "text/plain");
  }
}).listen(port, "127.0.0.1", () => console.log(`Trick Map with friends: http://127.0.0.1:${port}/`));
