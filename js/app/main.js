// Trick Map app: wires the store to the map, stance grid, breakdown sheet,
// level picker, settings and ingredient editor.

import { createStore, requestPersistence } from "../core/store.js";
import { SIDES } from "../core/catalog.js";
import { esc, legendHtml } from "../core/draw.js";
import { MapView } from "./mapview.js";
import { GridView } from "./grid.js";
import { LevelPicker } from "./levelpicker.js";
import { Breakdown } from "./breakdown.js";
import { Sheet } from "./sheet.js";
import { Settings } from "./settings.js";
import { IngredientsEditor } from "./ingredients.js";

const PHONE = document.documentElement.classList.contains("phone");
const $ = (sel) => document.querySelector(sel);

const store = createStore();
requestPersistence();

/* ---------- toast ---------- */

const toastEl = $("#toast");
let toastTimer = 0;
const hint = () => {
  if (PHONE) return "";
  return store.pref("view") === "grid"
    ? "Hover a dot to set its level. Click a trick to open it."
    : "Hover an orb to set its level. Click to open it. Drag to move.";
};
function toast(html, ms = 5000) {
  toastEl.innerHTML = html;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.innerHTML = hint(); }, ms);
}

/* ---------- open trick (breakdown sheet) ---------- */

let selected = null;
const picker = new LevelPicker(store, { hoverMode: !PHONE, toast });
const sheet = new Sheet({
  label: "Trick breakdown",
  onClose: () => {
    selected = null;
    renderView();
  },
});
const breakdown = new Breakdown(store, {
  onNavigate: (key) => openTrick(key),
  onClose: () => sheet.close(),
  toast,
});
sheet.body.append(breakdown.el);

function openTrick(key) {
  selected = key;
  breakdown.render(key);
  sheet.open();
  sheet.el.scrollTop = 0;
  renderView();
}

function toggleTrick(key) {
  picker.hide();
  if (selected === key && sheet.isOpen) sheet.close();
  else openTrick(key);
}

/* ---------- map and grid ---------- */

const mapEl = $("#mapview");
const gridEl = $("#gridview");
const shared = {
  include: () => (selected !== null ? [selected] : []),
  selection: () => (selected !== null ? new Set([selected]) : null),
  onTap: (key) => toggleTrick(key),
  onGestureStart: () => picker.hide(),
  onZoneChange: (changes) => toast(`<b>${esc(store.name(changes[0].key))}</b> moved to ${SIDES[changes[0].zone]}`),
};
const map = new MapView(mapEl, store, PHONE
  ? { ...shared, projection: "fit", onLongPress: (key, anchor) => picker.show(key, "regular", anchor) }
  : {
      ...shared,
      projection: "pc",
      onHover: (key, anchor) => picker.show(key, "regular", anchor),
      onHoverEnd: () => picker.scheduleHide(300),
    });

const grid = new GridView(gridEl, store, {
  hover: !PHONE,
  include: shared.include,
  onOpen: (key) => {
    picker.hide();
    openTrick(key);
  },
  onCell: (key, stance, cell) => picker.show(key, stance, cell, { showStance: true }),
  onCellLeave: () => picker.scheduleHide(300),
});

/* ---------- top bar ---------- */

const viewsEl = $("#views");
function renderViews() {
  const view = store.pref("view");
  viewsEl.innerHTML = [["map", "Map"], ["grid", "Stance grid"]]
    .map(([v, l]) => `<button type="button" data-view="${v}" aria-pressed="${view === v}">${l}</button>`).join("");
}
viewsEl.addEventListener("click", (e) => {
  const b = e.target.closest("[data-view]");
  if (!b) return;
  picker.hide();
  store.setPref("view", b.dataset.view);
  toastEl.innerHTML = hint();
});

$("#newTrick").addEventListener("click", () => {
  openTrick("");
  toast("Start from the ollie and add ingredients below.");
  setTimeout(() => breakdown.focusAdd(), 60);
});

/* ---------- ingredients and settings ---------- */

const panel = $("#ingredientsPanel");
new IngredientsEditor($("#ingredients"), store);
panel.addEventListener("toggle", () => { if (!panel.open) panel.classList.remove("sheetopen"); });
function openIngredients() {
  panel.open = true;
  if (PHONE) {
    panel.classList.add("sheetopen");
    panel.scrollTop = 0;
  } else panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

new Settings(store, { wrap: $(".gearwrap"), phone: PHONE, toast, openIngredients, labHref: "lab/" });
$("#legend").innerHTML = legendHtml();

/* ---------- render ---------- */

function renderView() {
  const view = store.pref("view");
  mapEl.hidden = view !== "map";
  gridEl.hidden = view !== "grid";
  if (view === "map") map.render();
  else grid.render();
  renderViews();
}

store.subscribe((info) => {
  if (info.source === "restore" || info.source === "other-tab") {
    if (selected !== null) sheet.close({ silent: true });
    selected = null;
  }
  renderView();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && sheet.isOpen && !e.target.closest?.("input,select,textarea")) sheet.close();
});

toastEl.innerHTML = hint();
renderView();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
