// Test 1 · Native: Trick Map with an App Store feel. Tab bar, a spring sheet
// that stops at half or full height, a hold menu you can slide through,
// rows you swipe to mark landed, and a Wants tab with three big cards.

import { labStore, mountLabBar, makeToast, featureList, bindPicks, confirmReset, haptic, PHONE } from "./lab.js";
import { MapView } from "../js/app/mapview.js";
import { LevelPicker } from "../js/app/levelpicker.js";
import { Breakdown } from "../js/app/breakdown.js";
import { buildModel, routeTo } from "../js/core/model.js";
import { SIDES, SIDE_ORDER, STANCES, STANCE_LABEL, LEVELS, WANT_LIMIT, parentKeys } from "../js/core/catalog.js";
import { esc, dotSvg, bandIconSvg, tone, orbSvg } from "../js/core/draw.js";

const store = labStore("native");
const $ = (sel, root = document) => root.querySelector(sel);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const toast = makeToast($("#toast"));

mountLabBar($("#labBack"), store, { chipHost: $("#labChip"), short: true });
$("#labChip").append($("#newTrick"));

/* ---------- spring physics ---------- */

function spring({ from, to, velocity = 0, stiffness = 360, damping = 34, onUpdate, onComplete }) {
  if (reduced()) {
    onUpdate(to);
    onComplete?.();
    return () => {};
  }
  let x = from;
  let v = velocity;
  let last = performance.now();
  let raf = 0;
  const step = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const n = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      v += (-stiffness * (x - to) - damping * v) * h;
      x += v * h;
    }
    if (Math.abs(v) < 8 && Math.abs(x - to) < 0.4) {
      onUpdate(to);
      onComplete?.();
      return;
    }
    onUpdate(x);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

function velocityOf(samples) {
  const now = performance.now();
  const recent = samples.filter((s) => now - s.t < 110);
  if (recent.length < 2) return 0;
  const a = recent[0];
  const b = recent[recent.length - 1];
  return ((b.y - a.y) / Math.max(1, b.t - a.t)) * 1000;
}

/* ---------- sheet with half and full stops ---------- */

class SpringSheet {
  constructor({ onClose = null } = {}) {
    this.onClose = onClose;
    this.scrim = document.createElement("div");
    this.scrim.className = "nx-scrim";
    this.el = document.createElement("section");
    this.el.className = "nx-sheet";
    this.el.hidden = true;
    this.el.setAttribute("role", "dialog");
    this.el.innerHTML = `
      <div class="nx-sheet-head">
        <button class="nx-grabber" type="button" aria-label="Make bigger or smaller"></button>
        <div class="nx-sheet-bar"><span class="nx-pill" data-pill></span><span class="t" data-title></span><button class="nx-done" type="button">Done</button></div>
      </div>
      <div class="nx-sheet-body"></div>`;
    document.body.append(this.scrim, this.el);
    this.head = $(".nx-sheet-head", this.el);
    this.body = $(".nx-sheet-body", this.el);
    this.pill = $("[data-pill]", this.el);
    this.title = $("[data-title]", this.el);
    this.detent = null;
    this.t = this._targets().closed;
    this._apply();

    $(".nx-done", this.el).addEventListener("click", () => this.close());
    $(".nx-grabber", this.el).addEventListener("click", () => {
      if (this._dragged) return;
      this.snap(this.detent === "large" ? "medium" : "large");
    });
    this.scrim.addEventListener("click", () => this.close());
    this._bindTouch();
    this._bindMouse();
    this.body.addEventListener("wheel", (e) => {
      if (this.detent === "medium" && e.deltaY > 0) {
        e.preventDefault();
        this.snap("large");
      } else if (this.detent === "large" && this.body.scrollTop <= 0 && e.deltaY < -24) this.snap("medium");
    }, { passive: false });
    window.addEventListener("resize", () => {
      if (!this.detent) return;
      this.stop?.();
      this.t = this._targets()[this.detent];
      this._apply();
    });
  }

  get isOpen() { return this.detent !== null; }

  _targets() {
    const top = parseFloat(getComputedStyle(this.el).top) || 0;
    const H = window.innerHeight;
    return { large: 0, medium: Math.max(0, Math.round(H * 0.47 - top)), closed: H - top + 30 };
  }

  _apply() {
    const T = this._targets();
    this.el.style.transform = `translateY(${this.t}px)`;
    const o = this.t >= T.medium
      ? 0.08 * clamp((T.closed - this.t) / Math.max(1, T.closed - T.medium), 0, 1)
      : 0.08 + 0.3 * clamp((T.medium - this.t) / Math.max(1, T.medium), 0, 1);
    this.scrim.style.opacity = String(o);
  }

  setContent(node, { pill = "", title = "" } = {}) {
    if (this.body.firstChild !== node) this.body.replaceChildren(node);
    this.pill.textContent = pill;
    this.pill.hidden = !pill;
    this.title.textContent = title;
  }

