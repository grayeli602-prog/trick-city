// Shared plumbing for the test versions: a sandboxed copy of the user's map,
// the "back to my map" bar, feature picks, prefs controls and toasts.
//
// Each version saves to its own key (trickmap.lab.<id>), seeded once from the
// real map. Nothing here ever writes to the real map.

import { createStore, STORAGE_KEY } from "../js/core/store.js";
import { esc } from "../js/core/draw.js";

export const PHONE = document.documentElement.classList.contains("phone");

export const VERSIONS = [
  {
    id: "native", n: 1, name: "Native", tag: "App Store feel",
    blurb: "Feels like an iPhone app: tab bar, sheets you swipe down, springy motion, swipe a row to mark it landed.",
    features: [
      ["tabs", "Bottom tab bar"],
      ["sheet", "Sheet that stops at half or full, swipe down to close"],
      ["spring", "Springy motion and press feedback"],
      ["swipe", "Swipe a row to mark it landed"],
      ["menu", "Hold menu with blurred background"],
      ["wants", "Wants tab with 3 big cards"],
    ],
  },
  {
    id: "pro", n: 2, name: "Pro tool", tag: "Linear and Figma feel",
    blurb: "A power tool: search any trick, undo and redo, filters, select many and move them together, an inspector.",
    features: [
      ["search", "Search any trick (Cmd K or /)"],
      ["undo", "Undo and redo"],
      ["filters", "Filters: side, level, wants"],
      ["multi", "Select many and move together"],
      ["inspector", "Inspector with exact position"],
      ["align", "Align and spread out orbs"],
      ["keys", "Keyboard shortcuts"],
    ],
  },
  {
    id: "progress", n: 3, name: "Progress", tag: "Strava feel",
    blurb: "Your skating as stats: rings for how locked in each zone is, a timeline of what you landed and when, and what to learn next.",
    features: [
      ["rings", "Rings per zone"],
      ["timeline", "Timeline of what you landed and when"],
      ["next", "Next up picks"],
      ["gaps", "Fundamentals check"],
      ["stances", "Stance coverage"],
    ],
  },
  {
    id: "spatial", n: 4, name: "Spatial", tag: "The map is the app",
    blurb: "Just the map. Zoom in for more detail, tap a trick to fly to it and light up its path from the ollie, minimap in the corner.",
    features: [
      ["zoom", "More detail as you zoom in"],
      ["path", "Tap to fly there and light its path"],
      ["minimap", "Minimap"],
      ["pan", "One finger pans on empty space"],
      ["layers", "Stance layers for the whole map"],
    ],
  },
  {
    id: "studio", n: 5, name: "Studio", tag: "Show it off",
    blurb: "Made to share: first-time setup for friends, an Instagram story image of your map, and a profile card.",
    features: [
      ["setup", "First-time setup for friends"],
      ["story", "Instagram story image"],
      ["card", "Profile card"],
      ["looks", "Color presets"],
    ],
  },
];

export const version = (id) => VERSIONS.find((v) => v.id === id);

/* ---------- storage helpers ---------- */

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
function remove(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

const copyKey = (id) => `trickmap.lab.${id}`;
const seededKey = (id) => `trickmap.lab.${id}.seeded`;

/** The sandboxed copy of the real map for one version. */
export function labStore(id, { undo = false, key = copyKey(id), seed = true } = {}) {
  const fresh = read(key) == null;
  const store = createStore({ key, seedKey: seed ? STORAGE_KEY : null, snapshots: false, undo });
  if (fresh) write(seededKey(id), String(Date.now()));
  store.labId = id;
  return store;
}

export function seededAt(id) {
  const t = Number(read(seededKey(id)));
  return Number.isFinite(t) && t > 0 ? t : null;
}

export const hasRealMap = () => read(STORAGE_KEY) != null;

/** Throw away this copy and take a fresh one from the real map. */
export function resetCopy(store) {
  store.discard();
  remove(seededKey(store.labId));
  location.reload();
}

/* ---------- feature picks ---------- */

const PICKS_KEY = "trickmap.lab.picks";

export function getPicks() {
  try {
    const p = JSON.parse(read(PICKS_KEY));
    return p && typeof p === "object" && !Array.isArray(p) ? p : {};
  } catch {
    return {};
  }
}

export function isPicked(vid, fid) {
  return (getPicks()[vid] || []).includes(fid);
}

export function setPick(vid, fid, on) {
  const picks = getPicks();
  const list = new Set(picks[vid] || []);
  if (on) list.add(fid);
  else list.delete(fid);
  picks[vid] = [...list];
  write(PICKS_KEY, JSON.stringify(picks));
  window.dispatchEvent(new CustomEvent("lab-picks"));
}

export function picksText() {
  const picks = getPicks();
  const lines = [];
  for (const v of VERSIONS) {
    const chosen = v.features.filter(([fid]) => (picks[v.id] || []).includes(fid)).map(([, label]) => label);
    if (chosen.length) lines.push(`${v.name}: ${chosen.join(", ")}`);
  }
  return lines.length ? `Trick Map, features I want to keep:\n${lines.join("\n")}` : "";
}

export function pickCount() {
  return Object.values(getPicks()).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
}

export async function sharePicks(toast) {
  const text = picksText();
  if (!text) {
    toast("Tap the hearts on the features you like first.");
    return;
  }
  if (PHONE && navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied. Paste it to Claude.");
  } catch {
    window.prompt("Copy this and paste it to Claude:", text);
  }
}

/* ---------- shared bits of UI ---------- */

export const HEART = `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z" fill="currentColor"/></svg>`;

export function featureList(vid, { compact = false } = {}) {
  const v = version(vid);
  return `<ul class="lab-feats${compact ? " compact" : ""}">${v.features.map(([fid, label]) => {
    const on = isPicked(vid, fid);
    return `<li><button type="button" class="lab-feat" data-pick="${vid}:${fid}" aria-pressed="${on}"><span class="lab-heart">${HEART}</span><span>${esc(label)}</span></button></li>`;
  }).join("")}</ul>`;
}

export function bindPicks(root) {
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick]");
    if (!b) return;
    const [vid, fid] = b.dataset.pick.split(":");
    const on = b.getAttribute("aria-pressed") !== "true";
    setPick(vid, fid, on);
    b.setAttribute("aria-pressed", String(on));
  });
}

