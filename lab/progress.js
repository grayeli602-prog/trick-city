// Test 3 · Progress: your skating as stats. Zone rings for how much is
// locked in, next up picks with reasons, a fundamentals check, a timeline
// of what you landed and when, stance coverage and weekly activity.

import { labStore, mountLabBar, makeToast, PHONE } from "./lab.js";
import { MapView } from "../js/app/mapview.js";
import { LevelPicker } from "../js/app/levelpicker.js";
import { Breakdown } from "../js/app/breakdown.js";
import { Sheet } from "../js/app/sheet.js";
import { buildModel } from "../js/core/model.js";
import { SIDES, SIDE_ORDER, STANCES, STANCE_LABEL, LEVELS, WANT_LIMIT, parentKeys } from "../js/core/catalog.js";
import { splitLevelKey, levelKey } from "../js/core/store.js";
import { esc, dotSvg, tone } from "../js/core/draw.js";

const store = labStore("progress");
const $ = (sel, root = document) => root.querySelector(sel);
const toast = makeToast($("#toast"));
mountLabBar($("#labBar"), store);

const DAY = 864e5;
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const startOfWeek = (t) => { const d = new Date(startOfDay(t)); const wd = (d.getDay() + 6) % 7; return d.getTime() - wd * DAY; };
const fmtDay = (t) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;

/** Side color that stays visible on the page background. */
function visible(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.3 * ((n >> 16) & 255) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255;
  if (dark() && lum < 0.3) return "#8f97d6";
  if (!dark() && lum > 0.85) return "#c9a227";
  return hex;
}

/* ---------- numbers ---------- */

function levelOf(M, key) {
  if (key === "" && M.stance === "regular" && !M.map.get("")?.lv) return 2; // the regular ollie counts as known
  return M.map.get(key)?.lv ?? 0;
}

function zoneStats(M) {
  const out = {};
  for (const side of SIDE_ORDER) {
    const nodes = M.nodes.filter((n) => n.side === side);
    out[side] = { total: nodes.length, landed: nodes.filter((n) => n.lv >= 2).length, locked: nodes.filter((n) => n.lv === 3).length };
  }
  return out;
}

/** Baseline level for every level key at the start of tracking. */
function baseline() {
  const s = store.state;
  const base = { ...s.levels };
  const seen = new Set();
  for (const h of s.history) {
    const lk = levelKey(h.k, h.st);
    if (seen.has(lk)) continue;
    seen.add(lk);
    if (h.from) base[lk] = h.from;
    else delete base[lk];
  }
  return base;
}

function events() {
  const s = store.state;
  const base = baseline();
  const levels = { ...base };
  const landedCount = () => Object.values(levels).filter((v) => v >= 2).length;
  const sideHas = (side, min, st = null) => Object.keys(levels).some((lk) => {
    const { stance, key } = splitLevelKey(lk);
    return levels[lk] >= min && store.side(key) === side && (!st || st === stance);
  });
  const stanceHas = (st) => Object.keys(levels).some((lk) => levels[lk] >= 2 && splitLevelKey(lk).stance === st);
  const MILESTONES = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100];
  const out = [];
  for (const h of s.history) {
    const lk = levelKey(h.k, h.st);
    const side = store.side(h.k);
    const badges = [];
    if (h.to >= 2 && h.from < 2) {
      if (!sideHas(side, 2)) badges.push(`First trick on the ${SIDES[side]} side`);
      if (h.st !== "regular" && !stanceHas(h.st)) badges.push(`First ${h.st} trick`);
      const before = landedCount();
      if (MILESTONES.includes(before + 1)) badges.push(`${before + 1} tricks landed`);
    }
    if (h.to === 3 && h.from < 3 && !sideHas(side, 3)) badges.push(`First ${SIDES[side]} lock-in`);
    if (h.to) levels[lk] = h.to;
    else delete levels[lk];
    out.push({ ...h, badges });
  }
  return { list: out.reverse(), base };
}