  snap(detent, velocity = 0) {
    this.stop?.();
    const to = this._targets()[detent];
    if (detent !== "closed") this.detent = detent;
    this.el.hidden = false;
    this.el.classList.toggle("is-large", detent === "large");
    this.scrim.classList.toggle("blocking", detent === "large");
    this.stop = spring({
      from: this.t, to, velocity,
      stiffness: detent === "closed" ? 300 : 380,
      damping: detent === "closed" ? 33 : 34,
      onUpdate: (v) => { this.t = v; this._apply(); },
      onComplete: () => {
        this.stop = null;
        if (detent === "closed") this.el.hidden = true;
      },
    });
  }

  open(detent = "medium") {
    if (this.detent === "large" && detent === "medium") return;
    if (!this.detent) this.body.scrollTop = 0;
    this.snap(detent);
  }

  close(velocity = 0) {
    if (!this.detent) return;
    this.detent = null;
    document.activeElement?.blur?.();
    this.snap("closed", velocity);
    this.onClose?.();
  }

  _dragTo(t) {
    this.t = t < 0 ? -Math.pow(-t, 0.7) : t;
    this._apply();
  }

  _release(v) {
    const T = this._targets();
    const projected = this.t + v * 0.2;
    const best = [["large", T.large], ["medium", T.medium], ["closed", T.closed]]
      .reduce((a, b) => (Math.abs(b[1] - projected) < Math.abs(a[1] - projected) ? b : a));
    if (best[0] === "closed") this.close(v);
    else this.snap(best[0], v);
  }

  _bindTouch() {
    const el = this.el;
    el.addEventListener("touchstart", (e) => {
      this.drag = null;
      if (e.touches.length !== 1 || e.target.closest("select, textarea, input[type=range], input[type=color], .deck, [data-nodrag]")) return;
      const p = e.touches[0];
      this._dragged = false;
      this.drag = { x0: p.clientX, y0: p.clientY, head: !!e.target.closest(".nx-sheet-head"), mode: null, samples: [] };
    }, { passive: true });
    el.addEventListener("touchmove", (e) => {
      const d = this.drag;
      if (!d) return;
      const p = e.touches[0];
      const dx = p.clientX - d.x0;
      const dy = p.clientY - d.y0;
      if (!d.mode) {
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) {
          if (d.head || this.detent !== "large") e.preventDefault();
          return;
        }
        if (!d.head && Math.abs(dx) > Math.abs(dy)) d.mode = "none";
        else if (d.head || this.detent !== "large" || (this.body.scrollTop <= 0 && dy > 0)) {
          d.mode = "sheet";
          this.stop?.();
          d.t0 = this.t;
          d.y0 = p.clientY;
        } else d.mode = "scroll";
      }
      if (d.mode !== "sheet") return;
      e.preventDefault();
      this._dragged = true;
      this._dragTo(d.t0 + (p.clientY - d.y0));
      d.samples.push({ t: performance.now(), y: p.clientY });
      if (d.samples.length > 8) d.samples.shift();
    }, { passive: false });
    const end = () => {
      const d = this.drag;
      this.drag = null;
      if (d?.mode === "sheet") this._release(velocityOf(d.samples));
      setTimeout(() => { this._dragged = false; }, 0);
    };
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
  }

  _bindMouse() {
    let m = null;
    this.head.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0 || e.target.closest(".nx-done")) return;
      this.stop?.();
      m = { y0: e.clientY, t0: this.t, samples: [], moved: false };
      this.head.setPointerCapture(e.pointerId);
    });
    this.head.addEventListener("pointermove", (e) => {
      if (!m) return;
      const dy = e.clientY - m.y0;
      if (Math.abs(dy) > 3) m.moved = true;
      if (!m.moved) return;
      this._dragged = true;
      this._dragTo(m.t0 + dy);
      m.samples.push({ t: performance.now(), y: e.clientY });
    });
    const up = () => {
      if (!m) return;
      const was = m;
      m = null;
      if (was.moved) this._release(velocityOf(was.samples));
      setTimeout(() => { this._dragged = false; }, 0);
    };
    this.head.addEventListener("pointerup", up);
    this.head.addEventListener("pointercancel", up);
  }
}

/* ---------- hold menu (slide to pick) ---------- */

const CHECK = `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHEVRON = `<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

class HoldMenu {
  constructor() {
    this.el = document.createElement("div");
    this.el.className = "nx-ctx";
    this.el.hidden = true;
    this.el.innerHTML = `<div class="nx-ctx-bg"></div><div class="nx-ctx-card" role="menu"></div>`;
    document.body.append(this.el);
    this.card = $(".nx-ctx-card", this.el);
    this.cur = null;
    this.hot = null;
    $(".nx-ctx-bg", this.el).addEventListener("click", () => this.hide());
    this.card.addEventListener("click", (e) => {
      const b = e.target.closest(".nx-ctx-list button");
      if (b) this._choose(b);
    });
    store.subscribe(() => { if (this.cur) this._paint(); });
  }

  get open() { return !this.el.hidden; }