const fmtDay = (t) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });

/**
 * The lab bar: a way back to the real map plus a menu for this version
 * (features to keep, a fresh copy, all versions). The back link goes in
 * `host`; the version chip goes in `chipHost` (defaults to the same place).
 */
export function mountLabBar(host, store, { chipHost = host, short = false, tone = "" } = {}) {
  const v = version(store.labId);
  for (const el of new Set([host, chipHost])) {
    el.classList.add("lab-bar");
    if (tone) el.classList.add(tone);
  }
  host.insertAdjacentHTML("afterbegin", `<a class="lab-back" href="../" aria-label="Back to my map"><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>My map</span></a>`);
  chipHost.insertAdjacentHTML("beforeend", `<button class="lab-chip" type="button" aria-expanded="false" aria-haspopup="dialog" aria-label="Test ${v.n}, ${esc(v.name)}. Test version menu"><span class="lab-dot"></span>${short ? `Test ${v.n}` : `Test ${v.n} · ${esc(v.name)}`}</button>`);
  const chip = chipHost.querySelector(".lab-chip");
  const menu = document.createElement("div");
  menu.className = "lab-menu";
  menu.hidden = true;
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", `${v.name} test version`);
  document.body.append(menu);
  bindPicks(menu);

  const paint = () => {
    const at = seededAt(v.id);
    menu.innerHTML = `
      <div class="lab-mh"><b>Test ${v.n} · ${esc(v.name)}</b><span>${esc(v.tag)}</span></div>
      <p class="lab-note">This is a copy of your map${at ? ` from ${fmtDay(at)}` : ""}. Nothing you do here changes your real map.</p>
      <div class="mono">Keep these features</div>
      ${featureList(v.id, { compact: true })}
      <div class="lab-mrow">
        <a class="btn" href="./">All test versions</a>
        <button class="btn" type="button" data-reset>Fresh copy of my map</button>
      </div>
      <a class="btn primary lab-home" href="../">Back to my map</a>`;
  };
  const place = () => {
    const r = chip.getBoundingClientRect();
    const w = Math.min(320, window.innerWidth - 16);
    menu.style.width = `${w}px`;
    const left = r.left + w > window.innerWidth - 8 ? r.right - w : r.left;
    menu.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, left)))}px`;
    const below = r.bottom + 8;
    if (r.top > window.innerHeight / 2) {
      menu.style.top = "";
      menu.style.bottom = `${Math.round(window.innerHeight - r.top + 8)}px`;
    } else {
      menu.style.bottom = "";
      menu.style.top = `${Math.round(below)}px`;
    }
  };
  const open = () => {
    paint();
    menu.hidden = false;
    place();
    chip.setAttribute("aria-expanded", "true");
  };
  const close = () => {
    menu.hidden = true;
    chip.setAttribute("aria-expanded", "false");
  };
  chip.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden ? open() : close();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !chip.contains(e.target)) close();
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  window.addEventListener("resize", () => { if (!menu.hidden) place(); });
  menu.addEventListener("click", (e) => {
    if (e.target.closest("[data-reset]")) confirmReset(store);
  });
  return { open, close };
}

export function confirmReset(store) {
  if (confirm("Throw away the changes in this test version and start again from your real map?")) resetCopy(store);
}

/* ---------- prefs ---------- */

export const PREFS = [
  ["filter", "Show", [["all", "Everything"], ["next", "Next stops"]]],
  ["layout", "Layout", [["auto", "Auto"], ["custom", "Custom"]]],
  ["palette", "Colors", [["color", "Color"], ["bw", "Black and white"]]],
  ["rider", "I ride", [["regular", "Regular"], ["goofy", "Goofy"]]],
];

export function prefsHtml(store, names = PREFS.map((p) => p[0])) {
  return PREFS.filter(([name]) => names.includes(name)).map(([name, label, opts]) => `
    <div class="seg lab-pref" role="group" aria-label="${label}"><span class="mono">${label}</span>${opts.map(([v, l]) =>
      `<button type="button" data-pref="${name}" data-val="${v}" aria-pressed="${store.pref(name) === v}">${l}</button>`).join("")}</div>`).join("");
}

export function bindPrefs(root, store) {
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pref]");
    if (b) store.setPref(b.dataset.pref, b.dataset.val);
  });
}

/* ---------- toast ---------- */

export function makeToast(el, { idle = () => "" } = {}) {
  let timer = 0;
  const show = (html, ms = 4200) => {
    el.innerHTML = html;
    el.classList.add("on");
    clearTimeout(timer);
    timer = setTimeout(() => {
      el.innerHTML = idle();
      el.classList.toggle("on", !!el.innerHTML);
    }, ms);
  };
  el.innerHTML = idle();
  el.classList.toggle("on", !!el.innerHTML);
  return show;
}

/** Short buzz on phones that support it (Android). */
export function haptic(ms = 8) {
  try { navigator.vibrate?.(ms); } catch { /* ignore */ }
}
