// Trick Map app: search, undo and redo with a history list, filters, box
// select and move many at once, an inspector with levels and foot placement,
// align and spread, keyboard shortcuts, settings with backups, a share sheet,
// and friends (see each other's maps, view only).

import { createStore, requestPersistence } from "../core/store.js";
import { buildModel, bandAt, autoPositions, mapKeys } from "../core/model.js";
import { SIDES, SIDE_ORDER, STANCES, STANCE_LABEL, STANCE_SHORT, LEVELS, WANT_LIMIT, CATALOG, parseKey, parentKeys, depthOf } from "../core/catalog.js";
import { esc, dotSvg, bandIconSvg, gray, ingredientCount } from "../core/draw.js";
import { MapView } from "./mapview.js";
import { GridView } from "./grid.js";
import { LevelPicker } from "./levelpicker.js";
import { Breakdown } from "./breakdown.js";
import { Sheet } from "./sheet.js";
import { Settings } from "./settings.js";
import { IngredientsEditor } from "./ingredients.js";
import { ShareSheet } from "./share.js";
import { FeetEditor } from "./feet.js";
import { FriendsClient, FriendView, FriendsSheet } from "./friends.js";

const PHONE = document.documentElement.classList.contains("phone");
const $ = (sel, root = document) => root.querySelector(sel);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
const MOD = MAC ? "⌘" : "Ctrl ";
const compactQuery = matchMedia("(max-width: 1000px)");
let compact = PHONE || compactQuery.matches;

const store = createStore({ undo: true });
requestPersistence();

// The test versions are gone; clear their copies of the map off this device.
try {
  for (const k of Object.keys(localStorage)) if (k.startsWith("trickmap.lab.")) localStorage.removeItem(k);
} catch { /* storage unavailable */ }

$("#searchKbd").textContent = MAC ? "⌘K" : "Ctrl K";

/* ---------- toast ---------- */

const toastEl = $("#toast");
let toastTimer = 0;
function toast(html, ms = 4200) {
  toastEl.innerHTML = html;
  toastEl.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("on"), ms);
}

/* ---------- state ---------- */

let sel = new Set();
let stance = "regular";
let view = "map";
let selectMode = false;
let spaceHeld = false;
let M = null;
const filter = { sides: new Set(), levels: new Set() };
const filterOn = () => filter.sides.size > 0 || filter.levels.size > 0;
const passes = (n) => (!filter.sides.size || filter.sides.has(n.side)) && (!filter.levels.size || filter.levels.has(n.lv));

const PRESETS = [
  ["all", "All", [], []],
  ["wants", "Wants", [], [1]],
  ["open", "Not landed", [], [0, 1]],
  ["got", "Landed", [], [2, 3]],
  ["sun", "Sun", ["sun"], []],
  ["moon", "Moon", ["moon"], []],
];
const sameSet = (set, arr) => set.size === arr.length && arr.every((v) => set.has(v));
const presetOn = ([, , sides, levels]) => sameSet(filter.sides, sides) && sameSet(filter.levels, levels);
function applyPreset(id) {
  const p = PRESETS.find((x) => x[0] === id);
  filter.sides = new Set(p[2]);
  filter.levels = new Set(p[3]);
  render();
}

/* ---------- map, grid, level picker ---------- */

const picker = new LevelPicker(store, { hoverMode: !PHONE, toast });

const map = new MapView($("#map"), store, {
  // Stretched to fill the screen on phones; uniform scale on PC.
  projection: PHONE ? "fit" : "contain",
  minZoom: PHONE ? 1 : 0.6,
  maxZoom: 5,
  doubleTapEmpty: PHONE ? "reset" : null,
  stance,
  emptyDrag: (type) => (type === "mouse" ? (spaceHeld ? "pan" : "marquee") : selectMode ? "marquee" : "none"),
  include: () => [...sel],
  selection: () => sel,
  decorate: (n) => {
    const on = sel.has(n.k);
    return {
      ring: false,
      strong: on,
      dim: filterOn() && !passes(n) ? 0.13 : null,
      extra: on ? `<circle class="px-selring" r="13.5"/>` : "",
    };
  },
  edgeStyle: (e) => (filterOn() && !(passes(e.a) && passes(e.b)) ? { opacity: 0.05 } : null),
  onTap: (key, e) => {
    picker.hide();
    if (selectMode || e?.shiftKey || e?.metaKey || e?.ctrlKey) {
      const next = new Set(sel);
      next.has(key) ? next.delete(key) : next.add(key);
      setSel([...next]);
    } else setSel([key]);
  },
  onTapEmpty: () => { if (!selectMode && sel.size) setSel([]); },
  onMarquee: (keys, additive) => setSel(additive || selectMode ? [...sel, ...keys] : keys),
  onGestureStart: () => picker.hide(),
  onZoneChange: (changes) => zoneToast(changes),
  onCamera: () => updateZoom(),
  onRender: (model) => { M = model; },
  ...(PHONE
    ? { onLongPress: (key, anchor) => picker.show(key, stance, anchor, { showStance: stance !== "regular" }) }
    : {
        onHover: (key, anchor) => picker.show(key, stance, anchor, { showStance: stance !== "regular" }),
        onHoverEnd: () => picker.scheduleHide(300),
      }),
});

const grid = new GridView($("#grid"), store, {
  hover: !PHONE,
  include: () => [...sel],
  onOpen: (key) => setSel([key]),
  onCell: (key, st, cell) => picker.show(key, st, cell, { showStance: true }),
  onCellLeave: () => picker.scheduleHide(300),
});