  show({ key, stance, anchor, origin = null, onHide = null }) {
    clearTimeout(this._hideT);
    this.el.classList.remove("out", "in");
    this.cur = { key, stance, warn: false, moved: false, origin, onHide };
    this._paint();
    this.el.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = this.card.offsetWidth;
    const h = this.card.offsetHeight;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const left = clamp(cx - w / 2, 12, window.innerWidth - w - 12);
    let top = r.bottom + 14;
    if (top + h > window.innerHeight - 16) top = r.top - h - 14;
    if (top < 16) top = clamp(cy - h / 2, 16, window.innerHeight - h - 16);
    Object.assign(this.card.style, { left: `${left}px`, top: `${top}px` });
    this.card.style.setProperty("--ox", `${cx - left}px`);
    this.card.style.setProperty("--oy", `${cy - top}px`);
    requestAnimationFrame(() => requestAnimationFrame(() => this.el.classList.add("in")));
    haptic(12);
  }

  _paint() {
    const { key, stance, warn } = this.cur;
    const palette = store.pref("palette");
    const lv = store.level(key, stance);
    const wants = store.wants();
    const name = store.name(key, stance);
    this.card.innerHTML = `
      <div class="nx-ctx-prev">
        <svg width="40" height="40" viewBox="-20 -20 40 40" aria-hidden="true">${orbSvg(lv, tone(store.color(key), palette), palette)}</svg>
        <div><b>${esc(name)}</b><span>${STANCE_LABEL[stance]} · ${SIDES[store.side(key)]}</span></div>
      </div>
      ${warn ? `<div class="nx-ctx-warn">${WANT_LIMIT} wants max. Drop one first: ${wants.map((w) => esc(store.name(w.key, w.stance))).join(", ")}.</div>` : ""}
      <div class="nx-ctx-list">
        ${LEVELS.map((label, i) => `<button type="button" role="menuitemradio" aria-checked="${lv === i}" data-lv="${i}" class="${lv === i ? "cur" : ""}">${label}<span class="r">${i === 1 ? `${wants.length}/${WANT_LIMIT}` : ""}${lv === i ? CHECK : `<svg width="18" height="18" viewBox="-9 -9 18 18" aria-hidden="true"><g transform="scale(.8)">${orbSvg(i, tone(store.color(key), palette), palette)}</g></svg>`}</span></button>`).join("")}
        <div class="gap"></div>
        <button type="button" data-open>Open breakdown<span class="r">${CHEVRON}</span></button>
      </div>`;
    this.hot = null;
  }

  track(x, y) {
    if (!this.cur) return;
    if (this.cur.origin && Math.hypot(x - this.cur.origin.x, y - this.cur.origin.y) > 12) this.cur.moved = true;
    const b = document.elementFromPoint(x, y)?.closest?.(".nx-ctx-list button") || null;
    if (b === this.hot) return;
    this.hot?.classList.remove("hot");
    this.hot = b;
    if (b) {
      b.classList.add("hot");
      haptic(4);
    }
  }

  release() {
    const b = this.hot;
    this.hot?.classList.remove("hot");
    this.hot = null;
    if (b && this.cur?.moved) this._choose(b);
  }

  _choose(b) {
    if (!this.cur) return;
    const { key, stance } = this.cur;
    if (b.hasAttribute("data-open")) {
      this.hide();
      openTrick(key, stance);
      return;
    }
    const value = Number(b.dataset.lv);
    const result = store.setLevel(key, stance, value);
    if (!result.ok) {
      this.cur.warn = true;
      this._paint();
      this.card.classList.remove("shake");
      void this.card.offsetWidth;
      this.card.classList.add("shake");
      haptic([12, 40, 12]);
      return;
    }
    haptic(10);
    toast(`<b>${esc(store.name(key, stance))}</b> · ${LEVELS[value]}`);
    this.hide();
  }

  hide() {
    if (this.el.hidden || !this.cur) return;
    const done = this.cur.onHide;
    this.cur = null;
    this.el.classList.remove("in");
    this.el.classList.add("out");
    this._hideT = setTimeout(() => {
      this.el.hidden = true;
      this.el.classList.remove("out");
    }, 190);
    done?.();
  }
}

/* ---------- open a trick in the sheet ---------- */

let selected = null; // { key, stance }
const picker = new LevelPicker(store, { hoverMode: true, toast });
const menu = new HoldMenu();
const sheet = new SpringSheet({
  onClose: () => {
    selected = null;
    renderVisible();
  },
});
const breakdown = new Breakdown(store, {
  onNavigate: (key) => openTrick(key, breakdown.stance),
  onClose: () => sheet.close(),
  toast,
  closeButton: false,
});

function openTrick(key, stance = "regular", detent = null) {
  picker.hide();
  selected = { key, stance };
  breakdown.stance = stance;
  breakdown.render(key);
  sheet.setContent(breakdown.el, { pill: STANCE_LABEL[stance] });
  sheet.open(detent || (PHONE ? "medium" : "large"));
  renderVisible();
}

/* ---------- tabs ---------- */

