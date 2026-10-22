// Friends API logic: each person gets a friend code and a private key, syncs
// a copy of their map, and can see the maps of the friends they've added.
// Storage is Redis (Upstash over REST in production, an in-memory fake in tests).
//
// Keys:
//   tm:user:<code>     JSON { code, name, handle, updatedAt, snapshot }
//   tm:auth:<code>     sha256 of the private key
//   tm:friends:<code>  set of friend codes (always mutual)
//   tm:rl:<what>:<who> rate-limit counters

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O or 1/I
const CODE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/;
const MAX_SNAPSHOT = 200_000; // characters of JSON
const MAX_FRIENDS = 100;
const LIMITS = { join: [10, 3600], sync: [600, 3600], add: [60, 3600], peek: [120, 3600], list: [600, 3600] };

const sha = (s) => createHash("sha256").update(s).digest("hex");

export function newCode() {
  const bytes = randomBytes(8);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export const cleanCode = (s) => String(s || "").toUpperCase().replace(/[^0-9A-Z]/g, "");

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

/** Redis over Upstash's REST API. */
export function upstash(url, token) {
  const call = async (path, body) => {
    const r = await fetch(url.replace(/\/$/, "") + path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`redis http ${r.status}`);
    return r.json();
  };
  return {
    async cmd(...args) {
      const j = await call("", args);
      if (j.error) throw new Error(j.error);
      return j.result;
    },
    async pipe(cmds) {
      const j = await call("/pipeline", cmds);
      return j.map((x) => {
        if (x.error) throw new Error(x.error);
        return x.result;
      });
    },
  };
}

function shapeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new HttpError(400, "bad-snapshot");
  const text = JSON.stringify(snapshot);
  if (text.length > MAX_SNAPSHOT) throw new HttpError(413, "too-big");
  return snapshot;
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function createFriendsApi(redis, { now = () => Date.now() } = {}) {
  async function limit(what, who) {
    const [max, secs] = LIMITS[what];
    const key = `tm:rl:${what}:${who}`;
    // Start the window with a timeout only if it doesn't exist yet; INCR keeps the timeout.
    const [, count] = await redis.pipe([["SET", key, "0", "EX", String(secs), "NX"], ["INCR", key]]);
    if (count > max) throw new HttpError(429, "slow-down");
  }

  async function auth(body) {
    const code = cleanCode(body.code);
    const key = typeof body.key === "string" ? body.key : "";
    if (!CODE_RE.test(code) || key.length < 20) throw new HttpError(401, "bad-key");
    const stored = await redis.cmd("GET", `tm:auth:${code}`);
    const given = sha(key);
    if (!stored || stored.length !== given.length || !timingSafeEqual(Buffer.from(stored), Buffer.from(given))) throw new HttpError(401, "bad-key");
    return code;
  }

  const publicUser = (raw) => {
    if (!raw) return null;
    try {
      const u = JSON.parse(raw);
      return { code: u.code, name: u.name || "", handle: u.handle || "", updatedAt: u.updatedAt || 0, snapshot: u.snapshot || null };
    } catch {
      return null;
    }
  };

  const actions = {
    async join(body, ip) {
      await limit("join", ip);
      const key = randomBytes(24).toString("base64url");
      for (let i = 0; i < 6; i++) {
        const code = newCode();
        const user = JSON.stringify({ code, name: str(body.name, 40), handle: str(body.handle, 40), updatedAt: 0, snapshot: null });
        const ok = await redis.cmd("SET", `tm:user:${code}`, user, "NX");
        if (ok !== "OK") continue;
        await redis.cmd("SET", `tm:auth:${code}`, sha(key));
        return { code, key };
      }
      throw new HttpError(503, "try-again");
    },

    async sync(body) {
      const code = await auth(body);
      await limit("sync", code);
      const snapshot = shapeSnapshot(body.snapshot);
      const updatedAt = now();
      const user = { code, name: str(body.name, 40), handle: str(body.handle, 40), updatedAt, snapshot };
      await redis.cmd("SET", `tm:user:${code}`, JSON.stringify(user));
      return { ok: true, updatedAt };
    },

    async list(body) {
      const code = await auth(body);
      await limit("list", code);
      const codes = (await redis.cmd("SMEMBERS", `tm:friends:${code}`)) || [];
      if (!codes.length) return { friends: [] };
      const raws = await redis.cmd("MGET", ...codes.map((c) => `tm:user:${c}`));
      return { friends: raws.map(publicUser).filter(Boolean) };
    },

    async peek(body, ip) {
      await limit("peek", ip);
      const friend = cleanCode(body.friend);
      if (!CODE_RE.test(friend)) throw new HttpError(404, "no-such-code");
      const u = publicUser(await redis.cmd("GET", `tm:user:${friend}`));
      if (!u) throw new HttpError(404, "no-such-code");
      return { code: u.code, name: u.name, handle: u.handle };
    },

    async add(body) {
      const code = await auth(body);
      await limit("add", code);
      const friend = cleanCode(body.friend);
      if (!CODE_RE.test(friend)) throw new HttpError(404, "no-such-code");
      if (friend === code) throw new HttpError(400, "thats-you");
      const raw = await redis.cmd("GET", `tm:user:${friend}`);
      if (!raw) throw new HttpError(404, "no-such-code");
      const [mine, theirs] = await redis.pipe([["SCARD", `tm:friends:${code}`], ["SCARD", `tm:friends:${friend}`]]);
      if (mine >= MAX_FRIENDS || theirs >= MAX_FRIENDS) throw new HttpError(409, "too-many");
      await redis.pipe([["SADD", `tm:friends:${code}`, friend], ["SADD", `tm:friends:${friend}`, code]]);
      return { friend: publicUser(raw) };
    },

    async remove(body) {
      const code = await auth(body);
      const friend = cleanCode(body.friend);
      if (!CODE_RE.test(friend)) throw new HttpError(404, "no-such-code");
      await redis.pipe([["SREM", `tm:friends:${code}`, friend], ["SREM", `tm:friends:${friend}`, code]]);
      return { ok: true };
    },

    /** Turn friends off: delete the synced map and leave every friend list. */
    async leave(body) {
      const code = await auth(body);
      const codes = (await redis.cmd("SMEMBERS", `tm:friends:${code}`)) || [];
      const cmds = codes.map((c) => ["SREM", `tm:friends:${c}`, code]);
      cmds.push(["DEL", `tm:user:${code}`, `tm:auth:${code}`, `tm:friends:${code}`]);
      await redis.pipe(cmds);
      return { ok: true };
    },
  };

  /** Handle one request. Returns { status, body }. */
  return async function handle(body, { ip = "anon" } = {}) {
    try {
      if (!body || typeof body !== "object") throw new HttpError(400, "bad-request");
      const fn = actions[body.action];
      if (!fn) throw new HttpError(400, "bad-action");
      return { status: 200, body: await fn(body, ip) };
    } catch (err) {
      if (err instanceof HttpError) return { status: err.status, body: { error: err.code } };
      return { status: 500, body: { error: "server" } };
    }
  };
}

/**
 * The database's address and token from the environment. Connecting Upstash
 * in Vercel adds KV_REST_API_URL and KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_*),
 * with a custom prefix if one was picked, like TRICKS_KV_REST_API_URL.
 */
export function redisEnv(env) {
  for (const [u, t] of [["KV_REST_API_URL", "KV_REST_API_TOKEN"], ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]]) {
    if (env[u] && env[t]) return { url: env[u], token: env[t] };
  }
  for (const k of Object.keys(env)) {
    const m = k.match(/^(.+)_(REST_API|REDIS_REST)_URL$/);
    const token = m && env[`${m[1]}_${m[2]}_TOKEN`];
    if (token && /^https:\/\//.test(env[k])) return { url: env[k], token };
  }
  return null;
}

/** Vercel entry: POST /api/friends with a JSON body. */
export async function handleRequest(request, env = process.env) {
  const json = (status, body) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  const db = redisEnv(env);
  // Open /api/friends in a browser to check that it's running and the database is connected.
  if (request.method === "GET") return json(200, { service: "trick-map-friends", configured: !!db });
  if (request.method !== "POST") return json(405, { error: "post-only" });
  if (!db) return json(503, { error: "not-configured" });
  const { url, token } = db;
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_SNAPSHOT * 2) return json(413, { error: "too-big" });
  let body;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json(400, { error: "bad-json" });
  }
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "anon";
  const { status, body: out } = await createFriendsApi(upstash(url, token))(body, { ip });
  return json(status, out);
}
