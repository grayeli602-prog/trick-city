// Test 4 · Spatial: the map is the whole app. More detail appears as you
// zoom in, tapping a trick flies to it and lights its path from the ollie,
// a minimap shows where you are, and stance layers flip the whole map.

import { labStore, mountLabBar, makeToast, prefsHtml, bindPrefs, featureList, bindPicks, confirmReset, haptic, PHONE } from "./lab.js";
import { MapView } from "../js/app/mapview.js";
import { LevelPicker } from "../js/app/levelpicker.js";
import { Breakdown } from "../js/app/breakdown.js";
import { Sheet } from "../js/app/sheet.js";
import { routeTo } from "../js/core/model.js";
import { SIDES, SIDE_ORDER, STANCES, STANCE_LABEL, STANCE_SHORT, LEVELS, unitList } from "../js/core/catalog.js";
import { esc, dotSvg, orbSvg, tone, edgePath, BAND_FILL } from "../js/core/draw.js";

const store = labStore("spatial");
const $ = (sel, root = document) => root.querySelector(sel);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const toast = makeToast($("#toast"));
mountLabBar($("#labBar"), store);

/* ---------- state ---------- */

let stance = "regular";
let target = null;
let pathKeys = new Set();
let pathEdges = new Set();
let tier = -1;

// Semantic zoom: how much shows depends on how big the map is on screen.
const TIERS = ["Overview", "Tricks", "Names", "Detail"];
const STEPS = [0.32, 0.6, 1.15];
const effScale = () => map.base.sx * map.cam.z;
const tierOf = () => STEPS.filter((s) => effScale() >= s).length;

/* ---------- map ---------- */

const picker = new LevelPicker(store, { hoverMode: !PHONE, toast });

function stanceDots(key, bottom) {
  return STANCES.map((st, i) => {
    const lv = store.level(key, st);
    const x = (i - 1.5) * 11;
    const y = bottom + 8;
    const shape = lv === 0
      ? `<circle r="3" fill="none" stroke="var(--faint)" stroke-width="1.1" stroke-dasharray="1.5 1.5"/>`
      : lv === 1 ? `<circle r="3" fill="none" stroke="var(--fg)" stroke-width="1.2"/>`
        : lv === 2 ? `<circle r="3.2" fill="var(--fg)"/>`
          : `<circle r="4.6" fill="none" stroke="var(--fg)" stroke-width="1"/><circle r="2.8" fill="var(--fg)"/>`;
    return `<g transform="translate(${x},${y})"${st === stance ? "" : ` opacity=".75"`}><title>${STANCE_LABEL[st]}: ${LEVELS[lv]}</title>${shape}</g>`;
  }).join("");
}

const map = new MapView($("#map"), store, {
  projection: "contain",
  wheelZoom: true,
  emptyDrag: "pan",
  inertia: true,
  minZoom: 0.7,
  maxZoom: PHONE ? 7 : 4.5,
  doubleTapEmpty: "zoom",
  focusY: PHONE ? 0.36 : 0.42,
  stance,
  include: () => (target !== null ? [target] : []),
  selection: () => (target !== null ? new Set([target]) : null),
  decorate: (n) => {
    const t = tier < 0 ? tierOf() : tier;
    const on = pathKeys.has(n.k);
    const d = {};
    if (target !== null && !on) d.dim = 0.22;
    if (t === 0) d.hideLabel = !on;
    else if (t === 1) d.hideLabel = !(n.lv >= 1 || on);
    if (t >= 3) {
      const units = unitList(n.r, store.state.ingredients);
      const palette = store.pref("palette");
      d.extra = units.map((id, i) => `<circle cx="${(i - (units.length - 1) / 2) * 7}" cy="-17" r="2.6" fill="${tone(store.ingColor(id), palette)}"/>`).join("");
      d.labelExtra = ({ bottom }) => stanceDots(n.k, bottom);
    }
    return d;
  },
  edgeStyle: (e) => {
    if (target === null) return null;
    return pathEdges.has(`${e.a.k}>${e.b.k}`) ? { opacity: 1, width: 3.4, glow: true } : { opacity: 0.08 };
  },
  onTap: (key) => select(key),
  onTapEmpty: () => { if (target !== null) clear(); },
  onGestureStart: () => picker.hide(),
  onZoneChange: (changes) => toast(`<b>${esc(store.name(changes[0].key, stance))}</b> moved to ${SIDES[changes[0].zone]}`),
  onCamera: () => {
    updateViewport();
    const t = tierOf();
    if (t !== tier && !map.g) {
      cancelAnimationFrame(tierRaf);
      tierRaf = requestAnimationFrame(() => map.render());
    }
  },
  onRender: (M) => {
    tier = tierOf();
    paintTier();
    paintBandLabels(M);
    renderMini(M);
  },
  ...(PHONE
    ? { onLongPress: (key, anchor) => { haptic(10); picker.show(key, stance, anchor, { showStance: stance !== "regular" }); } }
    : { onHover: (key, anchor) => picker.show(key, stance, anchor, { showStance: stance !== "regular" }), onHoverEnd: () => picker.scheduleHide(300) }),
});
let tierRaf = 0;