function nextUp(M, zones) {
  const shares = SIDE_ORDER.filter((s) => zones[s].total).map((s) => [s, zones[s].locked / zones[s].total]);
  const weakest = shares.sort((a, b) => a[1] - b[1])[0]?.[0];
  const name = (k) => (k === "" ? "Ollie" : store.name(k));
  const picks = [];
  for (const n of M.nodes) {
    if (n.k === "" || n.lv >= 2) continue;
    const parents = parentKeys(n.k).filter((p) => !store.isAddonOnly(p));
    const got = parents.filter((p) => levelOf(M, p) >= 2);
    if (!got.length) continue;
    const locked = parents.filter((p) => levelOf(M, p) === 3 || p === "");
    const all = got.length === parents.length;
    const score = locked.length * 3 + got.length * 2 + (all ? 3 : 0) - n.fl * 1.2 + (n.lv === 1 ? 2.5 : 0) + (n.side === weakest ? 1.5 : 0);
    const bits = [];
    if (all) bits.push(`Built from ${got.map((p) => `${name(p)}${levelOf(M, p) === 3 || p === "" ? "" : " (landed)"}`).join(" and ")}, which you have`);
    else bits.push(`You have ${got.map(name).join(" and ")}. Still need ${parents.filter((p) => !got.includes(p)).map(name).join(" and ")}`);
    if (n.lv === 1) bits.push("one of your wants");
    if (n.side === weakest && zones[weakest].total) bits.push(`${SIDES[weakest]} is your least locked-in side`);
    picks.push({ n, score, why: bits.join(" · ") });
  }
  return picks.sort((a, b) => b.score - a.score).slice(0, 3);
}

function gaps() {
  const out = [];
  for (const st of STANCES) {
    const M = buildModel(store, { stance: st, filter: "all" });
    for (const n of M.nodes) {
      if (n.k === "" || n.lv < 1) continue;
      const need = parentKeys(n.k).filter((p) => !store.isAddonOnly(p) && (p !== "" || st !== "regular") && levelOf(M, p) < 2);
      if (need.length) out.push({ n, st, need: need.map((p) => (p === "" ? `${STANCE_LABEL[st]} ollie` : store.name(p, st))) });
    }
  }
  return out.sort((a, b) => b.n.lv - a.n.lv).slice(0, 5);
}

/* ---------- rendering ---------- */

let firstPaint = true;

function orbIcon(lv, col, size = 22) {
  return dotSvg(lv, size).replace(/var\(--fg\)/g, lv === 3 ? col : "var(--fg)");
}

function trickRow({ key, st = "regular", lv, title, why, tag = "" }) {
  const col = tone(store.color(key), store.pref("palette"));
  return `<button class="pg-trick" type="button" data-trick="${esc(key)}" data-st="${st}">
    <span class="orb" data-lvl>${orbIcon(lv, col)}</span>
    <span class="t"><span>${esc(title)}</span>${tag}</span>
    <span class="go" aria-hidden="true">›</span>
    <span class="why">${why}</span>
  </button>`;
}

function ringsSvg(zones) {
  const size = 156;
  const c = size / 2;
  const radii = { sun: 64, earth: 48, moon: 32 };
  const colors = store.state.sideColors;
  let s = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Locked in per zone">`;
  let lockedAll = 0;
  let totalAll = 0;
  for (const side of SIDE_ORDER) {
    const r = radii[side];
    const L = 2 * Math.PI * r;
    const z = zones[side];
    lockedAll += z.locked;
    totalAll += z.total;
    const landed = z.total ? z.landed / z.total : 0;
    const locked = z.total ? z.locked / z.total : 0;
    const col = visible(colors[side]);
    const dash = (f) => (firstPaint ? `0 ${L}` : `${f * L} ${L}`);
    s += `<g transform="rotate(-90 ${c} ${c})" fill="none" stroke-width="11" stroke-linecap="round">
      <circle cx="${c}" cy="${c}" r="${r}" stroke="var(--soft)"/>
      <circle class="pg-ring" data-f="${landed}" data-l="${L}" cx="${c}" cy="${c}" r="${r}" stroke="${col}" stroke-opacity=".32" stroke-dasharray="${dash(landed)}"/>
      <circle class="pg-ring" data-f="${locked}" data-l="${L}" cx="${c}" cy="${c}" r="${r}" stroke="${col}" stroke-dasharray="${dash(locked)}"/>
    </g>`;
  }
  const pct = totalAll ? Math.round((lockedAll / totalAll) * 100) : 0;
  s += `<text class="pg-center" x="${c}" y="${c + 4}" text-anchor="middle">${pct}%</text><text class="pg-center-sub" x="${c}" y="${c + 18}" text-anchor="middle">LOCKED</text></svg>`;
  return s;
}