const ICONS = {
  map: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M9 4.5 3.5 6.8v12.7L9 17.2l6 2.3 5.5-2.3V4.5L15 6.8 9 4.5z"/><path d="M9 4.5v12.7M15 6.8v12.7"/></svg>`,
  stances: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>`,
  wants: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 4.3c.4-1.7 3-1.7 3.4 0a1.7 1.7 0 0 0 2.6 1.1c1.5-.9 3.3.8 2.4 2.4a1.7 1.7 0 0 0 1 2.5c1.8.4 1.8 3 0 3.4a1.7 1.7 0 0 0-1 2.6c.9 1.5-.9 3.3-2.4 2.4a1.7 1.7 0 0 0-2.6 1c-.4 1.8-3 1.8-3.4 0a1.7 1.7 0 0 0-2.6-1c-1.5.9-3.3-.9-2.4-2.4a1.7 1.7 0 0 0-1-2.6c-1.8-.4-1.8-3 0-3.4a1.7 1.7 0 0 0 1-2.5c-.9-1.6.9-3.3 2.4-2.4a1.7 1.7 0 0 0 2.6-1.1z"/><circle cx="12" cy="12" r="3"/></svg>`,
};
const TABS = [["map", "Map"], ["stances", "Stances"], ["wants", "Wants"], ["settings", "Settings"]];
const TAB_KEY = "trickmap.lab.native.tab";
let tab = (() => { try { return sessionStorage.getItem(TAB_KEY) || "map"; } catch { return "map"; } })();
if (!TABS.some(([id]) => id === tab)) tab = "map";

const tabsEl = $("#tabs");
const nav = $(".nx-nav");
const navTitle = $("#navTitle");
tabsEl.setAttribute("role", "tablist");
tabsEl.innerHTML = TABS.map(([id, label]) => `<button class="nx-tab" type="button" role="tab" data-tab="${id}" aria-selected="false">${ICONS[id]}<span>${label}</span></button>`).join("");
tabsEl.addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (!b) return;
  if (b.dataset.tab === tab) {
    pageOf(tab).scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" });
    return;
  }
  haptic(6);
  setTab(b.dataset.tab);
});

const pageOf = (id) => $(`[data-page="${id}"]`);

function setTab(id, { animate = true } = {}) {
  tab = id;
  try { sessionStorage.setItem(TAB_KEY, id); } catch { /* ignore */ }
  picker.hide();
  for (const [t] of TABS) {
    const page = pageOf(t);
    page.hidden = t !== id;
    page.classList.remove("enter");
  }
  const page = pageOf(id);
  if (animate) {
    void page.offsetWidth;
    page.classList.add("enter");
  }
  for (const b of tabsEl.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === id));
  navTitle.textContent = TABS.find(([t]) => t === id)[1];
  updateNav();
  renderVisible();
}

function updateNav() {
  const page = pageOf(tab);
  const scrolled = tab === "map" ? true : page.scrollTop > 34;
  navTitle.classList.toggle("hide", tab !== "map" && !scrolled);
  nav.classList.toggle("hair", tab !== "map" && page.scrollTop > 4);
}
for (const [id] of TABS) pageOf(id).addEventListener("scroll", () => { if (id === tab) updateNav(); }, { passive: true });

/* ---------- map ---------- */

const map = new MapView($("#map"), store, {
  projection: "fit",
  wheelZoom: !PHONE,
  include: () => (selected?.stance === "regular" ? [selected.key] : []),
  selection: () => (selected?.stance === "regular" ? new Set([selected.key]) : null),
  onTap: (key) => openTrick(key, "regular"),
  onTapEmpty: () => { if (sheet.isOpen && sheet.detent === "medium") sheet.close(); },
  onGestureStart: () => picker.hide(),
  onZoneChange: (changes) => toast(`<b>${esc(store.name(changes[0].key))}</b> moved to ${SIDES[changes[0].zone]}`),
  ...(PHONE
    ? {
        onLongPress: (key, anchor, g) => {
          const orb = anchor.closest(".orb");
          orb?.classList.add("held");
          menu.show({ key, stance: "regular", anchor, origin: { x: g.sx, y: g.sy }, onHide: () => orb?.classList.remove("held") });
        },
        onLongMove: (key, dx, dy, e) => menu.track(e.clientX, e.clientY),
        onLongEnd: () => menu.release(),
      }
    : {
        onHover: (key, anchor) => picker.show(key, "regular", anchor),
        onHoverEnd: () => picker.scheduleHide(300),
      }),
});
$("#map").addEventListener("contextmenu", (e) => {
  const orb = e.target.closest(".orb");
  if (!orb) return;
  e.preventDefault();
  picker.hide();
  menu.show({ key: orb.dataset.k, stance: "regular", anchor: orb.querySelector(".dot") });
});

/* ---------- stances: segmented control + swipe rows ---------- */

let stance = "regular";

function segHtml(options, current, attr, small = false) {
  const i = Math.max(0, options.findIndex(([v]) => v === current));
  return `<div class="nx-seg${small ? " small" : ""}" role="tablist" style="--n:${options.length}">
    <span class="thumb" style="width:calc((100% - 4px) / ${options.length});transform:translateX(${i * 100}%)"></span>
    ${options.map(([v, l]) => `<button type="button" role="tab" ${attr}="${v}" aria-selected="${v === current}">${l}</button>`).join("")}</div>`;
}

function moveThumb(seg, button) {
  const buttons = [...seg.querySelectorAll("button")];
  const i = buttons.indexOf(button);
  seg.querySelector(".thumb").style.transform = `translateX(${i * 100}%)`;
  for (const b of buttons) b.setAttribute("aria-selected", String(b === button));
}