function paintTier() {
  $("#tier").innerHTML = TIERS.map((t, i) => `<span class="${i === tier ? "on" : ""}">${t}</span>`).join("");
}

/** In the overview, band labels also carry how much of the zone is locked in. */
function paintBandLabels(M) {
  for (const g of map.svg.querySelectorAll("[data-bandlabel]")) {
    const side = g.dataset.bandlabel;
    const text = g.querySelector("text");
    const nodes = M.nodes.filter((n) => n.side === side);
    const locked = nodes.filter((n) => n.lv === 3).length;
    text.textContent = tier <= 1 ? `${SIDES[side].toUpperCase()} · ${locked}/${nodes.length} LOCKED IN` : SIDES[side].toUpperCase();
    text.setAttribute("font-size", tier === 0 ? "11" : "9.5");
  }
}

/* ---------- selecting a trick: fly there, light the path ---------- */

function setPath(key) {
  const M = map.M;
  const route = key !== null && M ? routeTo(M, key) : [];
  pathKeys = new Set(route.map((n) => n.k));
  pathEdges = new Set();
  for (let i = 1; i < route.length; i++) pathEdges.add(`${route[i - 1].k}>${route[i].k}`);
  return route;
}

function select(key, { fly = true } = {}) {
  picker.hide();
  target = key;
  setPath(key);
  map.render();
  setPath(key); // the model may have changed with the trick included
  map.render();
  if (fly) {
    const z = Math.max(map.cam.z, clamp(0.95 / map.base.sx, map.o.minZoom, map.o.maxZoom));
    map.focusOn(key, z);
  }
  renderCard();
  haptic(6);
}

function clear() {
  target = null;
  pathKeys = new Set();
  pathEdges = new Set();
  map.render();
  renderCard();
}

const card = $("#card");
function renderCard() {
  document.body.classList.toggle("carded", target !== null);
  if (target === null) {
    card.hidden = true;
    return;
  }
  const M = map.M;
  const n = M?.map.get(target);
  if (!n) {
    card.hidden = true;
    return;
  }
  const route = routeTo(M, target);
  const palette = store.pref("palette");
  const missing = route.slice(0, -1).filter((x) => x.k !== "" && x.lv < 2);
  card.hidden = false;
  card.innerHTML = `
    <div class="sp-card-top">
      <svg class="o" width="38" height="38" viewBox="-19 -19 38 38" aria-hidden="true">${orbSvg(n.lv, tone(n.col, palette), palette)}</svg>
      <div class="t"><b>${esc(n.name)}</b><span>${LEVELS[n.lv]} · ${SIDES[n.side]} · ${STANCE_LABEL[stance]}</span></div>
      <button class="x" type="button" data-clear aria-label="Clear">×</button>
    </div>
    <div class="sp-path" aria-label="Path from the ollie">${route.map((x, i) => `${i ? "<i>→</i>" : ""}<button type="button" data-fly="${esc(x.k)}" class="${x.k === target ? "here" : x.lv < 2 && x.k !== "" ? "miss" : ""}">${esc(x.name)}</button>`).join("")}</div>
    ${missing.length ? `<p class="warn">Fundamentals first: ${missing.map((x) => esc(x.name)).join(" and ")} ${missing.length > 1 ? "aren't" : "isn't"} landed yet.</p>` : ""}
    <div class="row"><button class="btn primary" type="button" data-open>Open breakdown</button><span class="hint" style="align-self:center">${PHONE ? "Hold an orb to set its level" : "Hover an orb to set its level"}</span></div>`;
}
card.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.hasAttribute("data-clear")) clear();
  else if (t.dataset.fly !== undefined) {
    if (t.dataset.fly === target) map.focusOn(target, map.cam.z);
    else select(t.dataset.fly);
  } else if (t.hasAttribute("data-open")) openBreakdown(target);
});

