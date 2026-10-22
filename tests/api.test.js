// Friends API tests against an in-memory Redis.
// Run with: node --test tests/core.test.js tests/sw.test.js tests/api.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

const { createFriendsApi, handleRequest, cleanCode } = await import("../server/friends.mjs");
const { fakeRedis } = await import("./fake-redis.mjs");

const setup = () => {
  const redis = fakeRedis();
  return { redis, api: createFriendsApi(redis) };
};
const ok = async (p) => {
  const r = await p;
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};

test("join gives a friend code and a private key", async () => {
  const { api, redis } = setup();
  const me = await ok(api({ action: "join", name: "Sam" }));
  assert.match(me.code, /^[2-9A-HJ-NP-Z]{8}$/);
  assert.ok(me.key.length >= 20);
  assert.notEqual(redis.kv.get(`tm:auth:${me.code}`), me.key, "only a hash of the key is stored");
});

test("sync needs the right key", async () => {
  const { api } = setup();
  const me = await ok(api({ action: "join" }));
  const bad = await api({ action: "sync", code: me.code, key: "x".repeat(30), snapshot: {} });
  assert.equal(bad.status, 401);
  await ok(api({ action: "sync", code: me.code, key: me.key, name: "Sam", snapshot: { levels: { "regular|kf:1": 3 } } }));
});

test("adding a friend is mutual and both see each other's map", async () => {
  const { api } = setup();
  const sam = await ok(api({ action: "join" }));
  const max = await ok(api({ action: "join" }));
  await ok(api({ action: "sync", code: sam.code, key: sam.key, name: "Sam", snapshot: { levels: { "regular|kf:1": 3 } } }));
  await ok(api({ action: "sync", code: max.code, key: max.key, name: "Max", snapshot: { levels: { "regular|hf:1": 2 } } }));
  const peek = await ok(api({ action: "peek", friend: sam.code }));
  assert.equal(peek.name, "Sam");
  assert.equal(peek.snapshot, undefined, "peek shows the name only, not the map");
  await ok(api({ action: "add", code: max.code, key: max.key, friend: `${sam.code.slice(0, 4)}-${sam.code.slice(4).toLowerCase()}` }));
  const samList = await ok(api({ action: "list", code: sam.code, key: sam.key }));
  assert.equal(samList.friends.length, 1);
  assert.equal(samList.friends[0].name, "Max");
  assert.equal(samList.friends[0].snapshot.levels["regular|hf:1"], 2);
  const maxList = await ok(api({ action: "list", code: max.code, key: max.key }));
  assert.equal(maxList.friends[0].snapshot.levels["regular|kf:1"], 3);
});

test("strangers can't read a map without being added", async () => {
  const { api } = setup();
  const sam = await ok(api({ action: "join" }));
  await ok(api({ action: "sync", code: sam.code, key: sam.key, name: "Sam", snapshot: { levels: { "regular|kf:1": 3 } } }));
  const r = await api({ action: "list", code: sam.code, key: "wrong-key-wrong-key-wrong" });
  assert.equal(r.status, 401);
});

test("remove and leave", async () => {
  const { api, redis } = setup();
  const a = await ok(api({ action: "join" }));
  const b = await ok(api({ action: "join" }));
  const c = await ok(api({ action: "join" }));
  await ok(api({ action: "add", code: a.code, key: a.key, friend: b.code }));
  await ok(api({ action: "add", code: a.code, key: a.key, friend: c.code }));
  await ok(api({ action: "remove", code: b.code, key: b.key, friend: a.code }));
  assert.equal((await ok(api({ action: "list", code: a.code, key: a.key }))).friends.length, 1);
  await ok(api({ action: "leave", code: a.code, key: a.key }));
  assert.equal((await ok(api({ action: "list", code: c.code, key: c.key }))).friends.length, 0, "leaving removes you from friends' lists");
  assert.equal(redis.kv.has(`tm:user:${a.code}`), false, "synced map deleted");
  assert.equal((await api({ action: "sync", code: a.code, key: a.key, snapshot: {} })).status, 401);
});

test("bad input", async () => {
  const { api } = setup();
  const a = await ok(api({ action: "join" }));
  assert.equal((await api({ action: "add", code: a.code, key: a.key, friend: a.code })).status, 400, "can't add yourself");
  assert.equal((await api({ action: "add", code: a.code, key: a.key, friend: "ZZZZZZZZ" })).status, 404);
  assert.equal((await api({ action: "nope" })).status, 400);
  assert.equal((await api({ action: "sync", code: a.code, key: a.key, snapshot: { big: "x".repeat(250000) } })).status, 413);
  assert.equal(cleanCode(" k7q2-m9xa "), "K7Q2M9XA");
});

test("joining is rate limited", async () => {
  const { api } = setup();
  let last;
  for (let i = 0; i < 11; i++) last = await api({ action: "join" }, { ip: "1.2.3.4" });
  assert.equal(last.status, 429);
});

test("the Vercel entry answers 503 until the database is connected", async () => {
  const r = await handleRequest(new Request("https://x/api/friends", { method: "POST", body: "{}" }), {});
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, "not-configured");
  const g = await handleRequest(new Request("https://x/api/friends"), {});
  assert.deepEqual(await g.json(), { service: "trick-map-friends", configured: false }, "GET is a health check");
  const env = { KV_REST_API_URL: "https://a.upstash.io", KV_REST_API_TOKEN: "t" };
  const g2 = await handleRequest(new Request("https://x/api/friends"), env, { connect: () => fakeRedis() });
  assert.deepEqual(await g2.json(), { service: "trick-map-friends", configured: true, database: "ok" });
  const broken = { cmd: async () => { throw new Error("redis http 401"); } };
  const g3 = await handleRequest(new Request("https://x/api/friends"), env, { connect: () => broken });
  assert.equal((await g3.json()).database, "error", "a wrong token shows up in the check");
  const post = await handleRequest(new Request("https://x/api/friends", { method: "POST", body: '{"action":"join","name":"Sam"}' }), env, { connect: () => fakeRedis() });
  assert.equal(post.status, 200);
  assert.match((await post.json()).code, /^[2-9A-HJ-NP-Z]{8}$/);
  const put = await handleRequest(new Request("https://x/api/friends", { method: "PUT", body: "{}" }), {});
  assert.equal(put.status, 405);
});

test("finds the database settings Vercel adds, with or without a prefix", async () => {
  const { redisEnv } = await import("../server/friends.mjs");
  assert.deepEqual(redisEnv({ KV_REST_API_URL: "https://a.upstash.io", KV_REST_API_TOKEN: "t1" }), { url: "https://a.upstash.io", token: "t1" });
  assert.deepEqual(redisEnv({ UPSTASH_REDIS_REST_URL: "https://b.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t2" }), { url: "https://b.upstash.io", token: "t2" });
  assert.deepEqual(redisEnv({ TRICKS_KV_REST_API_URL: "https://c.upstash.io", TRICKS_KV_REST_API_TOKEN: "t3", PATH: "/bin" }), { url: "https://c.upstash.io", token: "t3" });
  assert.equal(redisEnv({ KV_REST_API_URL: "https://d.upstash.io" }), null, "a URL without a token isn't enough");
  assert.equal(redisEnv({}), null);
});