function renderStanceSeg() {
  $(".nx-segwrap").innerHTML = segHtml(STANCES.map((s) => [s, STANCE_LABEL[s]]), stance, "data-stance");
}

$("[data-page=stances]").addEventListener("click", (e) => {
  const b = e.target.closest("[data-stance]");
  if (!b) return;
  moveThumb(b.closest(".nx-seg"), b);
  haptic(5);
  stance = b.dataset.stance;
  setTimeout(renderStanceList, 120);
});

function stanceDots(key) {
  return STANCES.map((st) => `<span title="${STANCE_LABEL[st]}" style="opacity:${st === stance ? 1 : 0.55}">${dotSvg(store.level(key, st), st === stance ? 18 : 12)}</span>`).join("");
}

function renderStanceList() {
  const M = buildModel(store, { stance, include: selected?.stance === stance ? [selected.key] : [] });
  const colors = store.state.sideColors;
  const palette = store.pref("palette");
  let h = "";
  for (const side of SIDE_ORDER) {
    const rows = M.nodes.filter((n) => n.side === side).sort((a, b) => a.fl - b.fl || a.ay - b.ay);
    if (!rows.length) continue;
    h += `<div class="nx-gh">${bandIconSvg(side, colors)}${SIDES[side]}</div><div class="nx-group">`;
    for (const n of rows) {
      const lv = n.lv;
      const lead = lv >= 2 ? (lv === 3 ? "Locked in ✓" : "Locked in") : "Landed";
      h += `<div class="nx-srow" data-k="${esc(n.k)}">
        <div class="nx-sact lead${lv >= 2 ? " lock" : ""}"><span>${lead}</span></div>
        <div class="nx-sact trail"><button type="button" data-act="0">Not yet</button><button type="button" data-act="1">Want it</button></div>
        <div class="nx-srow-in" role="button" tabindex="0" aria-label="${esc(n.name)}: ${LEVELS[lv]}. Swipe right to level up, left for want it.">
          <i style="background:${tone(n.col, palette)}"></i>
          <span class="nm">${esc(n.name)}<small>${LEVELS[lv]}</small></span>
          <span class="lv${lv ? " on" : ""}" data-levels>${stanceDots(n.k)}</span>
        </div>
      </div>`;
    }
    h += `</div>`;
  }
  $("#stanceList").innerHTML = h || `<p class="nx-foot">No tricks to show. Set Show to Everything in Settings.</p>`;
  $("#stanceTip").textContent = PHONE
    ? "Swipe right to level up. Swipe left for Want it. Hold for every level. Tap to open."
    : "Drag a row right to level up, left for Want it. Hover the dots for every level. Click to open.";
}

function act(key, st, value) {
  const result = store.setLevel(key, st, value);
  if (!result.ok) {
    haptic([12, 40, 12]);
    toast(`${WANT_LIMIT} wants max. Drop one first: ${result.wants.map((w) => esc(store.name(w.key, w.stance))).join(", ")}.`);
    return false;
  }
  if (result.changed) {
    haptic(10);
    toast(`<b>${esc(store.name(key, st))}</b> · ${LEVELS[value]}`);
  }
  return true;
}

