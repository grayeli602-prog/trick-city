// Core logic tests. Run with: node --test tests/core.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

// Minimal localStorage for the store.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { CATALOG, autoName, keyOf, parseKey, parentKeys, stepKey, DEFAULT_INGREDIENTS } = await import("../js/core/catalog.js");
const { createStore, migrate, parseBackup, backupFile, summarize, SCHEMA } = await import("../js/core/store.js");
const { buildModel, LAYOUT } = await import("../js/core/model.js");

const ings = DEFAULT_INGREDIENTS.map((i) => ({ ...i }));

test("catalog has the 32 starting tricks with unique keys", () => {
  assert.equal(CATALOG.length, 32);
  assert.equal(new Set(CATALOG).size, 32);
  assert.ok(CATALOG.includes(""));
  assert.ok(CATALOG.includes("bs:1,kf:1"));
});

test("keys round-trip and step", () => {
  assert.equal(keyOf({ kf: 1, bs: 2 }), "bs:2,kf:1");
  assert.deepEqual(parseKey("bs:2,kf:1"), { bs: 2, kf: 1 });
  assert.deepEqual(parentKeys("bs:1,kf:1").sort(), ["bs:1", "kf:1"]);
  assert.equal(stepKey("kf:1", "bs", 1), "bs:1,kf:1");
  assert.equal(stepKey("kf:2", "kf", 1), "kf:2");
  assert.equal(stepKey("kf:1", "kf", -1), "");
});

test("real trick names", () => {
  const n = (k, st = "regular") => autoName(k, st, ings);
  assert.equal(n(""), "Ollie");
  assert.equal(n("bs:1,kf:1"), "Varial kickflip");
  assert.equal(n("bs:2,kf:1"), "360 flip");
  assert.equal(n("fs:1,kf:1"), "Hardflip");
  assert.equal(n("bs:1,hf:1"), "Inward heelflip");
  assert.equal(n("fs:2,hf:1"), "Laser flip");
  assert.equal(n("bb:1,bs:2"), "Bigspin");
  assert.equal(n("bb:1,bs:2,kf:1"), "Bigflip");
  assert.equal(n("bb:1", "fakie"), "Half-cab");
  assert.equal(n("bb:1,kf:1", "fakie"), "Half-cab flip");
  assert.equal(n("kf:1", "switch"), "Switch kickflip");
  assert.equal(n("bs:1,bvb:1"), "BS body varial pop shove-it");
});

// Shape saved by the first standalone version (single index.html).
const legacy = {
  feet: { "regular|kf:1": { b: { x: 320, y: 90, a: -5 }, f: { x: 130, y: 110, a: -30 } } },
  view: "map", stance: "regular", filter: "next",
  ings: [
    { id: "kf", name: "Kickflip", color: "#ff5a3c", side: "sun", builtin: 1 },
    { id: "bs", name: "Pop shove", color: "#33cc66", side: "sun", builtin: 1 },
    { id: "bvb", name: "BS body varial", color: "#ff8800", side: "moon", builtin: 1 },
  ],
  sideCol: { sun: "#ffaa00", moon: "#101010", earth: "#22ee55" },
  levels: { "regular|ollie": 3, "regular|kf:1": 3, "regular|bs:1,kf:1": 1, "fakie|ollie": 3, "regular|bad": 7 },
  pos: { "kf:1": { x: 200, y: 140 }, "bs:1": { x: 180.6, y: 250 } },
  side: { "bb:1": "earth", "x": "mars" },
  names: {}, notes: {}, custom: ["bs:1,bvb:1"], hidden: [],
  feetV2: 1, orbStyle: 9, palette: "bw", updatedAt: 1700000000000,
};

