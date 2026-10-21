// Builds the map: which tricks show, how they connect, and where they sit.
//
// Map coordinates: three stacked bands (Sun, Earth, Moon), each BANDH tall.
// Columns step right by COLW for every extra ingredient. Custom positions
// saved by the user use these same coordinates.

import { CATALOG, SIDE_ORDER, parseKey, sizeOf, parentKeys, unitList } from "./catalog.js";

export const LAYOUT = Object.freeze({ COLW: 200, ROWH: 68, X0: 44, BANDPAD: 44, BANDH: 380, MAPW: 44 + 5 * 200 + 40 });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Keys that belong on the map for a stance (plus any forced in, like the open trick). */
export function mapKeys(store, stance = "regular", include = []) {
  const s = store.state;
  const keys = new Set(CATALOG.filter((k) => !s.hidden.includes(k)));
  for (const k of s.custom) keys.add(k);
  for (const lk in s.levels) {
    const i = lk.indexOf("|");
    if (lk.slice(0, i) !== stance || !s.levels[lk]) continue;
    const k = lk.slice(i + 1);
    keys.add(k === "ollie" ? "" : k);
  }
  for (const k of include) if (k != null) keys.add(k);
  for (const k of [...keys]) if (store.isAddonOnly(k)) keys.delete(k);
  return keys;
}

export function buildModel(store, { stance = "regular", filter = store.pref("filter"), include = [] } = {}) {
  const s = store.state;
  let nodes = [...mapKeys(store, stance, include)].map((k) => {
    const r = parseKey(k);
    return { k, r, fl: sizeOf(r), side: store.side(k), lv: store.level(k, stance), name: store.name(k, stance), col: store.color(k) };
  });

  if (filter === "next") {
    // Landed tricks plus everything one ingredient away from them.
    const got = new Set([""]);
    for (const n of nodes) if (n.lv >= 2) got.add(n.k);
    const forced = new Set(include);
    nodes = nodes.filter((n) => got.has(n.k) || forced.has(n.k) || parentKeys(n.k).some((p) => got.has(p)));
  }

  const map = new Map(nodes.map((n) => [n.k, n]));
  const edges = [];
  for (const n of nodes) {
    for (const p of parentKeys(n.k)) {
      const m = map.get(p);
      if (!m) continue;
      const add = Object.keys(n.r).find((id) => (n.r[id] || 0) > (m.r[id] || 0));
      edges.push({ a: m, b: n, add, c: store.ingColor(add) });
    }
  }

  const { COLW, ROWH, X0, BANDPAD, BANDH, MAPW } = LAYOUT;
  const sortKey = (n) => unitList(n.r, s.ingredients).map((id) => store.ingIndex(id)).join(".");
  const bands = {};
  let y = 0;
  for (const side of SIDE_ORDER) {
    const cols = {};
    for (const n of nodes) if (n.side === side) (cols[n.fl] = cols[n.fl] || []).push(n);
    let rows = 0;
    for (const fl in cols) {
      cols[fl].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
      rows = Math.max(rows, cols[fl].length);
    }
    // Rows squeeze together in a crowded band, so the band never grows.
    const rh = Math.min(ROWH, (BANDH - BANDPAD - 60) / Math.max(1, rows));
    for (const fl in cols) {
      cols[fl].forEach((n, i) => {
        n.ax = X0 + fl * COLW;
        n.ay = y + BANDPAD + i * rh + 12;
      });
    }
    bands[side] = { y0: y, y1: y + BANDH };
    y += BANDH;
  }

  const maxFl = Math.max(4, ...nodes.map((n) => n.fl));
  const W = Math.max(MAPW, X0 + (maxFl + 1) * COLW + 40);
  const H = y;
  const custom = s.prefs.layout === "custom";
  for (const n of nodes) {
    const p = custom && s.positions[n.k];
    n.x = clamp(p ? p.x : n.ax, 14, W - 14);
    n.y = clamp(p ? p.y : n.ay, 14, H - 14);
  }
  return { nodes, map, edges, bands, W, H, maxFl, stance };
}

export function bandAt(M, y) {
  for (const side of SIDE_ORDER) if (y >= M.bands[side].y0 && y < M.bands[side].y1) return side;
  return y < 0 ? "sun" : "moon";
}

/** Auto positions of every node, used to pin the layout on the first drag. */
export function autoPositions(M) {
  const out = {};
  for (const n of M.nodes) out[n.k] = { x: Math.round(n.ax), y: Math.round(n.ay) };
  return out;
}

/** Best path from the ollie to a trick, preferring parents you've landed. */
export function routeTo(M, key) {
  const path = [];
  let n = M.map.get(key);
  let guard = 0;
  while (n && guard++ < 12) {
    path.unshift(n);
    if (n.k === "") break;
    const parents = parentKeys(n.k).map((p) => M.map.get(p)).filter(Boolean);
    parents.sort((a, b) => b.lv - a.lv || a.fl - b.fl);
    n = parents[0];
  }
  return path;
}