/* ---------- breakdown sheet ---------- */

const sheet = new Sheet({ label: "Trick breakdown" });
const breakdown = new Breakdown(store, {
  onNavigate: (key) => {
    select(key);
    openBreakdown(key);
  },
  onClose: () => sheet.close(),
  toast,
});
sheet.body.append(breakdown.el);
function openBreakdown(key) {
  picker.hide();
  breakdown.stance = stance;
  breakdown.render(key);
  sheet.open();
  sheet.el.scrollTop = 0;
}

/* ---------- minimap ---------- */

const mini = $("#mini");
let miniBox = null;

function renderMini(M) {
  const b = map.base;
  const x0 = b.x0 - 40;
  const w = b.x1 - b.x0 + 120;
  const h = M.H;
  miniBox = { x0, w, h };
  const palette = store.pref("palette");
  let s = `<svg viewBox="${x0} 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">`;
  for (const side of SIDE_ORDER) s += `<rect x="${x0}" y="${M.bands[side].y0}" width="${w}" height="${M.bands[side].y1 - M.bands[side].y0}" fill="${BAND_FILL[side]}"/>`;
  for (const e of M.edges) {
    const lit = pathEdges.has(`${e.a.k}>${e.b.k}`);
    s += `<path d="${edgePath(e.a, e.b)}" fill="none" stroke="${lit ? "var(--fg)" : tone(e.c, palette)}" stroke-width="${lit ? 2.2 : 1}" opacity="${target !== null && !lit ? 0.25 : 0.7}" vector-effect="non-scaling-stroke"/>`;
  }
  for (const n of M.nodes) {
    const fill = n.lv >= 2 ? "var(--fg)" : n.lv === 1 ? "var(--muted)" : "var(--faint)";
    s += `<circle cx="${n.x}" cy="${n.y}" r="${n.k === target ? 16 : 9}" fill="${n.k === target ? "none" : fill}" ${n.k === target ? `stroke="var(--fg)" stroke-width="2" vector-effect="non-scaling-stroke"` : ""}/>`;
  }
  s += `<rect class="vp" rx="6" vector-effect="non-scaling-stroke"/></svg>`;
  mini.innerHTML = s;
  updateViewport();
}

function updateViewport() {
  const vp = mini.querySelector(".vp");
  if (!vp || !miniBox) return;
  const a = map.toWorld(0, 0);
  const c = map.toWorld(map.base.vw, map.base.vh);
  const x = clamp(a.x, miniBox.x0, miniBox.x0 + miniBox.w);
  const y = clamp(a.y, 0, miniBox.h);
  const x2 = clamp(c.x, miniBox.x0, miniBox.x0 + miniBox.w);
  const y2 = clamp(c.y, 0, miniBox.h);
  vp.setAttribute("x", x);
  vp.setAttribute("y", y);
  vp.setAttribute("width", Math.max(4, x2 - x));
  vp.setAttribute("height", Math.max(4, y2 - y));
}

function miniPoint(e) {
  const svg = mini.querySelector("svg");
  const r = svg.getBoundingClientRect();
  // preserveAspectRatio meet: work out the drawn area inside the element.
  const k = Math.min(r.width / miniBox.w, r.height / miniBox.h);
  const ox = (r.width - miniBox.w * k) / 2;
  const oy = (r.height - miniBox.h * k) / 2;
  return { x: miniBox.x0 + (e.clientX - r.left - ox) / k, y: (e.clientY - r.top - oy) / k };
}

let miniDrag = null;
mini.addEventListener("pointerdown", (e) => {
  if (!miniBox) return;
  e.preventDefault();
  mini.setPointerCapture(e.pointerId);
  miniDrag = { moved: false, x: e.clientX, y: e.clientY };
});
mini.addEventListener("pointermove", (e) => {
  if (!miniDrag) return;
  if (!miniDrag.moved && Math.hypot(e.clientX - miniDrag.x, e.clientY - miniDrag.y) < 4) return;
  miniDrag.moved = true;
  const p = miniPoint(e);
  map.centerOn(p.x, p.y);
});
mini.addEventListener("pointerup", (e) => {
  if (!miniDrag) return;
  const moved = miniDrag.moved;
  miniDrag = null;
  if (!moved) {
    const p = miniPoint(e);
    map.centerOn(p.x, p.y, map.cam.z, 380);
  }
});
mini.addEventListener("pointercancel", () => { miniDrag = null; });

/* ---------- zoom buttons, stance layers, prefs ---------- */