test("migrates the old save without losing anything", () => {
  const s = migrate(legacy);
  assert.equal(s.schema, SCHEMA);
  assert.equal(s.prefs.filter, "next");
  assert.equal(s.prefs.palette, undefined, "black and white only: no colors setting");
  assert.equal(s.prefs.layout, "custom", "saved positions mean custom layout");
  assert.deepEqual(s.positions["bs:1"], { x: 181, y: 250 });
  assert.equal(s.levels["regular|kf:1"], 3);
  assert.equal(s.levels["fakie|ollie"], 3);
  assert.equal(s.levels["regular|bad"], undefined, "invalid levels dropped");
  assert.equal(s.sides["bb:1"], "earth");
  assert.equal(s.sides.x, undefined);
  assert.equal(s.sideColors.sun, "#ffaa00");
  assert.equal(s.ingredients.find((i) => i.id === "bs").color, "#33cc66", "custom colors kept");
  assert.ok(s.ingredients.find((i) => i.id === "bvb").addon, "body varial stays an add-on");
  assert.ok(s.ingredients.find((i) => i.id === "hf"), "missing built-ins come back");
  assert.deepEqual(s.feet["regular|kf:1"].f, { x: 130, y: 110, a: -30 }, "feet not mirrored again");
  assert.deepEqual(s.custom, ["bs:1,bvb:1"]);
});

test("very old feet (before the flip fix) are mirrored once", () => {
  const s = migrate({ ...legacy, feetV2: undefined });
  assert.deepEqual(s.feet["regular|kf:1"].b, { x: 40, y: 90, a: 5 });
});

test("store upgrades an old save in place and keeps a copy", () => {
  mem.clear();
  mem.set("trickmap", JSON.stringify(legacy));
  const store = createStore();
  assert.equal(JSON.parse(mem.get("trickmap")).schema, SCHEMA);
  assert.ok(mem.get("trickmap.before-v2"), "untouched copy of the old save");
  const snaps = store.snapshots();
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0].reason, "Before the update");
});

test("want limit is 3 across all stances", () => {
  mem.clear();
  const store = createStore();
  assert.ok(store.setLevel("kf:1", "regular", 1).ok);
  assert.ok(store.setLevel("hf:1", "regular", 1).ok);
  assert.ok(store.setLevel("kf:1", "fakie", 1).ok);
  const r = store.setLevel("bs:1", "regular", 1);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "want-limit");
  assert.equal(r.wants.length, 3);
  assert.ok(store.setLevel("kf:1", "regular", 2).ok, "moving past want frees a slot");
  assert.ok(store.setLevel("bs:1", "regular", 1).ok);
  assert.equal(store.state.history.length, 5);
});

test("backup file round-trips and old saves are accepted", () => {
  mem.clear();
  const store = createStore();
  store.setLevel("kf:1", "regular", 3);
  const { filename, text } = backupFile(store.state, new Date(2026, 9, 21));
  assert.equal(filename, "trick-map-backup-2026-10-21.json");
  const parsed = parseBackup(text);
  assert.ok(parsed.ok);
  assert.equal(parsed.state.levels["regular|kf:1"], 3);
  assert.equal(parsed.summary.locked, 1);
  assert.ok(parseBackup(JSON.stringify(legacy)).ok, "raw old save works as a backup");
  assert.equal(parseBackup("not json").ok, false);
  assert.equal(parseBackup(JSON.stringify({ hello: 1 })).ok, false);
});

test("restoring keeps the current map as a restore point", () => {
  mem.clear();
  const store = createStore();
  store.setLevel("kf:1", "regular", 3);
  const before = store.snapshots().length;
  store.replaceState(migrate({}));
  assert.equal(store.level("kf:1"), 0);
  const snaps = store.snapshots();
  assert.equal(snaps.length, before + 1);
  assert.ok(store.restoreSnapshot(snaps[0].id));
  assert.equal(store.level("kf:1"), 3);
});