function zoneToast(changes) {
  if (!changes.length) return;
  toast(changes.length === 1
    ? `<b>${esc(store.name(changes[0].key))}</b> moved to ${SIDES[changes[0].zone]}`
    : `${changes.length} tricks changed side`);
}

/* ---------- selection ---------- */

function setSel(keys, { focus = false } = {}) {
  sel = new Set(keys);
  render();
  if (focus && keys.length === 1 && view === "map") map.focusOn(keys[0], Math.max(map.cam.z, 1.7));
  if (compact) {
    // In select mode the sheet stays out of the way; the pill opens it.
    if (sel.size && !selectMode) openInspSheet();
    else if (!sel.size) inspSheet.close({ silent: true });
  }
}

const selPill = document.createElement("div");
selPill.className = "px-selpill";
selPill.hidden = true;
$("#canvas").append(selPill);
selPill.addEventListener("click", (e) => {
  if (e.target.closest("[data-clear]")) setSel([]);
  else if (e.target.closest("[data-edit]")) openInspSheet();
});
function renderSelPill() {
  selPill.hidden = !compact || !sel.size || inspSheet.isOpen;
  if (!selPill.hidden) {
    selPill.innerHTML = `<button type="button" data-edit><b>${sel.size}</b> selected · Edit</button><button type="button" data-clear aria-label="Clear selection">×</button>`;
  }
}

function pruneSel() {
  const live = mapKeys(store, stance);
  sel = new Set([...sel].filter((k) => live.has(k)));
}

const visibleKeys = () => (M ? M.nodes.filter((n) => !filterOn() || passes(n)).map((n) => n.k) : []);

/* ---------- edits ---------- */

const autoPos = () => autoPositions(M);

function nudge(dx, dy) {
  const nodes = [...sel].map((k) => M.map.get(k)).filter(Boolean);
  if (!nodes.length) return;
  const moves = nodes.map((n) => {
    const x = clamp(n.x + dx, 14, M.W - 14);
    const y = clamp(n.y + dy, 14, M.H - 14);
    return { key: n.k, x, y, zone: bandAt(M, y) };
  });
  const label = nodes.length === 1 ? `Nudge ${store.name(nodes[0].k)}` : `Nudge ${nodes.length} tricks`;
  zoneToast(store.dropTricks(moves, autoPos(), { label, coalesce: `nudge:${[...sel].sort().join()}` }));
}

const ALIGN = [
  ["left", "Align left", `<path d="M4 3v18M8 7h10M8 15h6"/>`],
  ["hcenter", "Align centers", `<path d="M12 3v18M6 7h12M8 15h8"/>`],
  ["right", "Align right", `<path d="M20 3v18M6 7h10M10 15h6"/>`],
  ["hdist", "Spread left to right", `<path d="M3 4v16M21 4v16M9 8v8M15 8v8"/>`],
  ["top", "Align tops", `<path d="M3 4h18M7 8v10M15 8v6"/>`],
  ["vcenter", "Align middles", `<path d="M3 12h18M7 6v12M15 8v8"/>`],
  ["bottom", "Align bottoms", `<path d="M3 20h18M7 6v10M15 10v6"/>`],
  ["vdist", "Spread top to bottom", `<path d="M4 3h16M4 21h16M8 9h8M8 15h8"/>`],
];

function align(kind) {
  const nodes = [...sel].map((k) => M.map.get(k)).filter(Boolean);
  if (nodes.length < 2) return;
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let pos;
  if (kind === "hdist" || kind === "vdist") {
    const axis = kind === "hdist" ? "x" : "y";
    const sorted = [...nodes].sort((a, b) => a[axis] - b[axis]);
    const lo = axis === "x" ? x0 : y0;
    const step = ((axis === "x" ? x1 : y1) - lo) / (sorted.length - 1);
    pos = new Map(sorted.map((n, i) => [n.k, axis === "x" ? { x: lo + i * step, y: n.y } : { x: n.x, y: lo + i * step }]));
  } else {
    const target = { left: x0, right: x1, hcenter: (x0 + x1) / 2, top: y0, bottom: y1, vcenter: (y0 + y1) / 2 }[kind];
    const horizontal = ["left", "right", "hcenter"].includes(kind);
    pos = new Map(nodes.map((n) => [n.k, horizontal ? { x: target, y: n.y } : { x: n.x, y: target }]));
  }
  const moves = nodes.map((n) => {
    const p = pos.get(n.k);
    return { key: n.k, x: p.x, y: p.y, zone: bandAt(M, p.y) };
  });
  const label = ALIGN.find((a) => a[0] === kind)[1];
  zoneToast(store.dropTricks(moves, autoPos(), { label: `${label} (${nodes.length})` }));
}

function removeSelected() {
  const keys = [...sel].filter((k) => k !== "");
  if (!keys.length) return;
  const label = keys.length === 1 ? `Remove ${store.name(keys[0])}` : `Remove ${keys.length} tricks`;
  store.batch(label, () => keys.forEach((k) => store.removeTrick(k)));
  sel = new Set();
  toast(`${esc(label)}. ${PHONE ? "Tap undo to bring it back." : `<b>${MOD}Z</b> to undo.`}`);
  render();
}

function setSideAll(side) {
  const keys = [...sel];
  if (keys.length === 1) store.setSide(keys[0], side);
  else store.batch(`${keys.length} tricks to ${SIDES[side]}`, () => keys.forEach((k) => store.setSide(k, side)));
}