function bindSwipes(list) {
  let g = null;
  let openRow = null;
  const TRAIL = 168;
  const inner = (row) => row.querySelector(".nx-srow-in");
  const setX = (row, x) => {
    row._x = x;
    inner(row).style.transform = x ? `translateX(${x}px)` : "";
    row.querySelector(".lead").style.visibility = x > 0 ? "visible" : "hidden";
    row.querySelector(".trail").style.visibility = x < 0 ? "visible" : "hidden";
  };
  const springTo = (row, to, done) => {
    row._stop?.();
    row._stop = spring({ from: row._x || 0, to, stiffness: 420, damping: 36, onUpdate: (x) => setX(row, x), onComplete: done });
  };
  const closeOpen = () => {
    if (openRow) springTo(openRow, 0);
    openRow = null;
  };

  const start = (row, x, y, touch) => {
    if (openRow && openRow !== row) closeOpen();
    row._stop?.();
    g = { row, x0: x, y0: y, base: row._x || 0, mode: null, touch, armed: false };
    if (touch) {
      g.hold = setTimeout(() => {
        if (!g || g.mode) return;
        g.mode = "hold";
        row.classList.add("held");
        menu.show({ key: row.dataset.k, stance, anchor: row.querySelector(".lv"), origin: { x, y }, onHide: () => row.classList.remove("held") });
      }, 460);
    }
  };
  const move = (x, y, e) => {
    if (!g) return;
    const dx = x - g.x0;
    const dy = y - g.y0;
    if (g.mode === "hold") {
      e.preventDefault();
      menu.track(x, y);
      return;
    }
    if (!g.mode) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      clearTimeout(g.hold);
      g.mode = Math.abs(dx) > Math.abs(dy) * 1.15 ? "swipe" : "scroll";
      if (g.mode === "swipe") picker.hide();
    }
    if (g.mode !== "swipe") return;
    e.preventDefault();
    const row = g.row;
    const w = row.clientWidth;
    let nx = g.base + dx;
    const lv = store.level(row.dataset.k, stance);
    if (nx > 0 && lv === 3) nx = Math.pow(nx, 0.6);
    if (nx < -TRAIL) nx = -TRAIL - Math.pow(-nx - TRAIL, 0.85);
    setX(row, nx);
    const leadArmed = nx > Math.min(130, w * 0.32) && lv < 3;
    const trailArmed = nx < -w * 0.62;
    const armed = leadArmed || trailArmed;
    row.querySelector(".lead").classList.toggle("armed", leadArmed);
    row.querySelector(".trail").classList.toggle("armed", trailArmed);
    if (armed !== g.armed) haptic(armed ? 8 : 3);
    g.armed = armed;
  };
  const end = () => {
    if (!g) return;
    const { row, mode } = g;
    clearTimeout(g.hold);
    g = null;
    if (mode === "hold") {
      menu.release();
      return;
    }
    if (mode !== "swipe") return;
    row._swiped = true;
    setTimeout(() => { row._swiped = false; }, 60);
    const x = row._x || 0;
    const w = row.clientWidth;
    const key = row.dataset.k;
    const lv = store.level(key, stance);
    row.querySelector(".lead").classList.remove("armed");
    row.querySelector(".trail").classList.remove("armed");
    if (x > Math.min(130, w * 0.32) && lv < 3) {
      springTo(row, 0, () => act(key, stance, lv >= 2 ? 3 : 2));
    } else if (x < -w * 0.62) {
      springTo(row, 0, () => act(key, stance, 1));
    } else if (x < -70) {
      springTo(row, -TRAIL);
      openRow = row;
    } else springTo(row, 0);
  };

  list.addEventListener("touchstart", (e) => {
    const row = e.target.closest(".nx-srow");
    if (!row || e.touches.length !== 1 || e.target.closest(".trail button")) return;
    start(row, e.touches[0].clientX, e.touches[0].clientY, true);
  }, { passive: true });
  list.addEventListener("touchmove", (e) => move(e.touches[0].clientX, e.touches[0].clientY, e), { passive: false });
  list.addEventListener("touchend", end);
  list.addEventListener("touchcancel", end);

  list.addEventListener("mousedown", (e) => {
    const row = e.target.closest(".nx-srow");
    if (!row || e.button !== 0 || e.target.closest(".trail button")) return;
    start(row, e.clientX, e.clientY, false);
    const mm = (ev) => move(ev.clientX, ev.clientY, ev);
    const mu = () => {
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mouseup", mu);
      end();
    };
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
  });

  list.addEventListener("click", (e) => {
    const actBtn = e.target.closest(".trail button");
    if (actBtn) {
      const row = actBtn.closest(".nx-srow");
      springTo(row, 0, () => act(row.dataset.k, stance, Number(actBtn.dataset.act)));
      openRow = null;
      return;
    }
    const row = e.target.closest(".nx-srow");
    if (!row || row._swiped || menu.open) return;
    if (openRow) {
      closeOpen();
      return;
    }
    openTrick(row.dataset.k, stance);
  });
  list.addEventListener("keydown", (e) => {
    const row = e.target.closest(".nx-srow");
    if (row && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      openTrick(row.dataset.k, stance);
    }
  });
  list.addEventListener("contextmenu", (e) => {
    const row = e.target.closest(".nx-srow");
    if (!row) return;
    e.preventDefault();
    menu.show({ key: row.dataset.k, stance, anchor: row.querySelector(".lv") });
  });
  if (!PHONE) {
    let t = 0;
    list.addEventListener("pointerover", (e) => {
      const lvEl = e.target.closest("[data-levels]");
      if (!lvEl || e.pointerType !== "mouse" || g) return;
      clearTimeout(t);
      t = setTimeout(() => picker.show(lvEl.closest(".nx-srow").dataset.k, stance, lvEl, { showStance: true }), 180);
    });
    list.addEventListener("pointerout", (e) => {
      const lvEl = e.target.closest("[data-levels]");
      if (!lvEl || lvEl.contains(e.relatedTarget)) return;
      clearTimeout(t);
      picker.scheduleHide(300);
    });
  }
}
bindSwipes($("#stanceList"));

/* ---------- wants ---------- */

function routeHtml(key, st) {
  const M = buildModel(store, { stance: st, include: [key], filter: "all" });
  const route = routeTo(M, key);
  const stops = route.map((n) => `<span class="stop${n.lv >= 2 || n.k === "" ? " got" : ""}">${dotSvg(n.k === "" ? 2 : n.lv, 14)}${esc(n.name)}</span>`);
  const missing = route.slice(0, -1).filter((n) => n.k !== "" && n.lv < 2);
  return {
    html: `<div class="nx-route">${stops.join(`<span class="bar"></span>`)}</div>`,
    warn: missing.length ? `Fundamentals first: land ${missing.map((n) => esc(n.name)).join(" and ")}.` : "",
  };
}