test("undo and redo", () => {
  mem.clear();
  const store = createStore({ undo: true });
  store.setLevel("kf:1", "regular", 2);
  store.setSide("kf:1", "moon");
  assert.equal(store.side("kf:1"), "moon");
  store.undo();
  assert.equal(store.side("kf:1"), "sun");
  store.undo();
  assert.equal(store.level("kf:1"), 0);
  store.redo();
  assert.equal(store.level("kf:1"), 2);
});

test("model: fixed bands and next stops", () => {
  mem.clear();
  const store = createStore();
  const M = buildModel(store);
  assert.equal(M.H, LAYOUT.BANDH * 3);
  assert.equal(M.nodes.length, 32);
  const kick = M.map.get("kf:1");
  assert.equal(kick.side, "sun");
  assert.ok(kick.y >= M.bands.sun.y0 && kick.y < M.bands.sun.y1);
  store.setLevel("kf:1", "regular", 2);
  store.setPref("filter", "next");
  const next = buildModel(store);
  assert.ok(next.map.has("bs:1,kf:1"), "one step from a landed trick");
  assert.ok(!next.map.has("bs:2,kf:1"), "two steps away is hidden");
  assert.deepEqual(summarize(store.state).landed, 1);
});

test("typing a name is one undo step, and batches are one step", () => {
  mem.clear();
  const store = createStore({ key: "t-coalesce", snapshots: false, undo: true });
  store.rename("kf:1", "K");
  store.rename("kf:1", "Kf");
  store.rename("kf:1", "Kfl");
  assert.equal(store.name("kf:1"), "Kfl");
  assert.equal(store.undoStack.length, 1);
  store.undo();
  assert.equal(store.name("kf:1"), "Kickflip");

  let emits = 0;
  store.subscribe(() => emits++);
  store.batch("Two things", () => {
    store.setLevel("kf:1", "regular", 2);
    store.setSide("kf:1", "moon");
  });
  assert.equal(emits, 1);
  assert.equal(store.undoLabel(), "Two things");
  store.undo();
  assert.equal(store.level("kf:1"), 0);
  assert.equal(store.side("kf:1"), "sun");
});

test("the friends key survives undo, redo and restoring an older version", () => {
  mem.clear();
  const store = createStore({ undo: true });
  store.setLevel("kf:1", "regular", 2);
  store.setAccount({ code: "K7Q2M9XA", key: "k".repeat(32) });
  store.markBackedUp();
  store.undo();
  assert.equal(store.state.account.code, "K7Q2M9XA");
  assert.ok(store.state.meta.lastBackup, "undo doesn't forget the last backup");
  store.redo();
  assert.equal(store.state.account.code, "K7Q2M9XA");
  store.replaceState({ schema: SCHEMA, levels: {} });
  assert.equal(store.state.account.code, "K7Q2M9XA", "older version without a key keeps this one");
  const file = parseBackup(backupFile(store.state).text);
  assert.equal(file.state.account.code, "K7Q2M9XA", "backups carry the key to a new phone");
});

test("friends see the map but not notes or the private key", async () => {
  const { shareable } = await import("../js/core/store.js");
  mem.clear();
  const store = createStore();
  store.setAccount({ code: "K7Q2M9XA", key: "k".repeat(32) });
  store.transact("note", (s) => { s.notes["kf:1"] = "private"; });
  const snap = shareable(store.state);
  assert.equal(snap.account, undefined);
  assert.equal(snap.notes, undefined);
  assert.equal(snap.meta, undefined);
  assert.ok(snap.levels && snap.ingredients && snap.profile);
});

test("a friend's map is read-only and never saved", () => {
  mem.clear();
  const friend = createStore({ key: null, initial: { schema: SCHEMA, levels: { "regular|kf:1": 3 } }, readOnly: true });
  assert.equal(friend.level("kf:1"), 3);
  assert.equal(friend.setLevel("kf:1", "regular", 0).ok, false);
  friend.setSide("kf:1", "moon");
  friend.dropTricks([{ key: "kf:1", x: 10, y: 10, zone: "moon" }]);
  assert.equal(friend.side("kf:1"), "sun");
  assert.equal(friend.level("kf:1"), 3);
  assert.equal(mem.size, 0, "nothing written to storage");
});