function resetPositions() {
  const keys = [...sel].filter((k) => k in store.state.positions);
  if (!keys.length) return;
  store.batch(keys.length === 1 ? `Reset ${store.name(keys[0])} position` : `Reset ${keys.length} positions`, () => keys.forEach((k) => store.resetPosition(k)));
}

function doUndo() {
  const label = store.undo();
  if (label) toast(`Undid <b>${esc(label)}</b>`);
}
function doRedo() {
  const label = store.redo();
  if (label) toast(`Redid <b>${esc(label)}</b>`);
}

function newTrick() {
  openBreakdown("");
  toast("Start from the ollie and add ingredients.");
}

/* ---------- sheets: breakdown, ingredients, share ---------- */

const bdSheet = new Sheet({ label: "Trick breakdown" });
const breakdown = new Breakdown(store, {
  onNavigate: (key) => {
    setSel([key]);
    openBreakdown(key);
  },
  onClose: () => bdSheet.close(),
  toast,
});
bdSheet.body.append(breakdown.el);

const inspSheet = new Sheet({ label: "Inspector", onClose: () => setTimeout(renderSelPill, 340) });
const inspSheetBody = document.createElement("div");
inspSheetBody.className = "px-insp-body";
inspSheet.body.append(inspSheetBody);

const ingSheet = new Sheet({ className: "ingsheet", label: "Ingredients and colors" });
ingSheet.body.innerHTML = `<div class="sin"><div class="shead"><div><div class="mono">Settings</div><h2>Ingredients and colors</h2></div><button class="x" type="button" data-close aria-label="Close">×</button></div><div class="ing-editor"></div></div>`;
new IngredientsEditor($(".ing-editor", ingSheet.body), store);
ingSheet.body.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) ingSheet.close(); });

const share = new ShareSheet(store, { toast, phone: PHONE });

const friends = new FriendsClient(store);
const friendView = new FriendView(store, friends, { phone: PHONE, onClose: () => openFriends() });
const friendsSheet = new FriendsSheet(friends, friendView, { toast, phone: PHONE });

const sheets = [bdSheet, inspSheet, ingSheet, share.sheet, friendsSheet.sheet];
function closeSheets(except = null) {
  for (const s of sheets) if (s !== except && s.isOpen) s.close({ silent: true });
}

function openBreakdown(key) {
  picker.hide();
  closeSheets(bdSheet);
  breakdown.stance = stance;
  breakdown.render(key);
  bdSheet.open();
  bdSheet.el.scrollTop = 0;
}

function openInspSheet() {
  renderInspector();
  if (!inspSheet.isOpen) {
    closeSheets(inspSheet);
    inspSheet.open();
    inspSheet.el.scrollTop = 0;
  }
  selPill.hidden = true;
}

function openIngredients() {
  closeSheets(ingSheet);
  ingSheet.open();
  ingSheet.el.scrollTop = 0;
}

function openShare() {
  picker.hide();
  closeSheets(share.sheet);
  share.open();
}

function openFriends() {
  picker.hide();
  settings.close();
  closeSheets(friendsSheet.sheet);
  friendsSheet.open();
}

const settings = new Settings(store, { wrap: $(".gearwrap"), phone: PHONE, toast, openIngredients });

/* ---------- inspector ---------- */

const chip = (k) => `<button class="chip" type="button" data-sel="${esc(k)}"><i style="background:${gray(store.color(k))}"></i>${esc(store.name(k, stance))}</button>`;

