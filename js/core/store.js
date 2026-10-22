// The user's trick book: state shape, saving, migration from older versions,
// undo, automatic restore points, and backup files.
//
// Everything lives in localStorage on this device. The schema is versioned so
// older saves (the single-file app) are upgraded on first load, and an
// untouched copy of the old save is kept next to it.

import {
  DEFAULT_INGREDIENTS, DEFAULT_SIDE_COLORS, SIDES, STANCES, LEVELS, WANT_LIMIT, BASE_COLOR,
  CATALOG, parseKey, unitList, autoName, defaultFeet,
} from "./catalog.js";

export const STORAGE_KEY = "trickmap";
export const SCHEMA = 2;
const SNAPSHOT_KEY = "trickmap.snapshots";
const PRE_UPDATE_KEY = "trickmap.before-v2";
const MAX_SNAPSHOTS = 12;
const MAX_HISTORY = 1000;
const MAX_UNDO = 100;
const SNAPSHOT_EVERY = 20 * 3600 * 1000;
const COALESCE_MS = 1500;

const PREF_VALUES = {
  view: ["map", "grid"],
  filter: ["all", "next"],
  layout: ["auto", "custom"],
  rider: ["regular", "goofy"],
};

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isHex = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const clone = (v) => JSON.parse(JSON.stringify(v));

export const levelKey = (key, stance) => `${stance}|${key || "ollie"}`;
export function splitLevelKey(lk) {
  const i = lk.indexOf("|");
  const key = lk.slice(i + 1);
  return { stance: lk.slice(0, i), key: key === "ollie" ? "" : key };
}

export function defaultState() {
  return {
    schema: SCHEMA,
    updatedAt: 0,
    prefs: { view: "map", filter: "all", layout: "auto", rider: "regular" },
    ingredients: DEFAULT_INGREDIENTS.map((i) => ({ ...i })),
    sideColors: { ...DEFAULT_SIDE_COLORS },
    levels: {},     // "regular|kf:1" -> 1 want, 2 landed, 3 locked in
    positions: {},  // key -> { x, y } in map coordinates (custom layout)
    sides: {},      // key -> side the user picked over the automatic one
    names: {},      // key -> custom name
    notes: {},      // key -> text (kept from early versions)
    feet: {},       // "regular|kf:1" -> { b: {x,y,a}, f: {x,y,a} }, regular-rider coordinates
    custom: [],     // keys the user built that aren't in the catalog
    hidden: [],     // catalog keys the user removed from the map
    history: [],    // { t, k, st, from, to } level changes, newest last
    profile: { name: "", handle: "" },
    meta: { lastBackup: null },
    account: null,  // { code, key } once friends are turned on
  };
}

/* ---------- validation and migration ---------- */

function cleanFeet(f) {
  const shoe = (p) => isObj(p) && finite(p.x) && finite(p.y) && finite(p.a)
    ? { x: Math.round(p.x), y: Math.round(p.y), a: Math.round(p.a) } : null;
  if (!isObj(f)) return null;
  const b = shoe(f.b);
  const fr = shoe(f.f);
  return b && fr ? { b, f: fr } : null;
}

function cleanStringMap(obj, max = 60) {
  const out = {};
  if (!isObj(obj)) return out;
  for (const k in obj) if (typeof obj[k] === "string" && obj[k].trim()) out[k] = obj[k].slice(0, max);
  return out;
}

function cleanKeyList(list) {
  return Array.isArray(list) ? [...new Set(list.filter((k) => typeof k === "string"))] : [];
}