test("a failed save is announced once, and saves that work stay quiet", () => {
  mem.clear();
  const store = createStore();
  const seen = [];
  store.subscribe((info) => seen.push(info.source));
  const news = () => seen.filter((x) => x === "save-status").length;
  store.setLevel("kf:1", "regular", 2);
  store.saveNow();
  assert.equal(news(), 0, "nothing to announce when saving works");
  const real = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => { throw new Error("full"); };
  try {
    store.setLevel("hf:1", "regular", 2);
    store.saveNow();
    store.saveNow();
  } finally {
    globalThis.localStorage.setItem = real;
  }
  assert.equal(store.saveError, true, "shows Couldn't save");
  assert.equal(news(), 1);
  store.saveNow();
  assert.equal(store.saveError, false, "recovers when storage works again");
  assert.equal(news(), 2);
});

test("ollie north, ollie south and shove-its without pop", () => {
  mem.clear();
  const store = createStore();
  assert.equal(store.name("north:1"), "Ollie north");
  assert.equal(store.name("south:1"), "Ollie south");
  assert.equal(store.name("north:1", "switch"), "Switch ollie north");
  assert.equal(store.name("kf:1,north:1"), "Kickflip north");
  assert.equal(store.name("npbs:1"), "Shove-it");
  assert.equal(store.name("npbs:1", "fakie"), "Fakie shove-it");
  assert.equal(store.name("npfs:1"), "FS shove-it");
  assert.equal(store.name("bvb:1,kf:1"), "BS body varial kickflip", "add-on names unchanged");
  assert.equal(store.side("north:1"), "earth");
  assert.equal(store.side("npbs:1"), "sun");
  assert.equal(store.side("npfs:1"), "moon");
  const M = buildModel(store);
  for (const k of ["north:1", "south:1", "npbs:1", "npfs:1"]) assert.ok(M.map.has(k), `${k} on the map`);
  assert.equal(store.ing("north").max, 1, "can't be doubled");
  // An older save gets the new ingredients and tricks too.
  const old = migrate({ schema: 2, ingredients: DEFAULT_INGREDIENTS.slice(0, 8), levels: { "regular|kf:1": 2 } });
  assert.ok(old.ingredients.find((i) => i.id === "south")?.after);
});

test("in your own layout, tricks you haven't placed don't land on yours", () => {
  mem.clear();
  const store = createStore();
  const auto = buildModel(store);
  // Pin everything except the shove-it (no pop), then crowd its automatic spot.
  const at = auto.map.get("npbs:1");
  store.transact("layout", (s) => {
    s.prefs.layout = "custom";
    for (const n of auto.nodes) if (n.k !== "npbs:1") s.positions[n.k] = { x: n.ax, y: n.ay };
    s.positions["kf:1"] = { x: at.ax, y: at.ay };
  });
  const M = buildModel(store);
  const n = M.map.get("npbs:1");
  for (const m of M.nodes) {
    if (m === n) continue;
    assert.ok(Math.abs(m.x - n.x) >= 96 || Math.abs(m.y - n.y) >= 44, `clear of ${m.k}`);
  }
  assert.equal(n.side, "sun");
  assert.ok(n.y >= M.bands.sun.y0 && n.y < M.bands.sun.y1, "stays in its band");
});

test("custom layout with nothing placed yet looks like the automatic one", () => {
  mem.clear();
  const store = createStore();
  const auto = buildModel(store);
  store.setPref("layout", "custom");
  const M = buildModel(store);
  for (const n of M.nodes) {
    const a = auto.map.get(n.k);
    assert.deepEqual([n.x, n.y], [a.x, a.y], n.k);
  }
});