function inspectorHtml() {
  const s = store.state;
  if (!M) return "";
  if (!sel.size) {
    const nodes = M.nodes;
    const tips = PHONE
      ? [["Tap", "Select"], ["Select mode + tap", "Add to selection"], ["Select mode + drag", "Box select"], ["Hold an orb", "Set level"], ["Two fingers", "Pan and zoom"]]
      : [["Click", "Select"], ["Shift click", "Add to selection"], ["Drag on empty space", "Box select"], ["Hover an orb", "Set level"], ["Scroll or Space drag", "Pan"], [`${MOD}scroll or pinch`, "Zoom"], [`${MOD}K`, "Search"], [`${MOD}Z`, "Undo"], ["Arrows", "Nudge"]];
    return `
      <div class="px-sec"><div class="px-h">Map · ${STANCE_LABEL[stance]}</div>
        <div class="px-stat">
          <div><b>${nodes.length}</b><span>tricks</span></div>
          <div><b>${nodes.filter((n) => n.lv >= 2).length}</b><span>landed</span></div>
          <div><b>${nodes.filter((n) => n.lv === 3).length}</b><span>locked in</span></div>
          <div><b>${store.wants().length}/${WANT_LIMIT}</b><span>wants</span></div>
        </div></div>
      <div class="px-sec"><div class="px-h">How it works</div><div class="px-tips">${tips.map(([k, v]) => `<div><span>${esc(v)}</span><kbd>${esc(k)}</kbd></div>`).join("")}</div></div>`;
  }
  if (sel.size === 1) {
    const key = [...sel][0];
    const n = M.map.get(key);
    if (!n) return "";
    const recipe = parseKey(key);
    const ids = Object.keys(recipe).sort((a, b) => store.ingIndex(a) - store.ingIndex(b));
    const children = M.edges.filter((e) => e.a.k === key).map((e) => e.b.k);
    const parents = parentKeys(key).filter((p) => M.map.has(p) || CATALOG.includes(p));
    const custom = key in s.positions && s.prefs.layout === "custom";
    return `
      <div class="px-sec px-title-in">
        <input data-name value="${esc(store.name(key, stance))}" aria-label="Trick name" autocomplete="off" spellcheck="false">
        <span class="px-key">${esc(key || "ollie")} · ${ingredientCount(depthOf(recipe)).toLowerCase()}</span>
        ${ids.length ? `<div class="px-chips" style="margin-top:6px">${ids.map((id) => `<span class="chip"><i style="background:${gray(store.ingColor(id))}"></i>${esc(store.ing(id)?.name || id)}${recipe[id] > 1 ? ` ×${recipe[id]}` : ""}</span>`).join("")}</div>` : ""}
      </div>
      <div class="px-sec px-feet">
        <div class="px-h">Feet · ${STANCE_LABEL[stance]}</div>
        <div data-feet></div>
      </div>
      <div class="px-sec">
        <div class="px-h">Levels <span style="text-transform:none;letter-spacing:0">${PHONE ? "hold to set" : "hover to set"}</span></div>
        <div class="px-lv">${STANCES.map((st) => {
          const lv = store.level(key, st);
          return `<div class="px-lvrow${st === stance ? " cur" : ""}" data-levels data-lvst="${st}"><span class="st">${STANCE_SHORT[st]}</span>${dotSvg(lv, 16)}<span>${LEVELS[lv]}</span></div>`;
        }).join("")}</div>
      </div>
      <div class="px-sec">
        <div class="px-h">Built from</div><div class="px-chips">${parents.length ? parents.map(chip).join("") : `<span class="px-empty">Nothing. This is the base.</span>`}</div>
        <div class="px-h" style="margin-top:6px">Leads to</div><div class="px-chips">${children.length ? children.map(chip).join("") : `<span class="px-empty">Nothing on the map yet.</span>`}</div>
      </div>
      <div class="px-sec px-actions">
        <button class="btn" type="button" data-open>Open breakdown</button>
        ${custom ? `<button class="btn" type="button" data-resetpos>Reset position</button>` : ""}
        ${key ? `<button class="btn danger" type="button" data-remove>Remove</button>` : ""}
      </div>`;
  }
  const keys = [...sel];
  const anyCustom = keys.some((k) => k in s.positions);
  const sides = new Set(keys.map((k) => store.side(k)));
  return `
    <div class="px-sec"><div class="px-title-in"><b>${keys.length} tricks selected</b><span class="px-key">Drag any of them to move them together</span></div>
      <div class="px-chips">${keys.map(chip).join("")}</div></div>
    <div class="px-sec"><div class="px-h">Align and spread</div>
      <div class="px-align">${ALIGN.map(([id, label, path]) => `<button type="button" data-align="${id}" title="${label}" aria-label="${label}" ${id.endsWith("dist") && keys.length < 3 ? "disabled" : ""}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">${path}</svg></button>`).join("")}</div>
    </div>
    <div class="px-sec"><div class="px-kv"><span>Side</span><div class="px-seg3">${SIDE_ORDER.map((v) => `<button type="button" data-side="${v}" aria-pressed="${sides.size === 1 && sides.has(v)}">${SIDES[v]}</button>`).join("")}</div></div></div>
    <div class="px-sec px-actions">
      ${anyCustom ? `<button class="btn" type="button" data-resetpos>Reset positions</button>` : ""}
      <button class="btn danger" type="button" data-remove>Remove ${keys.length}</button>
    </div>`;
}

function renderInspector() {
  const target = compact ? inspSheetBody : $("#insp");
  const focused = document.activeElement;
  if (focused?.matches?.("[data-name]") && target.contains(focused)) return;
  target.innerHTML = inspectorHtml();
  const feet = target.querySelector("[data-feet]");
  if (feet && sel.size === 1) new FeetEditor(feet, store, [...sel][0], stance);
}

function bindInspector(root) {
  root.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    const one = sel.size === 1 ? [...sel][0] : null;
    if (t.dataset.sel !== undefined) setSel([t.dataset.sel], { focus: true });
    else if (t.dataset.side) setSideAll(t.dataset.side);
    else if (t.dataset.align) align(t.dataset.align);
    else if (t.hasAttribute("data-open") && one !== null) openBreakdown(one);
    else if (t.hasAttribute("data-resetpos")) resetPositions();
    else if (t.hasAttribute("data-remove")) removeSelected();
  });
  root.addEventListener("input", (e) => {
    if (e.target.matches("[data-name]") && sel.size === 1) store.rename([...sel][0], e.target.value, { source: "name" });
  });
  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches("[data-name]")) {
      t.blur();
      renderInspector();
    }
  });
  root.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t.matches("[data-name]") && e.key === "Enter") t.blur();
  });
  // Levels: hover a stance row (PC) or hold it (phone) to open the level picker.
  let hoverT = 0;
  root.addEventListener("pointerover", (e) => {
    const row = e.target.closest("[data-lvst]");
    if (!row || e.pointerType !== "mouse" || sel.size !== 1) return;
    clearTimeout(hoverT);
    hoverT = setTimeout(() => picker.show([...sel][0], row.dataset.lvst, row.querySelector("svg"), { showStance: true }), 160);
  });
  root.addEventListener("pointerout", (e) => {
    const row = e.target.closest("[data-lvst]");
    if (!row || row.contains(e.relatedTarget)) return;
    clearTimeout(hoverT);
    picker.scheduleHide(300);
  });
  let hold = null;
  root.addEventListener("pointerdown", (e) => {
    const row = e.target.closest("[data-lvst]");
    if (!row || e.pointerType === "mouse" || sel.size !== 1) return;
    hold = { x: e.clientX, y: e.clientY, t: setTimeout(() => picker.show([...sel][0], row.dataset.lvst, row.querySelector("svg"), { showStance: true }), 420) };
  });
  root.addEventListener("pointermove", (e) => {
    if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 8) {
      clearTimeout(hold.t);
      hold = null;
    }
  });
  const endHold = () => {
    if (hold) clearTimeout(hold.t);
    hold = null;
  };
  root.addEventListener("pointerup", endHold);
  root.addEventListener("pointercancel", endHold);
  root.addEventListener("contextmenu", (e) => { if (e.target.closest("[data-lvst]")) e.preventDefault(); });
}
bindInspector($("#insp"));
bindInspector(inspSheetBody);

/* ---------- sidebar: filters, stance, history ---------- */

function counts() {
  const by = { sides: {}, levels: {} };
  for (const n of M?.nodes || []) {
    by.sides[n.side] = (by.sides[n.side] || 0) + 1;
    by.levels[n.lv] = (by.levels[n.lv] || 0) + 1;
  }
  return by;
}

function historyHtml() {
  const undo = store.undoStack;
  const redo = store.redoStack;
  const rows = [];
  for (let j = 0; j < redo.length; j++) rows.push(`<button type="button" class="redo" data-redo="${j}" title="Redo to here"><span>${esc(redo[j].label)}</span></button>`);
  for (let i = undo.length - 1; i >= 0; i--) rows.push(`<button type="button" class="${i === undo.length - 1 ? "now" : ""}" data-undo="${i}" title="${i === undo.length - 1 ? "Current state" : "Go back to here"}"><span>${esc(undo[i].label)}</span></button>`);
  rows.push(`<button type="button" class="${undo.length ? "" : "now"}" data-undo="-1" title="Go back to how it was when you opened the app"><span>When you opened the app</span></button>`);
  return rows.join("");
}

const landedIn = (st) => Object.keys(store.state.levels).filter((lk) => lk.startsWith(`${st}|`) && store.state.levels[lk] >= 2).length;

function renderSide() {
  const side = $("#side");
  if (compact) {
    side.innerHTML = `
      ${[["map", "Map"], ["grid", "Grid"]].map(([v, l]) => `<button class="px-fchip" type="button" data-view="${v}" aria-pressed="${view === v}">${l}</button>`).join("")}
      <span class="px-fsep"></span>
      ${PRESETS.slice(1).map((p) => `<button class="px-fchip" type="button" data-preset="${p[0]}" aria-pressed="${presetOn(p)}">${p[1]}</button>`).join("")}
      ${filterOn() ? `<button class="px-fchip" type="button" data-preset="all">Clear</button>` : ""}
      <span class="px-fsep"></span>
      ${STANCES.map((st) => `<button class="px-fchip" type="button" data-stance="${st}" aria-pressed="${stance === st}">${STANCE_LABEL[st]}</button>`).join("")}`;
    return;
  }
  const c = counts();
  const colors = store.state.sideColors;
  side.innerHTML = `
    <div><div class="px-h">Filters ${filterOn() ? `<button type="button" data-preset="all">Clear</button>` : ""}</div>
      <div class="px-presets">${PRESETS.map((p) => `<button type="button" data-preset="${p[0]}" aria-pressed="${presetOn(p)}">${p[1]}</button>`).join("")}</div></div>
    <div><div class="px-h">Side</div>${SIDE_ORDER.map((v) => `<button class="px-opt" type="button" data-fside="${v}" aria-pressed="${filter.sides.has(v)}"><span class="box"></span>${bandIconSvg(v, colors, 12)}${SIDES[v]}<span class="n">${c.sides[v] || 0}</span></button>`).join("")}</div>
    <div><div class="px-h">Level</div>${LEVELS.map((l, i) => `<button class="px-opt" type="button" data-flevel="${i}" aria-pressed="${filter.levels.has(i)}"><span class="box"></span>${dotSvg(i, 14)}${l}<span class="n">${c.levels[i] || 0}</span></button>`).join("")}</div>
    <div><div class="px-h">Stance</div>${STANCES.map((st) => `<button class="px-opt" type="button" data-stance="${st}" aria-pressed="${stance === st}">${STANCE_LABEL[st]}<span class="n">${landedIn(st)} landed</span></button>`).join("")}</div>
    <div><div class="px-h">History <span>${store.undoStack.length}</span></div><div class="px-hist">${historyHtml()}</div></div>`;
}

$("#side").addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.dataset.preset) applyPreset(t.dataset.preset);
  else if (t.dataset.fside) {
    filter.sides.has(t.dataset.fside) ? filter.sides.delete(t.dataset.fside) : filter.sides.add(t.dataset.fside);
    render();
  } else if (t.dataset.flevel) {
    const v = Number(t.dataset.flevel);
    filter.levels.has(v) ? filter.levels.delete(v) : filter.levels.add(v);
    render();
  } else if (t.dataset.stance) setStance(t.dataset.stance);
  else if (t.dataset.view) setView(t.dataset.view);
  else if (t.dataset.undo !== undefined) {
    const target = Number(t.dataset.undo) + 1;
    let guard = 0;
    while (store.undoStack.length > target && guard++ < 200) store.undo();
    pruneSel();
    render();
  } else if (t.dataset.redo !== undefined) {
    const target = Number(t.dataset.redo);
    let guard = 0;
    while (store.redoStack.length > target && guard++ < 200) store.redo();
    render();
  }
});

function setStance(st) {
  stance = st;
  map.o.stance = st;
  picker.hide();
  render();
  toast(`Showing <b>${STANCE_LABEL[st]}</b> levels`);
}

function setView(v) {
  view = v;
  $("#map").hidden = v !== "map";
  $("#grid").hidden = v !== "grid";
  picker.hide();
  render();
}

/* ---------- toolbar and status bar ---------- */

const viewsEl = $("#views");
viewsEl.addEventListener("click", (e) => {
  const b = e.target.closest("[data-view]");
  if (b) setView(b.dataset.view);
});

function renderToolbar() {
  const undo = $("#undoBtn");
  const redo = $("#redoBtn");
  undo.disabled = !store.canUndo();
  redo.disabled = !store.canRedo();
  undo.title = store.canUndo() ? `Undo ${store.undoLabel()} (${MOD}Z)` : "Nothing to undo";
  redo.title = store.canRedo() ? `Redo ${store.redoLabel()} (${MAC ? "⇧⌘Z" : "Ctrl Y"})` : "Nothing to redo";
  viewsEl.innerHTML = [["map", "Map"], ["grid", "Grid"]].map(([v, l]) => `<button type="button" data-view="${v}" aria-pressed="${view === v}">${l}</button>`).join("");
  $("#selMode").setAttribute("aria-pressed", String(selectMode));
  $("#newTrick").textContent = compact ? "+" : "+ New";
  updateZoom();
}

function updateZoom() {
  const pct = `${Math.round(map.cam.z * 100)}%`;
  $(".px-zv").textContent = pct;
  const el = $("[data-zoomstat]");
  if (el) el.textContent = pct;
}

function renderStatus() {
  if (!M) return;
  const nodes = M.nodes;
  $("#status").innerHTML = `
    <span><b>${nodes.length}</b> tricks</span>
    <span><b>${nodes.filter((n) => n.lv >= 2).length}</b> landed</span>
    <span><b>${nodes.filter((n) => n.lv === 3).length}</b> locked in</span>
    <span>wants <b>${store.wants().length}/${WANT_LIMIT}</b></span>
    <span>${STANCE_LABEL[stance]}</span>
    ${filterOn() ? `<span><b>${visibleKeys().length}</b> match filters</span>` : ""}
    ${sel.size ? `<span><b>${sel.size}</b> selected</span>` : ""}
    <span class="grow"></span>
    <span data-zoomstat>${Math.round(map.cam.z * 100)}%</span>
    ${store.needsBackup() ? `<span class="warn">No recent backup</span>` : ""}
    <span class="${store.saveError ? "warn" : "ok"}">${store.saveError ? "Couldn't save" : "Saved on this device"}</span>`;
}

$("#undoBtn").addEventListener("click", doUndo);
$("#redoBtn").addEventListener("click", doRedo);
$("#newTrick").addEventListener("click", newTrick);
$("#shareBtn").addEventListener("click", openShare);
$("#friendsBtn").addEventListener("click", openFriends);
$("#selMode").addEventListener("click", () => {
  selectMode = !selectMode;
  $("#selMode").setAttribute("aria-pressed", String(selectMode));
  toast(selectMode ? "Select mode: tap tricks to add them, drag on empty space to box select." : "Select mode off");
});
$("#zoomCtl").addEventListener("click", (e) => {
  const b = e.target.closest("[data-zoom]");
  if (!b) return;
  if (b.dataset.zoom === "fit") map.resetCamera();
  else {
    const r = $("#map").getBoundingClientRect();
    map.zoomAt(b.dataset.zoom === "1" ? 1.25 : 0.8, r.width / 2, r.height / 2, 220);
  }
});

/* ---------- search (command palette) ---------- */

function fuzzy(q, text) {
  const t = text.toLowerCase();
  if (!q) return { score: 0, marks: [] };
  const at = t.indexOf(q);
  if (at >= 0) {
    const marks = [];
    for (let i = at; i < at + q.length; i++) marks.push(i);
    return { score: 200 - at + (at === 0 || t[at - 1] === " " ? 40 : 0), marks };
  }
  let from = 0;
  let last = -2;
  let score = 0;
  const marks = [];
  for (const ch of q) {
    if (ch === " ") continue;
    const f = t.indexOf(ch, from);
    if (f < 0) return null;
    marks.push(f);
    score += (f === last + 1 ? 6 : 1) + (f === 0 || t[f - 1] === " " ? 4 : 0);
    last = f;
    from = f + 1;
  }
  return { score, marks };
}

const markUp = (text, marks) => [...text].map((ch, i) => (marks.includes(i) ? `<mark>${esc(ch)}</mark>` : esc(ch))).join("");

function commands() {
  const p = store.state.prefs;
  return [
    { label: "Undo", hint: store.canUndo() ? store.undoLabel() : "", kbd: `${MOD}Z`, run: doUndo, ok: store.canUndo() },
    { label: "Redo", hint: store.canRedo() ? store.redoLabel() : "", kbd: MAC ? "⇧⌘Z" : "Ctrl Y", run: doRedo, ok: store.canRedo() },
    { label: "Select all", kbd: `${MOD}A`, run: () => setSel(visibleKeys()) },
    { label: "Clear selection", kbd: "Esc", run: () => setSel([]), ok: sel.size > 0 },
    { label: "Zoom to fit", kbd: "F", run: () => map.resetCamera() },
    ...PRESETS.slice(1).map((pr) => ({ label: `Filter: ${pr[1]}`, run: () => applyPreset(pr[0]) })),
    { label: "Clear filters", run: () => applyPreset("all"), ok: filterOn() },
    ...STANCES.filter((st) => st !== stance).map((st) => ({ label: `Stance: ${STANCE_LABEL[st]}`, run: () => setStance(st) })),
    { label: `View: ${view === "map" ? "Stance grid" : "Map"}`, run: () => setView(view === "map" ? "grid" : "map") },
    { label: p.layout === "custom" ? "Layout: Auto" : "Layout: Custom", run: () => store.setPref("layout", p.layout === "custom" ? "auto" : "custom") },
    { label: p.filter === "next" ? "Show: Everything" : "Show: Next stops", run: () => store.setPref("filter", p.filter === "next" ? "all" : "next") },
    { label: p.rider === "goofy" ? "I ride: Regular" : "I ride: Goofy", run: () => store.setPref("rider", p.rider === "goofy" ? "regular" : "goofy") },
    { label: "New trick", kbd: "N", run: newTrick },
    { label: "Share story image or profile card", run: openShare },
    { label: "Friends", hint: friends.friends.length ? `${friends.friends.length}` : "", run: openFriends },
    { label: "Invite a friend", run: () => (friends.account ? friendsSheet.shareInvite() : openFriends()) },
    { label: "Save a backup", run: () => settings.saveBackup() },
    { label: "Restore points", run: () => settings.showPoints() },
    { label: "Ingredients and colors", run: openIngredients },
    { label: "Settings", run: () => settings.open() },
    { label: "Keyboard shortcuts", kbd: "?", run: showKeys, ok: !PHONE },
  ].filter((c) => c.ok !== false);
}

function trickItems() {
  const items = (M?.nodes || []).map((n) => ({
    trick: n.k, label: n.name, color: gray(n.col),
    hint: `${SIDES[n.side]} · ${LEVELS[n.lv]}`,
  }));
  const shown = new Set(items.map((i) => i.trick));
  for (const k of store.state.hidden) {
    if (shown.has(k)) continue;
    items.push({ trick: k, label: store.name(k, stance), color: gray(store.color(k)), hint: "Removed · adds it back", hidden: true });
  }
  return items;
}

let pal = null;
function openPalette(initial = "") {
  if (pal) return;
  picker.hide();
  settings.close();
  const el = document.createElement("div");
  el.className = "px-pal";
  el.innerHTML = `<div class="px-pal-box" role="dialog" aria-label="Search">
    <div class="px-pal-in"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <input type="text" placeholder="Search tricks or type a command" aria-label="Search" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>
    <div class="px-pal-list" role="listbox"></div>
    <div class="px-pal-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div>
  </div>`;
  document.body.append(el);
  const input = $("input", el);
  const list = $(".px-pal-list", el);
  pal = { el, items: [], active: 0 };
  const paint = () => {
    const q = input.value.trim().toLowerCase();
    const scored = (arr) => arr.map((it) => ({ it, m: fuzzy(q, it.label) })).filter((x) => x.m).sort((a, b) => b.m.score - a.m.score);
    const tricks = scored(trickItems()).slice(0, q ? 12 : 6);
    const cmds = scored(commands()).slice(0, q ? 8 : 12);
    pal.items = [...tricks, ...cmds];
    pal.active = clamp(pal.active, 0, Math.max(0, pal.items.length - 1));
    let i = 0;
    const row = ({ it, m }) => {
      const idx = i++;
      return `<button type="button" class="px-pal-item${idx === pal.active ? " on" : ""}" data-i="${idx}" role="option" aria-selected="${idx === pal.active}">
        ${it.trick !== undefined ? `<i style="background:${it.color}"></i>` : `<span class="ic">›</span>`}
        <span>${markUp(it.label, m.marks)}</span>
        <span class="sub">${esc(it.hint || "")}${it.kbd && !PHONE ? ` <kbd>${esc(it.kbd)}</kbd>` : ""}</span></button>`;
    };
    list.innerHTML = pal.items.length
      ? `${tricks.length ? `<div class="px-pal-group">Tricks</div>${tricks.map(row).join("")}` : ""}${cmds.length ? `<div class="px-pal-group">Commands</div>${cmds.map(row).join("")}` : ""}`
      : `<div class="px-pal-empty">Nothing matches “${esc(input.value)}”</div>`;
    list.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  };
  const run = (i) => {
    const entry = pal.items[i];
    if (!entry) return;
    closePalette();
    const it = entry.it;
    if (it.trick !== undefined) {
      if (it.hidden) store.ensureTrick(it.trick);
      if (filterOn() && M?.map.get(it.trick) && !passes(M.map.get(it.trick))) applyPreset("all");
      if (view !== "map") setView("map");
      setSel([it.trick], { focus: true });
    } else it.run();
  };
  input.addEventListener("input", () => {
    pal.active = 0;
    paint();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      pal.active = clamp(pal.active + (e.key === "ArrowDown" ? 1 : -1), 0, pal.items.length - 1);
      paint();
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(pal.active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
    }
  });
  list.addEventListener("click", (e) => {
    const b = e.target.closest("[data-i]");
    if (b) run(Number(b.dataset.i));
  });
  list.addEventListener("pointermove", (e) => {
    const b = e.target.closest("[data-i]");
    if (!b || Number(b.dataset.i) === pal.active) return;
    pal.active = Number(b.dataset.i);
    for (const x of list.querySelectorAll(".px-pal-item")) x.classList.toggle("on", x === b);
  });
  el.addEventListener("pointerdown", (e) => { if (e.target === el) closePalette(); });
  input.value = initial;
  paint();
  input.focus();
}

function closePalette() {
  pal?.el.remove();
  pal = null;
}

function showKeys() {
  const el = document.createElement("div");
  el.className = "px-pal";
  const keys = [
    ["Search tricks and commands", `${MOD}K or /`], ["Undo", `${MOD}Z`], ["Redo", MAC ? "⇧⌘Z" : "Ctrl Y"],
    ["Select all", `${MOD}A`], ["Add to selection", "Shift click"], ["Box select", "Drag on empty space"],
    ["Clear selection", "Esc"], ["Nudge selected", "Arrows (Shift: 20)"], ["Remove selected", "Delete"],
    ["Pan", "Scroll or Space drag"], ["Zoom", `${MOD}scroll or pinch`], ["Zoom to fit", "F"], ["New trick", "N"],
    ["Set a level", "Hover an orb"], ["This list", "?"],
  ];
  el.innerHTML = `<div class="px-pal-box" role="dialog" aria-label="Keyboard shortcuts"><div class="px-pal-in"><b style="padding:14px 0;flex:1">Keyboard shortcuts</b><kbd>Esc</kbd></div>
    <div class="px-keys">${keys.map(([a, b]) => `<span>${esc(a)}</span><span><kbd>${esc(b)}</kbd></span>`).join("")}</div></div>`;
  document.body.append(el);
  const close = () => {
    el.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e) => {
    if (e.key === "Escape" || e.key === "?") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener("keydown", onKey, true);
  el.addEventListener("pointerdown", (e) => { if (e.target === el) close(); });
}

$("#searchBtn").addEventListener("click", () => openPalette());
$("#searchIcon").addEventListener("click", () => openPalette());
$("#helpBtn").addEventListener("click", showKeys);

/* ---------- keyboard ---------- */

const typing = (e) => e.target.closest?.("input, textarea, select, [contenteditable]");
document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  // A friend's map is on top: nothing should change your map underneath it.
  if (friendView.isOpen) {
    if (e.key === "Escape") {
      e.preventDefault();
      friendView.close();
    } else if (!mod && !typing(e) && (e.key === "f" || e.key === "F")) friendView.map.resetCamera();
    return;
  }
  if (mod && e.key.toLowerCase() === "k") {
    e.preventDefault();
    pal ? closePalette() : openPalette();
    return;
  }
  if (pal || typing(e)) return;
  if (mod && e.key.toLowerCase() === "z") {
    e.preventDefault();
    e.shiftKey ? doRedo() : doUndo();
  } else if (mod && e.key.toLowerCase() === "y") {
    e.preventDefault();
    doRedo();
  } else if (mod && e.key.toLowerCase() === "a") {
    e.preventDefault();
    setSel(visibleKeys());
  } else if (e.key === "/") {
    e.preventDefault();
    openPalette();
  } else if (e.key === "?") showKeys();
  else if (e.key === "Escape") {
    const open = sheets.find((s) => s.isOpen && s !== inspSheet);
    if (open) open.close();
    else if (sel.size) setSel([]);
  } else if (e.key === "Delete" || e.key === "Backspace") {
    if (sel.size) {
      e.preventDefault();
      removeSelected();
    }
  } else if (e.key.startsWith("Arrow") && sel.size && view === "map") {
    e.preventDefault();
    const d = e.shiftKey ? 20 : 4;
    nudge(e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0, e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0);
  } else if (!mod && (e.key === "f" || e.key === "F")) map.resetCamera();
  else if (!mod && (e.key === "n" || e.key === "N")) newTrick();
  else if (e.key === " " && !spaceHeld) {
    e.preventDefault();
    spaceHeld = true;
    document.body.classList.add("panning");
  }
});
document.addEventListener("keyup", (e) => {
  if (e.key === " ") {
    spaceHeld = false;
    document.body.classList.remove("panning");
  }
});
window.addEventListener("blur", () => {
  spaceHeld = false;
  document.body.classList.remove("panning");
});

/* ---------- render ---------- */

function render() {
  if (view === "map") map.render();
  else {
    grid.render();
    M = buildModel(store, { stance, include: [...sel] });
  }
  renderSide();
  renderInspector();
  renderStatus();
  renderToolbar();
  renderSelPill();
}

store.subscribe((info) => {
  if (info.source === "undo" || info.source === "redo" || info.source === "other-tab" || info.source === "restore") pruneSel();
  if (info.source === "save-status") {
    renderStatus();
    return;
  }
  if (info.source === "feet") {
    // The shoes already moved on screen; rebuilding the inspector would cut a drag short.
    renderToolbar();
    renderSide();
    return;
  }
  if (info.source === "name" || info.source === "profile") {
    if (view === "map") map.render();
    else grid.render();
    renderStatus();
    renderSide();
    return;
  }
  render();
});

function applyCompact() {
  compact = PHONE || compactQuery.matches;
  document.body.classList.toggle("compact", compact);
  if (!compact) inspSheet.close({ silent: true });
  render();
}
compactQuery.addEventListener?.("change", applyCompact);
applyCompact();

// Invite links look like ?friend=K7Q2M9XA. Take the code and tidy the address bar.
const params = new URLSearchParams(location.search);
const invited = params.get("friend");
if (invited !== null) {
  params.delete("friend");
  const rest = params.toString();
  try { history.replaceState(null, "", `${location.pathname}${rest ? `?${rest}` : ""}${location.hash}`); } catch { /* ignore */ }
  friendsSheet.takeInvite(invited);
}
friends.start();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