/** Bring any state-like object into the current shape, dropping bad values. */
export function normalize(input) {
  const s = isObj(input) ? input : {};
  const out = defaultState();
  out.updatedAt = finite(s.updatedAt) ? s.updatedAt : 0;

  for (const name in PREF_VALUES) {
    const v = s.prefs?.[name];
    if (PREF_VALUES[name].includes(v)) out.prefs[name] = v;
  }

  if (Array.isArray(s.ingredients)) {
    const seen = new Set();
    out.ingredients = s.ingredients
      .filter((i) => isObj(i) && typeof i.id === "string" && i.id && !seen.has(i.id) && seen.add(i.id))
      .map((i) => ({
        id: i.id,
        name: String(i.name ?? i.id).trim().slice(0, 60) || "Untitled",
        color: isHex(i.color) ? i.color.toLowerCase() : "#888888",
        side: SIDES[i.side] ? i.side : "earth",
        ...(i.builtin ? { builtin: true } : {}),
        ...(i.addon ? { addon: true } : {}),
      }));
  }
  for (const def of DEFAULT_INGREDIENTS) {
    const have = out.ingredients.find((i) => i.id === def.id);
    if (!have) out.ingredients.push({ ...def });
    else {
      have.builtin = true;
      if (def.addon) have.addon = true;
    }
  }

  if (isObj(s.sideColors)) for (const side in SIDES) if (isHex(s.sideColors[side])) out.sideColors[side] = s.sideColors[side].toLowerCase();

  if (isObj(s.levels)) {
    for (const lk in s.levels) {
      const v = s.levels[lk];
      const { stance } = splitLevelKey(lk);
      if (STANCES.includes(stance) && [1, 2, 3].includes(v)) out.levels[lk] = v;
    }
  }

  if (isObj(s.positions)) {
    for (const k in s.positions) {
      const p = s.positions[k];
      if (isObj(p) && finite(p.x) && finite(p.y)) out.positions[k] = { x: Math.round(p.x), y: Math.round(p.y) };
    }
  }

  if (isObj(s.sides)) for (const k in s.sides) if (SIDES[s.sides[k]]) out.sides[k] = s.sides[k];
  out.names = cleanStringMap(s.names);
  out.notes = cleanStringMap(s.notes, 2000);

  if (isObj(s.feet)) {
    for (const lk in s.feet) {
      const f = cleanFeet(s.feet[lk]);
      if (f) out.feet[lk] = f;
    }
  }

  out.custom = cleanKeyList(s.custom);
  out.hidden = cleanKeyList(s.hidden);

  if (Array.isArray(s.history)) {
    out.history = s.history
      .filter((h) => isObj(h) && finite(h.t) && typeof h.k === "string" && STANCES.includes(h.st) && finite(h.from) && finite(h.to))
      .slice(-MAX_HISTORY)
      .map((h) => ({ t: h.t, k: h.k, st: h.st, from: h.from, to: h.to }));
  }

  if (isObj(s.profile)) {
    out.profile.name = typeof s.profile.name === "string" ? s.profile.name.slice(0, 40) : "";
    out.profile.handle = typeof s.profile.handle === "string" ? s.profile.handle.slice(0, 40) : "";
  }
  if (isObj(s.meta) && finite(s.meta.lastBackup)) out.meta.lastBackup = s.meta.lastBackup;
  if (isObj(s.account) && /^[2-9A-HJ-NP-Z]{8}$/.test(s.account.code) && typeof s.account.key === "string" && s.account.key.length >= 20) {
    out.account = { code: s.account.code, key: s.account.key.slice(0, 200) };
  }
  return out;
}

/** The part of the map friends can see: no notes, backups or private key. */
export function shareable(state) {
  return {
    schema: SCHEMA,
    prefs: { layout: state.prefs.layout, rider: state.prefs.rider },
    ingredients: state.ingredients,
    sideColors: state.sideColors,
    levels: state.levels,
    positions: state.positions,
    sides: state.sides,
    names: state.names,
    feet: state.feet,
    custom: state.custom,
    hidden: state.hidden,
    history: state.history.slice(-200),
    profile: state.profile,
    updatedAt: state.updatedAt,
  };
}