function weeksSvg(list) {
  const now = Date.now();
  const w0 = startOfWeek(now);
  const weeks = Array.from({ length: 8 }, (_, i) => ({ t: w0 - (7 - i) * 7 * DAY, n: 0 }));
  for (const e of list) {
    if (!(e.to >= 2 && e.to > e.from)) continue;
    const i = 7 - Math.round((w0 - startOfWeek(e.t)) / (7 * DAY));
    if (i >= 0 && i < 8) weeks[i].n++;
  }
  const max = Math.max(3, ...weeks.map((w) => w.n));
  const W = 320;
  const H = 92;
  const bw = 24;
  const gap = (W - 8 * bw) / 7;
  let s = `<svg class="pg-chart" viewBox="0 0 ${W} ${H + 22}" width="100%" role="img" aria-label="Tricks landed per week">`;
  weeks.forEach((w, i) => {
    const h = Math.max(3, (w.n / max) * (H - 18));
    const x = i * (bw + gap);
    s += `<rect class="bar${i === 7 ? " now" : ""}" x="${x}" y="${H - h}" width="${bw}" height="${h}" rx="5"/>`;
    if (w.n) s += `<text class="val" x="${x + bw / 2}" y="${H - h - 5}" text-anchor="middle">${w.n}</text>`;
    if (i % 2 === 1 && i < 7) s += `<text x="${x + bw / 2}" y="${H + 16}" text-anchor="middle">${fmtDay(w.t)}</text>`;
    if (i === 7) s += `<text x="${x + bw}" y="${H + 16}" text-anchor="end">This week</text>`;
  });
  const empty = weeks.every((w) => !w.n);
  return `${s}</svg>${empty ? `<p class="lead" style="margin:0">Your weeks fill in as you land and lock in tricks.</p>` : ""}`;
}