$(".sp-zoom").addEventListener("click", (e) => {
  const b = e.target.closest("[data-z]");
  if (!b) return;
  if (b.dataset.z === "fit") {
    map.resetCamera();
    return;
  }
  const z = clamp(map.cam.z * (b.dataset.z === "in" ? 1.5 : 1 / 1.5), map.o.minZoom, map.o.maxZoom);
  const cx = map.base.vw / 2;
  const cy = map.base.vh / 2;
  const k = z / map.cam.z;
  map.animateTo({ z, tx: cx - (cx - map.cam.tx) * k, ty: cy - (cy - map.cam.ty) * k }, 280);
});

const layers = $("#layers");
function renderLayers() {
  layers.innerHTML = STANCES.map((st) => `<button type="button" role="tab" data-layer="${st}" aria-selected="${st === stance}" title="${STANCE_LABEL[st]} layer">${STANCE_SHORT[st].slice(0, 1)}${PHONE ? "" : STANCE_SHORT[st].slice(1, st === "regular" ? 3 : 6)}</button>`).join("");
}
layers.addEventListener("click", (e) => {
  const b = e.target.closest("[data-layer]");
  if (!b || b.dataset.layer === stance) return;
  stance = b.dataset.layer;
  map.o.stance = stance;
  breakdown.stance = stance;
  picker.hide();
  renderLayers();
  const el = $("#map");
  el.classList.remove("swap");
  void el.offsetWidth;
  el.classList.add("swap");
  if (target !== null) setPath(target);
  map.render();
  if (target !== null) {
    setPath(target);
    map.render();
  }
  renderCard();
  haptic(8);
  toast(`<b>${STANCE_LABEL[stance]}</b> layer`);
});

const gear = $("#gear");
const prefs = $("#prefs");
function renderPrefs() {
  prefs.innerHTML = `<div class="mono">Display</div>${prefsHtml(store)}
    <div class="mono" style="margin-top:4px">Keep from this version</div>${featureList("spatial", { compact: true })}
    <div class="lab-mrow"><a class="btn" href="./">All test versions</a><button class="btn" type="button" data-reset>Fresh copy of my map</button></div>`;
}
gear.addEventListener("click", () => {
  const open = prefs.hidden;
  prefs.hidden = !open;
  gear.setAttribute("aria-expanded", String(open));
  if (open) renderPrefs();
});
bindPrefs(prefs, store);
bindPicks(prefs);
prefs.addEventListener("click", (e) => { if (e.target.closest("[data-reset]")) confirmReset(store); });
document.addEventListener("pointerdown", (e) => {
  if (!prefs.hidden && !prefs.contains(e.target) && !gear.contains(e.target)) {
    prefs.hidden = true;
    gear.setAttribute("aria-expanded", "false");
  }
});

/* ---------- keyboard ---------- */

document.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, textarea, select")) return;
  if (e.key === "Escape") {
    if (sheet.isOpen) sheet.close();
    else if (target !== null) clear();
  } else if (e.key === "+" || e.key === "=") $('[data-z="in"]').click();
  else if (e.key === "-") $('[data-z="out"]').click();
  else if (e.key === "0") map.resetCamera();
  else if (e.key.startsWith("Arrow")) {
    e.preventDefault();
    const d = 80;
    map.setCamera({
      tx: map.cam.tx + (e.key === "ArrowLeft" ? d : e.key === "ArrowRight" ? -d : 0),
      ty: map.cam.ty + (e.key === "ArrowUp" ? d : e.key === "ArrowDown" ? -d : 0),
      z: map.cam.z,
    }, 200);
  }
});

/* ---------- start ---------- */

store.subscribe((info) => {
  if (target !== null && !(info.source === "name" || info.source === "feet")) setPath(target);
  map.render();
  if (target !== null) {
    setPath(target);
    map.render();
  }
  renderCard();
  if (!prefs.hidden && info.source !== "lab-picks") renderPrefs();
});

renderLayers();
map.render();
// On a phone, start zoomed in so the map fills the screen; the whole map is one tap away (fit).
if (PHONE && map.M) {
  const M = map.M;
  const z = clamp((map.base.vh * 0.9) / (M.H * map.base.sy), 1, map.o.maxZoom);
  const left = map.base.x0 * map.base.sx + map.base.ox;
  map.setCamera({ z, tx: 14 - left * z, ty: (map.base.vh - M.H * map.base.sy * z) / 2 - map.base.oy * z });
  map.render();
}