/** Shape of the first standalone version (single index.html), mapped to schema 2. */
function fromLegacy(raw) {
  const positions = isObj(raw.pos) ? raw.pos : {};
  const feet = isObj(raw.feet) ? clone(raw.feet) : {};
  // Very early saves stored feet with the nose on the right; that version mirrored them on load.
  if (!raw.feetV2) {
    for (const lk in feet) {
      for (const id of ["b", "f"]) {
        const p = feet[lk]?.[id];
        if (isObj(p) && finite(p.x) && finite(p.a)) { p.x = 360 - p.x; p.a = -p.a; }
      }
    }
  }
  return {
    updatedAt: raw.updatedAt,
    prefs: {
      view: raw.view,
      filter: raw.filter,
      layout: raw.layout || (Object.keys(positions).length ? "custom" : "auto"),
      rider: raw.rider,
    },
    ingredients: raw.ings,
    sideColors: raw.sideCol,
    levels: raw.levels,
    positions,
    sides: raw.side,
    names: raw.names,
    notes: raw.notes,
    feet,
    custom: raw.custom,
    hidden: raw.hidden,
  };
}

export function migrate(raw) {
  if (!isObj(raw)) return defaultState();
  return normalize(raw.schema >= 2 ? raw : fromLegacy(raw));
}

export function summarize(state) {
  const values = Object.values(state.levels);
  return {
    rated: values.length,
    landed: values.filter((v) => v >= 2).length,
    locked: values.filter((v) => v === 3).length,
    wants: values.filter((v) => v === 1).length,
    placed: Object.keys(state.positions).length,
    custom: state.custom.length,
  };
}

/* ---------- backup files ---------- */

const pad = (n) => String(n).padStart(2, "0");