function render() {
  const s = store.state;
  const M = buildModel(store, { stance: "regular", filter: "all" });
  const zones = zoneStats(M);
  const { list, base } = events();
  const landed = M.nodes.filter((n) => n.lv >= 2).length;
  const locked = M.nodes.filter((n) => n.lv === 3).length;
  const real = (lk) => !store.isAddonOnly(splitLevelKey(lk).key);
  const otherStances = Object.keys(s.levels).filter((lk) => s.levels[lk] >= 2 && !lk.startsWith("regular|") && real(lk)).length;
  const weekStart = startOfWeek(Date.now());
  const thisWeek = list.filter((e) => e.t >= weekStart && e.to >= 2 && e.to > e.from).length;
  const since = s.history[0]?.t;
  const colors = s.sideColors;

  const picks = nextUp(M, zones);
  const gapList = gaps();

  // Timeline: group by day, newest first.
  const shown = list.slice(0, 40);
  let lastDay = null;
  let tl = "";
  for (const e of shown) {
    const day = startOfDay(e.t);
    if (day !== lastDay) {
      const diff = Math.round((startOfDay(Date.now()) - day) / DAY);
      tl += `<div class="pg-day">${diff === 0 ? "Today" : diff === 1 ? "Yesterday" : diff < 7 ? new Date(e.t).toLocaleDateString([], { weekday: "long" }) : fmtDay(e.t)}</div>`;
      lastDay = day;
    }
    const name = store.name(e.k, e.st);
    const what = e.to === 3 ? "Locked in" : e.to === 2 ? (e.from === 3 ? "Back to landed:" : "Landed") : e.to === 1 ? "Started chasing" : "Cleared";
    const col = tone(store.color(e.k), store.pref("palette"));
    tl += `<button class="pg-ev" type="button" data-trick="${esc(e.k)}" data-st="${e.st}">
      <span class="orb" data-lvl>${orbIcon(e.to, col, 20)}</span>
      <span class="what">${what} <b>${esc(name)}</b><small>${STANCE_LABEL[e.st]} · ${SIDES[store.side(e.k)]}</small>${e.badges.map((b) => `<span class="badge">${esc(b)}</span>`).join(" ")}</span>
      <time>${fmtTime(e.t)}</time></button>`;
  }
  const before = Object.keys(base).filter((lk) => base[lk] >= 2 && real(lk)).map(splitLevelKey);
  const beforeHtml = before.length ? `<div class="pg-before"><p><b>${before.length} tricks</b> were landed before Trick Map started tracking dates${since ? ` on ${fmtDay(since)}` : ""}.</p>
      <div class="chips">${before.slice(0, 18).map(({ key, stance }) => `<button class="chip" type="button" data-trick="${esc(key)}" data-st="${stance}"><i style="background:${tone(store.color(key), store.pref("palette"))}"></i>${esc(store.name(key, stance))}</button>`).join("")}${before.length > 18 ? `<span class="hint">+${before.length - 18} more</span>` : ""}</div></div>` : "";

  const stanceRows = STANCES.map((st) => {
    const total = M.nodes.length;
    const got = Object.keys(s.levels).filter((lk) => lk.startsWith(`${st}|`) && s.levels[lk] >= 2 && real(lk));
    const lk = got.filter((x) => s.levels[x] === 3).length;
    const ld = got.length - lk;
    const w = (v) => (firstPaint ? 0 : (v / Math.max(1, total)) * 100);
    return `<div class="pg-barrow"><span>${STANCE_LABEL[st]}</span><div class="pg-track"><i class="lk" data-w="${(lk / Math.max(1, total)) * 100}" style="width:${w(lk)}%"></i><i class="ld" data-w="${(ld / Math.max(1, total)) * 100}" style="width:${w(ld)}%"></i></div><span class="n">${got.length}/${total}</span></div>`;
  }).join("");

  $("#main").innerHTML = `
    <section class="pg-card pg-hero">
      <div><h1>Your progress</h1><div class="sub">Regular stance${since ? ` · tracking since ${fmtDay(since)}` : " · tracking starts with your next level-up"}</div></div>
      <div class="pg-nums">
        <div class="pg-num"><b>${landed}</b><span>landed</span></div>
        <div class="pg-num"><b>${locked}</b><span>locked in</span></div>
        <div class="pg-num"><b>${otherStances}</b><span>in other stances</span></div>
        <div class="pg-num"><b class="${thisWeek ? "up" : ""}">${thisWeek ? `+${thisWeek}` : "0"}</b><span>this week</span></div>
      </div>
    </section>

    <div class="pg-col l">
    <section class="pg-card pg-rings">
      <h2>Zones <small>locked in</small></h2>
      <div class="pg-ringwrap">${ringsSvg(zones)}
        <div class="pg-ringlegend">${SIDE_ORDER.map((side) => {
          const z = zones[side];
          return `<div class="pg-ringrow"><i style="background:${visible(colors[side])}"></i><b>${SIDES[side]}</b><span class="pct">${z.total ? Math.round((z.locked / z.total) * 100) : 0}%</span>
            <small>${z.locked} locked in · ${z.landed} landed · ${z.total} tricks</small></div>`;
        }).join("")}</div>
      </div>
    </section>

    <section class="pg-card pg-stances">
      <h2>Stances <small>landed of ${M.nodes.length}</small></h2>
      <div class="pg-bars">${stanceRows}</div>
      <div class="pg-key"><span>Locked in</span><span>Landed</span></div>
    </section>

    <section class="pg-card pg-weeks">
      <h2>Weekly <small>tricks landed or locked in</small></h2>
      ${weeksSvg(list)}
    </section>
    </div>
    <div class="pg-col r">
    <section class="pg-card pg-next">
      <h2>Next up <small>${PHONE ? "hold to set level" : "hover the orb to set level"}</small></h2>
      <div class="pg-list">${picks.length ? picks.map(({ n, why }) => trickRow({ key: n.k, lv: n.lv, title: n.name, why: esc(why), tag: `<span class="pg-tag">${SIDES[n.side]}</span>` })).join("") : `<div class="pg-ok">You've landed everything that's one step away. Add a new trick to keep going.</div>`}</div>
    </section>

    <section class="pg-card pg-gaps">
      <h2>Fundamentals check</h2>
      ${gapList.length ? `<p class="lead">Tricks you landed or want before the tricks they're built from.</p><div class="pg-list">${gapList.map(({ n, st, need }) => trickRow({
        key: n.k, st, lv: n.lv, title: n.name,
        tag: n.lv >= 2 ? `<span class="pg-tag acc">Skipped basics</span>` : `<span class="pg-tag">Want</span>`,
        why: n.lv >= 2 ? `You landed it before ${esc(need.join(" and "))}. Lock in the basics so it sticks.` : `Land ${esc(need.join(" and "))} first.`,
      })).join("")}</div>` : `<div class="pg-ok">No gaps. Every trick you've landed sits on tricks you've landed.</div>`}
    </section>

    <section class="pg-card pg-timeline">
      <h2>Timeline <small>${list.length} changes</small></h2>
      ${tl || `<p class="lead" style="margin:0">Nothing logged yet. ${PHONE ? "Hold" : "Hover"} a trick's orb, set a level, and it shows up here with the date.</p>`}
      ${list.length > shown.length ? `<p class="hint">Showing the latest ${shown.length}.</p>` : ""}
      ${beforeHtml}
    </section>
    </div>`;

  if (firstPaint) {
    firstPaint = false;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      for (const ring of document.querySelectorAll(".pg-ring")) ring.setAttribute("stroke-dasharray", `${Number(ring.dataset.f) * Number(ring.dataset.l)} ${ring.dataset.l}`);
      for (const bar of document.querySelectorAll(".pg-track i")) bar.style.width = `${bar.dataset.w}%`;
    }));
  }
}

/* ---------- breakdown, picker and map ---------- */

const picker = new LevelPicker(store, { hoverMode: !PHONE, toast });
const sheet = new Sheet({ label: "Trick breakdown", onClose: () => { selected = null; if (mapOpen) map.render(); } });
const breakdown = new Breakdown(store, {
  onNavigate: (key) => openTrick(key, breakdown.stance),
  onClose: () => sheet.close(),
  toast,
});
sheet.body.append(breakdown.el);
let selected = null;

function openTrick(key, stance = "regular") {
  picker.hide();
  selected = key;
  breakdown.stance = stance;
  breakdown.render(key);
  sheet.open();
  sheet.el.scrollTop = 0;
  if (mapOpen) map.render();
}

let mapOpen = false;
const overlay = $("#mapOverlay");
const map = new MapView($("#map"), store, {
  projection: "fit",
  wheelZoom: !PHONE,
  include: () => (selected !== null ? [selected] : []),
  selection: () => (selected !== null ? new Set([selected]) : null),
  onTap: (key) => openTrick(key),
  onGestureStart: () => picker.hide(),
  onZoneChange: (changes) => toast(`<b>${esc(store.name(changes[0].key))}</b> moved to ${SIDES[changes[0].zone]}`),
  ...(PHONE
    ? { onLongPress: (key, anchor) => picker.show(key, "regular", anchor) }
    : { onHover: (key, anchor) => picker.show(key, "regular", anchor), onHoverEnd: () => picker.scheduleHide(300) }),
});
$("#mapHint").textContent = PHONE ? "Hold an orb to set its level. Tap to open." : "Hover an orb to set its level. Click to open.";
$("#openMap").addEventListener("click", () => {
  mapOpen = true;
  overlay.hidden = false;
  document.body.classList.add("mapopen");
  map.render();
});
$("#closeMap").addEventListener("click", () => {
  mapOpen = false;
  overlay.hidden = true;
  document.body.classList.remove("mapopen");
  picker.hide();
});

/* Rows: tap opens the breakdown; hover (PC) or hold (phone) the orb sets the level. */
const main = $("#main");
main.addEventListener("click", (e) => {
  const row = e.target.closest("[data-trick]");
  if (!row || row._held) return;
  openTrick(row.dataset.trick, row.dataset.st || "regular");
});
if (!PHONE) {
  let t = 0;
  main.addEventListener("pointerover", (e) => {
    const orb = e.target.closest("[data-lvl]");
    if (!orb || e.pointerType !== "mouse") return;
    const row = orb.closest("[data-trick]");
    clearTimeout(t);
    t = setTimeout(() => picker.show(row.dataset.trick, row.dataset.st, orb, { showStance: row.dataset.st !== "regular" }), 170);
  });
  main.addEventListener("pointerout", (e) => {
    const orb = e.target.closest("[data-lvl]");
    if (!orb || orb.contains(e.relatedTarget)) return;
    clearTimeout(t);
    picker.scheduleHide(300);
  });
}
let hold = null;
main.addEventListener("pointerdown", (e) => {
  const row = e.target.closest("[data-trick]");
  if (!row || e.pointerType === "mouse") return;
  row._held = false;
  hold = {
    row, x: e.clientX, y: e.clientY,
    t: setTimeout(() => {
      row._held = true;
      picker.show(row.dataset.trick, row.dataset.st, row.querySelector("[data-lvl]") || row, { showStance: row.dataset.st !== "regular" });
      try { navigator.vibrate?.(10); } catch { /* ignore */ }
    }, 450),
  };
});
main.addEventListener("pointermove", (e) => {
  if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 8) {
    clearTimeout(hold.t);
    hold = null;
  }
});
const endHold = () => {
  if (!hold) return;
  clearTimeout(hold.t);
  const row = hold.row;
  hold = null;
  setTimeout(() => { row._held = false; }, 350);
};
main.addEventListener("pointerup", endHold);
main.addEventListener("pointercancel", endHold);
main.addEventListener("contextmenu", (e) => { if (e.target.closest("[data-trick]") && PHONE) e.preventDefault(); });

store.subscribe(() => {
  render();
  if (mapOpen) map.render();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (sheet.isOpen) sheet.close();
  else if (mapOpen) $("#closeMap").click();
});
render();