function renderWants({ enter = null } = {}) {
  const wants = store.wants();
  let h = "";
  wants.forEach((w, i) => {
    const r = routeHtml(w.key, w.stance);
    const col = tone(store.color(w.key), store.pref("palette"));
    const id = `${w.stance}|${w.key}`;
    h += `<article class="nx-want${enter === id ? " enter" : ""}" style="--c:${col}" data-want="${esc(id)}">
      <div class="nx-want-top"><div><div class="meta">Want ${i + 1} of ${WANT_LIMIT} · ${STANCE_LABEL[w.stance]} · ${SIDES[store.side(w.key)]}</div><h3>${esc(store.name(w.key, w.stance))}</h3></div>
        <button class="nx-icon" type="button" data-open aria-label="Open breakdown">${CHEVRON}</button></div>
      ${r.html}
      ${r.warn ? `<div class="nx-warn">${r.warn}</div>` : ""}
      <div class="nx-want-actions">
        <button class="nx-hold" type="button" data-land><i></i><span>Hold when you land it</span></button>
        <button class="nx-ghost" type="button" data-drop>Drop</button>
      </div>
    </article>`;
  });
  for (let i = wants.length; i < WANT_LIMIT; i++) {
    h += `<button class="nx-slot" type="button" data-choose><span class="plus">+</span><span><b>Empty slot</b>Choose a trick to chase</span></button>`;
  }
  $("#wantCards").innerHTML = h;
  for (const btn of document.querySelectorAll("[data-land]")) bindHold(btn);
}

function bindHold(btn, ms = 750) {
  const fill = btn.querySelector("i");
  let start = 0;
  let raf = 0;
  let done = false;
  const reset = () => {
    cancelAnimationFrame(raf);
    btn.classList.remove("holding");
    if (done) return;
    fill.style.transition = "width .25s ease-out";
    fill.style.width = "0";
  };
  const tick = () => {
    const p = Math.min(1, (performance.now() - start) / ms);
    fill.style.width = `${p * 100}%`;
    if (p < 1) raf = requestAnimationFrame(tick);
    else {
      done = true;
      btn.classList.remove("holding");
      landWant(btn);
    }
  };
  btn.addEventListener("pointerdown", (e) => {
    if (done || (e.pointerType === "mouse" && e.button !== 0)) return;
    try { btn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    start = performance.now();
    fill.style.transition = "none";
    btn.classList.add("holding");
    haptic(5);
    raf = requestAnimationFrame(tick);
  });
  for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) btn.addEventListener(t, reset);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
  btn.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && !done) {
      e.preventDefault();
      done = true;
      landWant(btn);
    }
  });
}

function confetti(x, y, colors) {
  if (reduced()) return;
  for (let i = 0; i < 30; i++) {
    const p = document.createElement("i");
    p.className = "nx-confetti";
    p.style.background = colors[i % colors.length];
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    document.body.append(p);
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
    const v = 140 + Math.random() * 200;
    const dx = Math.cos(a) * v;
    const dy = Math.sin(a) * v;
    p.animate([
      { transform: "translate(-50%, -50%) rotate(0deg)", opacity: 1 },
      { transform: `translate(${dx * 0.8}px, ${dy * 0.8}px) rotate(${Math.random() * 360}deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy + 220}px) rotate(${Math.random() * 720 - 360}deg)`, opacity: 0 },
    ], { duration: 1100 + Math.random() * 500, easing: "cubic-bezier(.15,.7,.35,1)" }).onfinish = () => p.remove();
  }
}

function landWant(btn) {
  const card = btn.closest("[data-want]");
  const lk = card.dataset.want;
  const i = lk.indexOf("|");
  const st = lk.slice(0, i);
  const key = lk.slice(i + 1);
  const r = btn.getBoundingClientRect();
  const colors = [...new Set([store.color(key), ...parentKeys(key).map((k) => store.color(k)), "#ffffff", "#ffcc4d"])];
  confetti(r.left + r.width / 2, r.top + r.height / 2, colors);
  haptic([14, 40, 24]);
  card.classList.add("leave");
  setTimeout(() => {
    store.setLevel(key, st, 2);
    toast(`Landed <b>${esc(store.name(key, st))}</b>. Pick your next want.`, 5000);
  }, 420);
}

$("#wantCards").addEventListener("click", (e) => {
  const card = e.target.closest("[data-want]");
  if (e.target.closest("[data-choose]")) {
    openWantPicker();
    return;
  }
  if (!card) return;
  const lk = card.dataset.want;
  const i = lk.indexOf("|");
  const st = lk.slice(0, i);
  const key = lk.slice(i + 1);
  if (e.target.closest("[data-drop]")) {
    card.classList.add("leave");
    setTimeout(() => {
      store.setLevel(key, st, 0);
      toast(`Dropped <b>${esc(store.name(key, st))}</b>`);
    }, 300);
  } else if (e.target.closest("[data-open]")) openTrick(key, st);
});