export function backupFile(state, now = new Date()) {
  const filename = `trick-map-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
  const text = JSON.stringify({ app: "trick-map", kind: "backup", schema: SCHEMA, exportedAt: now.toISOString(), data: state }, null, 2);
  return { filename, text };
}

/** Read a backup file's text. Accepts backups and raw saves from older versions. */
export function parseBackup(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file couldn't be read. Pick a Trick Map backup file (it ends in .json)." };
  }
  const data = isObj(raw) && raw.app === "trick-map" && isObj(raw.data) ? raw.data : raw;
  const looksRight = isObj(data) && ["levels", "ingredients", "ings", "positions", "pos"].some((k) => k in data);
  if (!looksRight) return { ok: false, error: "That file isn't a Trick Map backup. Pick the file you saved from Settings." };
  const state = migrate(data);
  const exportedAt = isObj(raw) && raw.exportedAt ? Date.parse(raw.exportedAt) : state.updatedAt || null;
  return { ok: true, state, exportedAt: Number.isFinite(exportedAt) ? exportedAt : null, summary: summarize(state) };
}

/* ---------- storage helpers (never throw) ---------- */

const hasStorage = () => typeof localStorage !== "undefined";
function read(key) {
  try { return hasStorage() ? localStorage.getItem(key) : null; } catch { return null; }
}
function write(key, text) {
  try { if (hasStorage()) localStorage.setItem(key, text); return true; } catch { return false; }
}
function parse(text) {
  if (text == null) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export function requestPersistence() {
  try { navigator.storage?.persist?.().catch(() => {}); } catch { /* not supported */ }
}

/* ---------- the store ---------- */

export function createStore(options = {}) {
  return new Store(options);
}

class Store {
  /**
   * `key` is where it saves (null: nowhere). `initial` starts from a given
   * state instead of storage. `readOnly` refuses every change (a friend's map).
   */
  constructor({ key = STORAGE_KEY, snapshots = true, undo = false, initial = null, readOnly = false } = {}) {
    this.key = key;
    this.readOnly = readOnly;
    this.options = { snapshots: snapshots && !!key, undo: undo && !readOnly };
    this.listeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.saveError = false;
    this._timer = null;
    this.state = initial ? migrate(initial) : this._load();
    if (this.options.snapshots) this._autoSnapshot();

    if (typeof window !== "undefined" && key) {
      window.addEventListener("storage", (e) => {
        if (e.key !== this.key || !e.newValue) return;
        this.state = migrate(parse(e.newValue));
        this.emit({ source: "other-tab" });
      });
      window.addEventListener("pagehide", () => this.flush());
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") this.flush();
      });
    }
  }

  _load() {
    const text = read(this.key);
    const raw = parse(text);
    const state = migrate(raw);
    if (!state.updatedAt) state.updatedAt = Date.now();
    if (raw && raw.schema !== SCHEMA) {
      if (this.options.snapshots) {
        // First open after the update: keep the untouched old save, and a restore point.
        if (read(PRE_UPDATE_KEY) == null) write(PRE_UPDATE_KEY, text);
        this._pendingSnapshot = "Before the update";
      }
      this.state = state;
      this.saveNow();
    }
    return state;
  }

  /* ----- events ----- */

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(info = {}) {
    for (const fn of this.listeners) fn(info);
  }

  /* ----- saving ----- */

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.saveNow(), 150);
  }

  saveNow() {
    clearTimeout(this._timer);
    this._timer = null;
    if (!this.key) return;
    const ok = write(this.key, JSON.stringify(this.state));
    if (ok !== this.saveError) return; // only announce when saving starts or stops working
    this.saveError = !ok;
    this.emit({ source: "save-status" });
  }

  flush() {
    if (this._timer) this.saveNow();
  }

  /**
   * Run a change. `fn` mutates the state; return false from it to cancel.
   * Every change is saved, announced to listeners, and (if enabled) undoable.
   * With `coalesce`, quick repeats of the same change (typing a name) share one undo step.
   */
  transact(label, fn, { source = null, undoable = true, coalesce = false } = {}) {
    if (this.readOnly) return false;
    if (this._batch) {
      if (fn(this.state) === false) return false;
      this._batch.changed = true;
      return true;
    }
    const now = Date.now();
    const last = this.undoStack[this.undoStack.length - 1];
    const merge = coalesce && last && last.label === label && last.key === coalesce && now - last.t < COALESCE_MS;
    const before = this.options.undo && undoable && !merge ? JSON.stringify(this.state) : null;
    if (fn(this.state) === false) return false;
    this.state.updatedAt = now;
    if (merge) {
      last.t = now;
      this.redoStack = [];
    } else if (before) {
      this.undoStack.push({ label, before, t: now, key: coalesce || null });
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
      this.redoStack = [];
    }
    this.save();
    this.emit({ source, label });
    return true;
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  undoLabel() { return this.undoStack[this.undoStack.length - 1]?.label || null; }
  redoLabel() { return this.redoStack[this.redoStack.length - 1]?.label || null; }

  /** Undo and redo change the map, never the friends key or backup date. */
  _swap(json) {
    const next = migrate(JSON.parse(json));
    next.account = this.state.account;
    next.meta = { ...this.state.meta };
    this.state = next;
  }

  undo() {
    const step = this.undoStack.pop();
    if (!step) return null;
    this.redoStack.push({ label: step.label, before: JSON.stringify(this.state) });
    this._swap(step.before);
    this.save();
    this.emit({ source: "undo", label: step.label });
    return step.label;
  }

  redo() {
    const step = this.redoStack.pop();
    if (!step) return null;
    this.undoStack.push({ label: step.label, before: JSON.stringify(this.state) });
    this._swap(step.before);
    this.save();
    this.emit({ source: "redo", label: step.label });
    return step.label;
  }

  /* ----- reading ----- */

  pref(name) { return this.state.prefs[name]; }
  ing(id) { return this.state.ingredients.find((i) => i.id === id); }
  ingIndex(id) {
    const i = this.state.ingredients.findIndex((x) => x.id === id);
    return i < 0 ? 99 : i;
  }
  ingColor(id) { return this.ing(id)?.color || "#999999"; }
  level(key, stance = "regular") { return this.state.levels[levelKey(key, stance)] || 0; }
  autoName(key, stance = "regular") { return autoName(key, stance, this.state.ingredients); }
  name(key, stance = "regular") { return this.state.names[key] || this.autoName(key, stance); }

  autoSide(key) {
    const recipe = parseKey(key);
    let sun = 0;
    let moon = 0;
    for (const id in recipe) {
      const side = this.ing(id)?.side;
      if (side === "sun") sun += recipe[id];
      if (side === "moon") moon += recipe[id];
    }
    return sun && !moon ? "sun" : moon && !sun ? "moon" : "earth";
  }

  side(key) { return this.state.sides[key] || this.autoSide(key); }

  /** The trick's color: the average of its ingredient colors. */
  color(key) {
    const units = unitList(parseKey(key), this.state.ingredients);
    if (!units.length) return BASE_COLOR;
    const sum = [0, 0, 0];
    for (const id of units) {
      const n = parseInt(this.ingColor(id).slice(1), 16);
      sum[0] += (n >> 16) & 255;
      sum[1] += (n >> 8) & 255;
      sum[2] += n & 255;
    }
    return "#" + sum.map((v) => Math.round(v / units.length).toString(16).padStart(2, "0")).join("");
  }

  isAddonOnly(key) {
    const ids = Object.keys(parseKey(key));
    return ids.length > 0 && ids.every((id) => this.ing(id)?.addon);
  }

  isCatalog(key) { return CATALOG.includes(key); }

  /** Every "Want it" across all stances, as { key, stance }. */
  wants() {
    return Object.keys(this.state.levels)
      .filter((lk) => this.state.levels[lk] === 1)
      .map(splitLevelKey);
  }

  feet(key, stance = "regular") {
    return this.state.feet[levelKey(key, stance)] || defaultFeet(key, stance);
  }

  /* ----- changing tricks ----- */

  /** Returns { ok: true } or { ok: false, reason: "want-limit", wants } when 3 wants are taken. */
  setLevel(key, stance, value) {
    if (this.readOnly) return { ok: false, reason: "read-only" };
    const lk = levelKey(key, stance);
    const current = this.state.levels[lk] || 0;
    if (value === current) return { ok: true, changed: false };
    if (value === 1 && this.wants().length >= WANT_LIMIT) return { ok: false, reason: "want-limit", wants: this.wants() };
    this.transact(`${this.name(key, stance)}: ${LEVELS[value]}`, (s) => {
      if (value) s.levels[lk] = value;
      else delete s.levels[lk];
      s.history.push({ t: Date.now(), k: key, st: stance, from: current, to: value });
      if (s.history.length > MAX_HISTORY) s.history.splice(0, s.history.length - MAX_HISTORY);
    });
    return { ok: true, changed: true };
  }

  setSide(key, side) {
    this.transact(`${this.name(key)} to ${SIDES[side]}`, (s) => {
      if (side === this.autoSide(key)) delete s.sides[key];
      else s.sides[key] = side;
      delete s.positions[key];
    });
  }

  /**
   * Drop dragged tricks at new map positions. `moves` is [{ key, x, y, zone }].
   * The first drag in Auto layout switches to Custom and pins every trick
   * (`autoPositions`) where it was, so nothing jumps.
   */
  dropTricks(moves, autoPositions = {}, { label = null, coalesce = false } = {}) {
    const zoneChanges = [];
    label = label || (moves.length === 1 ? `Move ${this.name(moves[0].key)}` : `Move ${moves.length} tricks`);
    this.transact(label, (s) => {
      if (s.prefs.layout !== "custom") {
        s.prefs.layout = "custom";
        for (const k in autoPositions) if (!s.positions[k]) s.positions[k] = { ...autoPositions[k] };
      }
      for (const { key, x, y, zone } of moves) {
        s.positions[key] = { x: Math.round(x), y: Math.round(y) };
        if (zone && zone !== this.side(key)) {
          s.sides[key] = zone;
          zoneChanges.push({ key, zone });
        }
        if (zone && zone === this.autoSide(key) && s.sides[key] === zone) delete s.sides[key];
      }
    }, { coalesce });
    return zoneChanges;
  }

  resetPosition(key) {
    this.transact(`Reset ${this.name(key)} position`, (s) => {
      if (!(key in s.positions)) return false;
      delete s.positions[key];
    });
  }

  rename(key, value, opts = {}) {
    const v = String(value).trim().slice(0, 60);
    this.transact(`Rename ${this.autoName(key)}`, (s) => {
      if ((s.names[key] || "") === (v && v !== this.autoName(key) ? v : "")) return false;
      if (v && v !== this.autoName(key)) s.names[key] = v;
      else delete s.names[key];
    }, { coalesce: `name:${key}`, ...opts });
  }

  /** Make sure a trick built in the breakdown shows on the map. */
  ensureTrick(key) {
    this.transact("Add trick", (s) => {
      let changed = false;
      if (key && !CATALOG.includes(key) && !s.custom.includes(key)) { s.custom.push(key); changed = true; }
      if (s.hidden.includes(key)) { s.hidden = s.hidden.filter((k) => k !== key); changed = true; }
      return changed ? undefined : false;
    }, { undoable: false });
  }

  removeTrick(key) {
    this.transact(`Remove ${this.name(key)}`, (s) => {
      if (s.custom.includes(key)) s.custom = s.custom.filter((k) => k !== key);
      else if (!s.hidden.includes(key)) s.hidden.push(key);
      delete s.positions[key];
      for (const st of STANCES) delete s.levels[levelKey(key, st)];
    });
  }

  setFeet(key, stance, feet, opts = {}) {
    this.transact("Move feet", (s) => { s.feet[levelKey(key, stance)] = clone(feet); }, { coalesce: `feet:${levelKey(key, stance)}`, ...opts });
  }

  resetFeet(key, stance) {
    this.transact("Reset feet", (s) => {
      const lk = levelKey(key, stance);
      if (!(lk in s.feet)) return false;
      delete s.feet[lk];
    });
  }

  setPref(name, value) {
    if (!PREF_VALUES[name]?.includes(value)) return;
    this.transact(`Set ${name}`, (s) => {
      if (s.prefs[name] === value) return false;
      s.prefs[name] = value;
    }, { undoable: name !== "view" });
  }

  /* ----- ingredients and colors ----- */

  updateIngredient(id, patch, opts = {}) {
    this.transact("Edit ingredient", (s) => {
      const ing = s.ingredients.find((i) => i.id === id);
      if (!ing) return false;
      if (typeof patch.name === "string") ing.name = patch.name.slice(0, 60) || "Untitled";
      if (isHex(patch.color)) ing.color = patch.color.toLowerCase();
      if (SIDES[patch.side]) ing.side = patch.side;
    }, { coalesce: `ing:${id}:${Object.keys(patch).join()}`, ...opts });
  }

  addIngredient() {
    const id = "c" + Date.now().toString(36);
    const color = "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
    this.transact("Add ingredient", (s) => { s.ingredients.push({ id, name: "New ingredient", color, side: "earth" }); });
    return id;
  }

  deleteIngredient(id) {
    this.transact("Delete ingredient", (s) => {
      const ing = s.ingredients.find((i) => i.id === id);
      if (!ing || ing.builtin) return false;
      s.ingredients = s.ingredients.filter((i) => i.id !== id);
      s.custom = s.custom.filter((k) => !(id in parseKey(k)));
    });
  }

  setSideColor(side, color, opts = {}) {
    if (!SIDES[side] || !isHex(color)) return;
    this.transact("Side color", (s) => { s.sideColors[side] = color.toLowerCase(); }, { coalesce: `side:${side}`, ...opts });
  }

  /** Friends: the friend code and private key for this map (null turns friends off). */
  setAccount(account) {
    this.transact("Friends", (s) => {
      s.account = account ? { code: account.code, key: account.key } : null;
    }, { undoable: false, source: "account" });
  }

  setProfile(patch, opts = {}) {
    this.transact("Profile", (s) => {
      if (typeof patch.name === "string") s.profile.name = patch.name.slice(0, 40);
      if (typeof patch.handle === "string") s.profile.handle = patch.handle.slice(0, 40);
    }, { coalesce: `profile:${Object.keys(patch).join()}`, ...opts });
  }

  /** Apply several changes as one step: one save, one announcement, one undo. */
  batch(label, fn) {
    if (this._batch) return fn(this);
    const before = this.options.undo ? JSON.stringify(this.state) : null;
    this._batch = { changed: false };
    let result;
    try { result = fn(this); } finally {
      const { changed } = this._batch;
      this._batch = null;
      if (changed) {
        this.state.updatedAt = Date.now();
        if (before) {
          this.undoStack.push({ label, before, t: Date.now(), key: null });
          if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
          this.redoStack = [];
        }
        this.save();
        this.emit({ source: "batch", label });
      }
    }
    return result;
  }

  /* ----- restore points and backups ----- */

  snapshots() {
    const list = parse(read(SNAPSHOT_KEY));
    return Array.isArray(list) ? list.filter((x) => isObj(x) && typeof x.data === "string") : [];
  }

  takeSnapshot(reason) {
    if (!this.options.snapshots) return;
    const list = this.snapshots();
    const data = JSON.stringify(this.state);
    if (list[0] && list[0].data === data) return;
    list.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t: Date.now(), reason, data });
    while (list.length > MAX_SNAPSHOTS) list.pop();
    // If storage is full, drop the oldest points until it fits.
    while (!write(SNAPSHOT_KEY, JSON.stringify(list)) && list.length > 1) list.pop();
  }

  _autoSnapshot() {
    if (this._pendingSnapshot) {
      this.takeSnapshot(this._pendingSnapshot);
      this._pendingSnapshot = null;
      return;
    }
    const latest = this.snapshots()[0];
    if (!latest || Date.now() - latest.t > SNAPSHOT_EVERY) this.takeSnapshot("Automatic");
  }

  restoreSnapshot(id) {
    const snap = this.snapshots().find((x) => x.id === id);
    if (!snap) return false;
    this.replaceState(parse(snap.data), "Before restoring an earlier version");
    return true;
  }

  /** Replace everything (restore). The current map is kept as a restore point first. */
  replaceState(next, reason = "Before restoring a backup") {
    this.takeSnapshot(reason);
    const { lastBackup } = this.state.meta;
    const { account } = this.state;
    this.state = migrate(next);
    this.state.meta.lastBackup = this.state.meta.lastBackup || lastBackup;
    // A backup from another phone brings its friends key along; an older restore point keeps this one.
    this.state.account = this.state.account || account;
    this.state.updatedAt = Date.now();
    this.undoStack = [];
    this.redoStack = [];
    this.saveNow();
    this.emit({ source: "restore" });
  }

  exportBackup() {
    return backupFile(this.state);
  }

  markBackedUp() {
    this.state.meta.lastBackup = Date.now();
    this.saveNow();
    this.emit({ source: "backup" });
  }

  /** True when there's progress worth protecting and no recent backup. */
  needsBackup() {
    const rated = Object.keys(this.state.levels).length + Object.keys(this.state.positions).length;
    if (rated < 3) return false;
    const last = this.state.meta.lastBackup;
    return !last || Date.now() - last > 14 * 24 * 3600 * 1000;
  }
}