function openWantPicker() {
  const M = buildModel(store, { stance: "regular", filter: "all" });
  const landed = new Set(M.nodes.filter((n) => n.lv >= 2).map((n) => n.k));
  landed.add("");
  const options = M.nodes.filter((n) => n.k !== "" && n.lv === 0);
  const next = options.filter((n) => parentKeys(n.k).some((p) => landed.has(p)))
    .sort((a, b) => a.fl - b.fl || a.name.localeCompare(b.name));
  const nextSet = new Set(next.map((n) => n.k));
  const rest = options.filter((n) => !nextSet.has(n.k)).sort((a, b) => a.fl - b.fl || a.name.localeCompare(b.name));
  const palette = store.pref("palette");
  const row = (n) => {
    const from = parentKeys(n.k).filter((p) => landed.has(p)).map((p) => (p === "" ? "Ollie" : store.name(p)));
    return `<button class="nx-row" type="button" data-pickwant="${esc(n.k)}" data-name="${esc(n.name.toLowerCase())}"><i style="width:10px;height:10px;border-radius:50%;background:${tone(n.col, palette)}"></i><span class="grow1">${esc(n.name)}${from.length ? `<small style="display:block;color:var(--muted);font-size:12px">1 step from ${esc(from[0])}</small>` : ""}</span></button>`;
  };
  const node = document.createElement("div");
  node.className = "nx-pick";
  node.innerHTML = `
    <input class="nx-search" type="search" placeholder="Search tricks" aria-label="Search tricks" autocomplete="off">
    ${next.length ? `<div><div class="nx-gh" style="margin-top:0">Next up</div><div class="nx-group">${next.map(row).join("")}</div></div>` : ""}
    ${rest.length ? `<div><div class="nx-gh">Everything else</div><div class="nx-group">${rest.map(row).join("")}</div></div>` : ""}`;
  node.addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    for (const b of node.querySelectorAll("[data-pickwant]")) b.hidden = q && !b.dataset.name.includes(q);
  });
  node.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pickwant]");
    if (!b) return;
    const key = b.dataset.pickwant;
    if (act(key, "regular", 1)) {
      sheet.close();
      setTimeout(() => renderWants({ enter: `regular|${key}` }), 60);
    }
  });
  selected = null;
  sheet.setContent(node, { title: "Choose a want" });
  sheet.open("large");
}

/* ---------- settings ---------- */

const PREF_ROWS = [
  ["filter", "Show", [["all", "Everything"], ["next", "Next stops"]]],
  ["layout", "Layout", [["auto", "Auto"], ["custom", "Custom"]]],
  ["palette", "Colors", [["color", "Color"], ["bw", "B&W"]]],
  ["rider", "I ride", [["regular", "Regular"], ["goofy", "Goofy"]]],
];
const LEVEL_NOTES = ["Haven't tried it yet", "Chasing it. 3 max.", "Landed it at least once", "Can do it any time"];

function renderSettings() {
  const palette = store.pref("palette");
  $("#settingsBody").innerHTML = `
    <div class="nx-gh">Map</div>
    <div class="nx-group">${PREF_ROWS.map(([name, label, opts]) => `
      <div class="nx-row"><span class="grow1">${label}</span>${segHtml(opts, store.pref(name), `data-pref-${name}`, true)}</div>`).join("")}
    </div>
    <div class="nx-gh">Levels</div>
    <div class="nx-group nx-legend">${LEVELS.map((label, i) => `
      <div class="nx-row"><svg width="30" height="30" viewBox="-15 -15 30 30" aria-hidden="true">${orbSvg(i, "#8a8a8a", palette)}</svg><span class="grow1">${label}</span><span class="val">${LEVEL_NOTES[i]}</span></div>`).join("")}
    </div>
    <p class="nx-foot">${PHONE ? "Hold an orb or row to set its level. Tap to open it." : "Hover an orb or the dots to set a level. Click to open it. Right-click for the full menu."}</p>
    <div class="nx-gh">Keep from this version</div>
    <div class="nx-group" style="padding:4px 8px">${featureList("native", { compact: true })}</div>
    <div class="nx-gh">Test version</div>
    <div class="nx-group">
      <a class="nx-row link" href="./"><span class="grow1">All test versions</span></a>
      <a class="nx-row link" href="../"><span class="grow1">Back to my map</span></a>
      <button class="nx-row danger" type="button" data-reset>Fresh copy of my map</button>
    </div>
    <p class="nx-foot">Changes here only affect this test copy of your map.</p>`;
}
bindPicks($("#settingsBody"));
$("#settingsBody").addEventListener("click", (e) => {
  if (e.target.closest("[data-reset]")) {
    confirmReset(store);
    return;
  }
  const b = e.target.closest("button[role=tab]");
  if (!b) return;
  const attr = [...b.attributes].find((a) => a.name.startsWith("data-pref-"));
  if (!attr) return;
  moveThumb(b.closest(".nx-seg"), b);
  haptic(5);
  setTimeout(() => store.setPref(attr.name.slice(10), attr.value), 170);
});

/* ---------- new trick ---------- */

$("#newTrick").addEventListener("click", () => {
  openTrick("", "regular", "large");
  toast("Start from the ollie and add ingredients below.");
  setTimeout(() => breakdown.focusAdd(), 80);
});

/* ---------- render ---------- */

function renderVisible() {
  if (tab === "map") map.render();
  else if (tab === "stances") renderStanceList(); else if (tab === "wants") renderWants();
  else renderSettings();
}

store.subscribe(() => renderVisible());
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (menu.open) menu.hide();
  else if (sheet.isOpen && !e.target.closest?.("input,select,textarea")) sheet.close();
});

renderStanceSeg();
setTab(tab, { animate: false });
