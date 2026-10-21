// Test 5 · Studio: made to share. A profile card and an Instagram story
// image of your map (saved as PNG), color presets, and a preview of the
// first-time setup a friend would get.

import { labStore, mountLabBar, makeToast, PHONE } from "./lab.js";
import { createStore, splitLevelKey, migrate, STORAGE_KEY } from "../js/core/store.js";
import { MapView } from "../js/app/mapview.js";
import { LevelPicker } from "../js/app/levelpicker.js";
import { Breakdown } from "../js/app/breakdown.js";
import { Sheet } from "../js/app/sheet.js";
import { buildModel, LAYOUT } from "../js/core/model.js";
import { SIDES, SIDE_ORDER, WANT_LIMIT, DEFAULT_INGREDIENTS, DEFAULT_SIDE_COLORS, parentKeys } from "../js/core/catalog.js";
import { esc, edgePath, orbSvg, tone, wrapWords } from "../js/core/draw.js";

const store = labStore("studio");
const $ = (sel, root = document) => root.querySelector(sel);
const toast = makeToast($("#toast"));
mountLabBar($("#labBar"), store);

const FONT = `Geist, -apple-system, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif`;
const MONO = `"Geist Mono", ui-monospace, Menlo, Consolas, monospace`;
const HOST = location.host && !/^(127\.|localhost|\[)/.test(location.host) ? location.host : "Trick Map";

/* ---------- artwork themes ---------- */

const THEMES = {
  night: { name: "Night", swatch: "#0f0f0e", bg: "#0f0f0e", fg: "#f2f2ee", muted: "#8e8e88", faint: "#4b4b47", line: "#2a2a28", chip: "#1c1c1a", sun: "#241f13", earth: "#171716", moon: "#12131c" },
  day: { name: "Day", swatch: "#fafaf8", bg: "#fafaf8", fg: "#111111", muted: "#7c7c76", faint: "#c9c8c2", line: "#e2e1dc", chip: "#efeee9", sun: "#fff4dc", earth: "#f2f2ee", moon: "#e7e8f1" },
  vivid: { name: "Vivid", swatch: "linear-gradient(135deg,#ffcc4d,#8c5cf0)", bg: "#0b0b14", fg: "#ffffff", muted: "#a3a3b8", faint: "#4a4a63", line: "#262640", chip: "#1a1a2e", sun: "#2a2011", earth: "#121a16", moon: "#141633", glow: true },
};
const THEME_KEY = "trickmap.lab.studio.theme";
let themeId = (() => { try { return localStorage.getItem(THEME_KEY) || "night"; } catch { return "night"; } })();
if (!THEMES[themeId]) themeId = "night";

/* ---------- numbers for the card ---------- */

function stats(s) {
  const M = buildModel(s, { stance: "regular", filter: "all" });
  const got = M.nodes.filter((n) => n.lv >= 2);
  const bySide = { sun: 0, earth: 0, moon: 0 };
  for (const n of got) if (n.k !== "") bySide[n.side]++;
  const dominant = SIDE_ORDER.reduce((a, b) => (bySide[b] > bySide[a] ? b : a), "earth");
  const other = Object.keys(s.state.levels).filter((lk) => s.state.levels[lk] >= 2 && !lk.startsWith("regular|") && !s.isAddonOnly(splitLevelKey(lk).key)).length;
  const best = [...got].filter((n) => n.k !== "").sort((a, b) => b.lv - a.lv || b.fl - a.fl).slice(0, 3).map((n) => n.name);
  return {
    landed: got.length,
    locked: M.nodes.filter((n) => n.lv === 3).length,
    other,
    wants: s.wants().map((w) => s.name(w.key, w.stance)),
    dominant: bySide[dominant] ? dominant : null,
    best,
  };
}

/* ---------- static map for the images ---------- */

function mapArt(s, t, box, id, { labelSize = 20, orbK = 1.5, lineW = 4 } = {}) {
  const M = buildModel(s, { stance: "regular", filter: "all" });
  const xs = M.nodes.map((n) => n.x);
  const x0 = Math.min(LAYOUT.X0, ...xs) - 36;
  const x1 = Math.max(LAYOUT.X0 + M.maxFl * LAYOUT.COLW, ...xs) + 36;
  const k = Math.min(box.w / (x1 - x0), box.h / M.H);
  const ox = box.x + (box.w - (x1 - x0) * k) / 2 - x0 * k;
  const oy = box.y + (box.h - M.H * k) / 2;
  const P = (n) => ({ x: n.x * k + ox, y: n.y * k + oy });
  const palette = s.pref("palette");
  const lit = (str) => str.replace(/var\(--(bg|fg|faint|muted)\)/g, (m, v) => t[v]);
  let g = `<defs><clipPath id="${id}-clip"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${box.r || 0}"/></clipPath></defs><g clip-path="url(#${id}-clip)">`;
  for (const side of SIDE_ORDER) {
    const b = M.bands[side];
    const y0 = side === "sun" ? box.y : b.y0 * k + oy;
    const y1 = side === "moon" ? box.y + box.h : b.y1 * k + oy;
    g += `<rect x="${box.x}" y="${y0}" width="${box.w}" height="${y1 - y0}" fill="${t[side]}"/>`;
    g += `<text x="${box.x + 22}" y="${b.y0 * k + oy + 34}" font-family='${MONO}' font-size="${Math.round(labelSize * 0.8)}" letter-spacing="3" fill="${t.muted}">${SIDES[side].toUpperCase()}</text>`;
  }
  for (const e of M.edges) {
    const strong = e.a.lv >= 2 && e.b.lv >= 2;
    g += `<path d="${edgePath(P(e.a), P(e.b))}" fill="none" stroke="${tone(e.c, palette)}" stroke-width="${lineW}" stroke-linejoin="round" stroke-linecap="round" opacity="${strong ? 0.95 : 0.4}"/>`;
  }
  for (const n of M.nodes) {
    const p = P(n);
    g += `<g transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)}) scale(${orbK})">${lit(orbSvg(n.lv, tone(n.col, palette), palette))}</g>`;
  }
  for (const n of M.nodes) {
    if (n.lv < 2) continue;
    const p = P(n);
    const lines = wrapWords(n.name, Math.max(90, LAYOUT.COLW * k - 10), labelSize);
    const halo = t[n.side] || t.bg;
    g += `<text x="${p.x.toFixed(1)}" y="${(p.y + 13 * orbK + labelSize).toFixed(1)}" text-anchor="middle" font-family='${FONT}' font-size="${labelSize}" font-weight="600" fill="${t.fg}" stroke="${halo}" stroke-width="${labelSize * 0.3}" stroke-linejoin="round" paint-order="stroke">${lines.map((l, i) => `<tspan x="${p.x.toFixed(1)}" dy="${i ? labelSize * 1.12 : 0}">${esc(l)}</tspan>`).join("")}</text>`;
  }
  return `${g}</g>`;
}

function glow(t, s, id, w, h) {
  if (!t.glow) return "";
  const c = s.state.sideColors;
  return `<defs><radialGradient id="${id}-g1" cx="85%" cy="8%" r="60%"><stop offset="0" stop-color="${c.sun}" stop-opacity=".45"/><stop offset="1" stop-color="${c.sun}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}-g2" cx="8%" cy="95%" r="65%"><stop offset="0" stop-color="#8c5cf0" stop-opacity=".45"/><stop offset="1" stop-color="#8c5cf0" stop-opacity="0"/></radialGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#${id}-g1)"/><rect width="${w}" height="${h}" fill="url(#${id}-g2)"/>`;
}

const textW = (str, size) => str.length * size * 0.56;

function chips(list, x, y, size, t, maxW) {
  let out = "";
  let cx = x;
  for (const name of list) {
    const w = Math.min(maxW, textW(name, size) + size * 1.6);
    if (cx + w > x + maxW) break;
    out += `<rect x="${cx}" y="${y}" width="${w}" height="${size * 2}" rx="${size}" fill="${t.chip}" stroke="${t.line}" stroke-width="2"/>
      <text x="${cx + w / 2}" y="${y + size * 1.34}" text-anchor="middle" font-family='${FONT}' font-size="${size}" font-weight="600" fill="${t.fg}">${esc(name)}</text>`;
    cx += w + size * 0.6;
  }
  return out;
}

function header(s) {
  const p = s.state.profile;
  const name = p.name.trim();
  const handle = p.handle.trim().replace(/^@?/, "@");
  return { name, handle: handle === "@" ? "" : handle };
}

function cardSvg(s, t, id) {
  const W = 1080;
  const H = 1350;
  const st = stats(s);
  const { name, handle } = header(s);
  const rider = s.pref("rider") === "goofy" ? "GOOFY" : "REGULAR";
  const sub = [handle || "@handle", st.dominant ? `${SIDES[st.dominant]} rider` : "Just getting started"].join("  ·  ");
  const nums = [[st.landed, "landed"], [st.locked, "locked in"], [st.other, "other stances"], [`${st.wants.length}/${WANT_LIMIT}`, "wants"]];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${t.bg}"/>${glow(t, s, id, W, H)}
    <text x="70" y="104" font-family='${MONO}' font-size="26" letter-spacing="7" fill="${t.muted}">TRICK MAP</text>
    <rect x="${1010 - textW(rider, 24) * 1.25 - 40}" y="70" width="${textW(rider, 24) * 1.25 + 40}" height="48" rx="24" fill="none" stroke="${t.line}" stroke-width="2"/>
    <text x="${1010 - (textW(rider, 24) * 1.25 + 40) / 2}" y="102" text-anchor="middle" font-family='${MONO}' font-size="24" letter-spacing="3" fill="${t.fg}">${rider}</text>
    <text x="70" y="212" font-family='${FONT}' font-size="80" font-weight="700" letter-spacing="-2" fill="${name ? t.fg : t.faint}">${esc(name || "Your name")}</text>
    <text x="72" y="266" font-family='${FONT}' font-size="32" fill="${t.muted}">${esc(sub)}</text>
    ${mapArt(s, t, { x: 60, y: 310, w: 960, h: 640, r: 30 }, id, { labelSize: 19, orbK: 1.35, lineW: 3.4 })}
    ${nums.map(([v, l], i) => `<text x="${70 + i * 245}" y="1046" font-family='${FONT}' font-size="74" font-weight="700" letter-spacing="-2" fill="${t.fg}">${esc(String(v))}</text>
      <text x="${72 + i * 245}" y="1088" font-family='${FONT}' font-size="26" fill="${t.muted}">${l}</text>`).join("")}
    <text x="70" y="1162" font-family='${MONO}' font-size="22" letter-spacing="4" fill="${t.muted}">${st.wants.length ? "CHASING" : "BEST TRICKS"}</text>
    ${chips(st.wants.length ? st.wants : st.best.length ? st.best : ["Ollie"], 70, 1184, 28, t, 940)}
    <text x="70" y="1300" font-family='${MONO}' font-size="22" letter-spacing="2" fill="${t.muted}">${esc(HOST)}</text>
  </svg>`;
}

function storySvg(s, t, id) {
  const W = 1080;
  const H = 1920;
  const st = stats(s);
  const { name, handle } = header(s);
  const nums = [[st.landed, "landed"], [st.locked, "locked in"], [`${st.wants.length}/${WANT_LIMIT}`, "wants"]];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${t.bg}"/>${glow(t, s, id, W, H)}
    <text x="70" y="268" font-family='${MONO}' font-size="30" letter-spacing="9" fill="${t.muted}">MY TRICK MAP</text>
    <text x="66" y="372" font-family='${FONT}' font-size="104" font-weight="700" letter-spacing="-3" fill="${name ? t.fg : t.faint}">${esc(name || "Your name")}</text>
    <text x="70" y="432" font-family='${FONT}' font-size="40" fill="${t.muted}">${esc([handle || "@handle", s.pref("rider") === "goofy" ? "Goofy" : "Regular", st.dominant ? `${SIDES[st.dominant]} rider` : ""].filter(Boolean).join("  ·  "))}</text>
    ${mapArt(s, t, { x: 46, y: 480, w: 988, h: 1010, r: 40 }, id, { labelSize: 21, orbK: 1.5, lineW: 3.8 })}
    ${nums.map(([v, l], i) => `<text x="${70 + i * 330}" y="1606" font-family='${FONT}' font-size="88" font-weight="700" letter-spacing="-3" fill="${t.fg}">${esc(String(v))}</text>
      <text x="${72 + i * 330}" y="1652" font-family='${FONT}' font-size="30" fill="${t.muted}">${l}</text>`).join("")}
    ${st.wants.length ? `<text x="70" y="1728" font-family='${MONO}' font-size="24" letter-spacing="5" fill="${t.muted}">CHASING</text>${chips(st.wants, 70, 1750, 30, t, 940)}` : ""}
    <text x="${W / 2}" y="1876" text-anchor="middle" font-family='${MONO}' font-size="24" letter-spacing="3" fill="${t.muted}">${esc(HOST)}</text>
  </svg>`;
}

/* ---------- PNG export ---------- */

async function toPng(svg, w, h) {
  // Web fonts don't load inside an image, so the system fonts listed after Geist are used.
  const img = new Image();
  img.decoding = "async";
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/png"));
}

async function exportArt(kind, { share }) {
  const t = THEMES[themeId];
  const svg = kind === "story" ? storySvg(store, t, "x") : cardSvg(store, t, "x");
  const [w, h] = kind === "story" ? [1080, 1920] : [1080, 1350];
  const filename = `trick-map-${kind}.png`;
  let blob;
  try {
    blob = await toPng(svg, w, h);
  } catch {
    toast("Couldn't make the image on this browser.");
    return;
  }
  const file = typeof File === "function" ? new File([blob], filename, { type: "image/png" }) : null;
  if (share && file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "My Trick Map" });
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(kind === "story" ? "Story image saved. Post it from your photos." : "Card saved.");
}

/* ---------- color presets ---------- */

function realLook() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = migrate(JSON.parse(raw));
    return { id: "yours", name: "Yours", note: "From your real map", ings: Object.fromEntries(s.ingredients.map((i) => [i.id, i.color])), sides: s.sideColors };
  } catch {
    return null;
  }
}

const LOOKS = [
  realLook(),
  { id: "original", name: "Original", note: "Trick Map defaults", ings: Object.fromEntries(DEFAULT_INGREDIENTS.map((i) => [i.id, i.color])), sides: { ...DEFAULT_SIDE_COLORS } },
  { id: "neon", name: "Neon", note: "Loud", ings: { kf: "#ff2bd6", bs: "#00e5ff", fb: "#39ff14", hf: "#ffe600", fs: "#ff6b00", bb: "#8a5cff", bvb: "#ff3864", bvf: "#00ffa3" }, sides: { sun: "#ffe600", earth: "#39ff14", moon: "#8a5cff" } },
  { id: "sunset", name: "Sunset", note: "Warm", ings: { kf: "#ff5e5b", bs: "#ffb26b", fb: "#ffd93d", hf: "#c86b98", fs: "#8a5cc2", bb: "#5a3fa0", bvb: "#ff8fab", bvf: "#f9c74f" }, sides: { sun: "#ffb26b", earth: "#c86b98", moon: "#3d2c8d" } },
  { id: "ice", name: "Ice", note: "Cool", ings: { kf: "#7dd3fc", bs: "#a5b4fc", fb: "#99f6e4", hf: "#c4b5fd", fs: "#67e8f9", bb: "#818cf8", bvb: "#f0abfc", bvf: "#bef264" }, sides: { sun: "#e0f2fe", earth: "#99f6e4", moon: "#312e81" } },
  { id: "street", name: "Street", note: "Earthy", ings: { kf: "#e4572e", bs: "#f3a712", fb: "#a8c686", hf: "#669bbc", fs: "#29335c", bb: "#8d6a9f", bvb: "#db7f67", bvf: "#c2c5aa" }, sides: { sun: "#f3a712", earth: "#a8c686", moon: "#29335c" } },
].filter(Boolean);

function lookMatches(s, look) {
  return SIDE_ORDER.every((side) => s.state.sideColors[side] === look.sides[side]?.toLowerCase())
    && s.state.ingredients.every((i) => !look.ings[i.id] || look.ings[i.id].toLowerCase() === i.color);
}

function applyLook(s, look) {
  s.batch(`Look: ${look.name}`, () => {
    for (const [id, color] of Object.entries(look.ings)) if (s.ing(id)) s.updateIngredient(id, { color });
    for (const side of SIDE_ORDER) if (look.sides[side]) s.setSideColor(side, look.sides[side]);
  });
}

function looksHtml(s, attr = "data-look") {
  return `<div class="st-looks">${LOOKS.map((l) => `<button class="st-look" type="button" ${attr}="${l.id}" aria-pressed="${lookMatches(s, l)}">
    <span class="st-sw">${["kf", "bs", "hf", "fs", "bb", "fb"].map((id) => `<i style="background:${l.ings[id] || "#888"}"></i>`).join("")}</span>
    <span>${esc(l.name)}<br><small>${esc(l.note)}</small></span></button>`).join("")}</div>`;
}

/* ---------- page ---------- */

const main = $("#main");
function renderPage() {
  const p = store.state.profile;
  main.innerHTML = `
    <div class="st-head"><div class="mono">Studio</div><h1>Show it off</h1><p>Your profile card and a story image of your map. Everything here uses a copy of your map.</p></div>
    <section class="st-sec">
      <div class="st-art" id="cardArt"></div>
      <div class="st-side">
        <h2>Profile card</h2><p>Post it or send it to the homie.</p>
        <div class="st-fields">
          <label class="st-field"><span>Name</span><input data-prof="name" value="${esc(p.name)}" placeholder="Your name" autocomplete="off" maxlength="40"></label>
          <label class="st-field"><span>Instagram</span><input data-prof="handle" value="${esc(p.handle)}" placeholder="@handle" autocomplete="off" autocapitalize="off" maxlength="40"></label>
        </div>
        <div class="st-field"><span>Look</span><div class="st-themes">${Object.entries(THEMES).map(([id, t]) => `<button class="st-theme" type="button" data-theme="${id}" aria-pressed="${id === themeId}"><i style="background:${t.swatch}"></i>${t.name}</button>`).join("")}</div></div>
        <div class="st-actions"><button class="btn primary" type="button" data-share="card">Share card</button><button class="btn" type="button" data-save="card">Save image</button></div>
        <p class="st-note">Your name and handle stay on this device.</p>
      </div>
    </section>
    <section class="st-sec">
      <div class="st-art story" id="storyArt"></div>
      <div class="st-side">
        <h2>Instagram story</h2><p>A 1080 × 1920 image of your whole map with your numbers. Share it, then pick Instagram and Story.</p>
        <div class="st-actions"><button class="btn primary" type="button" data-share="story">Share to story</button><button class="btn" type="button" data-save="story">Save image</button></div>
        <p class="st-note">${PHONE ? "Share opens your phone's share sheet." : "On a computer, Share downloads the image (or opens your system share menu)."}</p>
      </div>
    </section>
    <section class="st-side">
      <h2>Color presets</h2><p>Recolor every ingredient and side in one tap. Only changes this test copy.</p>
      <div id="looks">${looksHtml(store)}</div>
    </section>
    <section class="st-friend">
      <div><h2>First-time setup</h2><p>What a friend sees the first time they open Trick Map: how they ride, what they can already do, 3 wants and their colors. About 30 seconds.</p></div>
      <button class="btn primary" type="button" data-onboard style="padding:11px 18px">Preview setup</button>
    </section>`;
  paintArt();
}

function paintArt() {
  const t = THEMES[themeId];
  const card = $("#cardArt");
  const story = $("#storyArt");
  if (card) card.innerHTML = cardSvg(store, t, "card");
  if (story) story.innerHTML = storySvg(store, t, "story");
  for (const el of [card, story]) if (el) el.style.background = t.bg;
  const looks = $("#looks");
  if (looks) looks.innerHTML = looksHtml(store);
}

main.addEventListener("input", (e) => {
  const f = e.target.dataset.prof;
  if (f) store.setProfile({ [f]: e.target.value }, { source: "profile" });
});
main.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.theme) {
    themeId = b.dataset.theme;
    try { localStorage.setItem(THEME_KEY, themeId); } catch { /* ignore */ }
    for (const x of main.querySelectorAll("[data-theme]")) x.setAttribute("aria-pressed", String(x.dataset.theme === themeId));
    paintArt();
  } else if (b.dataset.share) exportArt(b.dataset.share, { share: true });
  else if (b.dataset.save) exportArt(b.dataset.save, { share: false });
  else if (b.dataset.look) {
    const look = LOOKS.find((l) => l.id === b.dataset.look);
    applyLook(store, look);
    toast(`<b>${esc(look.name)}</b> colors on`);
  } else if (b.hasAttribute("data-onboard")) onboard.open();
});

/* ---------- first-time setup preview (sandboxed friend) ---------- */

const FRIEND_KEY = "trickmap.lab.studio-friend";
const BASICS = ["", "bs:1", "fs:1", "fb:1", "bb:1", "kf:1", "hf:1", "bs:2", "bs:1,kf:1", "fs:1,kf:1", "bs:1,hf:1", "fs:1,hf:1", "bb:1,kf:1", "bs:2,kf:1"];
const STEPS = ["welcome", "ride", "can", "want", "you", "done"];
const BOARD = (goofy) => `<svg width="150" height="60" viewBox="0 0 150 60" aria-hidden="true"><rect x="6" y="18" width="138" height="26" rx="13" fill="#3b3833" stroke="#d9b98a" stroke-width="2"/>
  <text x="${goofy ? 126 : 24}" y="12" text-anchor="middle" font-family='${MONO}' font-size="9" letter-spacing="1" fill="currentColor">NOSE</text>
  <path d="${goofy ? "M118 31h14m-5-5 5 5-5 5" : "M32 31H18m5-5-5 5 5 5"}" fill="none" stroke="#ffcc4d" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
  <ellipse cx="${goofy ? 92 : 58}" cy="31" rx="10" ry="7" fill="#f4f1ea"/><ellipse cx="${goofy ? 46 : 104}" cy="31" rx="10" ry="7" fill="#f4f1ea" opacity=".75"/></svg>`;
const CHECK = `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor" opacity=".12"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const onboard = {
  el: $("#onboard"),
  fs: null,
  step: 0,
  open() {
    try { localStorage.removeItem(FRIEND_KEY); } catch { /* ignore */ }
    this.fs = createStore({ key: FRIEND_KEY, snapshots: false });
    this.step = 0;
    this.el.hidden = false;
    document.body.classList.add("locked");
    this.render();
  },
  close() {
    this.fs?.discard();
    this.fs = null;
    this.el.hidden = true;
    document.body.classList.remove("locked");
  },
  go(d) {
    this.step = Math.max(0, Math.min(STEPS.length - 1, this.step + d));
    this.render();
    this.el.scrollTop = 0;
  },
  render() {
    const fs = this.fs;
    const step = STEPS[this.step];
    const rider = fs.pref("rider");
    let body = "";
    let next = "Next";
    if (step === "welcome") {
      body = `<p class="st-ob-tag">Preview · this is what a friend sees</p>
        <h2 class="st-big">Map every trick you can do.</h2>
        <div class="st-points">
          <div>${CHECK}<span>Every trick is an ollie plus ingredients: flips, shoves, 180s.</span></div>
          <div>${CHECK}<span>Sun tricks, Moon tricks and the Earth in between.</span></div>
          <div>${CHECK}<span>Hold a trick to mark it landed, locked in, or one of your 3 wants.</span></div>
        </div>`;
      next = "Set it up";
    } else if (step === "ride") {
      body = `<h2>How do you ride?</h2><p>This flips the foot positions so they match you.</p>
        <div class="st-choice">${[["regular", "Regular", "Left foot forward"], ["goofy", "Goofy", "Right foot forward"]].map(([v, l, d]) =>
          `<button type="button" data-ride="${v}" aria-pressed="${rider === v}">${BOARD(v === "goofy")}${l}<small>${d}</small></button>`).join("")}</div>`;
    } else if (step === "can") {
      body = `<h2>What can you already do?</h2><p>Tap the ones you've landed. You can change it any time.</p>
        <div class="st-tricks">${BASICS.map((k) => `<button type="button" data-can="${esc(k)}" aria-pressed="${fs.level(k) >= 2}"><i style="background:${fs.color(k)}"></i>${esc(fs.name(k))}</button>`).join("")}</div>`;
    } else if (step === "want") {
      const M = buildModel(fs, { stance: "regular", filter: "all" });
      const has = (k) => k === "" || (M.map.get(k)?.lv ?? 0) >= 2;
      const ideas = M.nodes.filter((n) => n.k !== "" && n.lv < 2 && parentKeys(n.k).filter((p) => !fs.isAddonOnly(p)).some(has))
        .sort((a, b) => b.lv - a.lv || a.fl - b.fl).slice(0, 14);
      body = `<h2>Pick up to 3 you want next</h2><p>${fs.wants().length}/${WANT_LIMIT} picked. These are one step from what you can do.</p>
        <div class="st-tricks">${ideas.map((n) => `<button type="button" data-want="${esc(n.k)}" aria-pressed="${n.lv === 1}"><i style="background:${n.col}"></i>${esc(n.name)}</button>`).join("")}</div>`;
    } else if (step === "you") {
      const p = fs.state.profile;
      body = `<h2>Make it yours</h2><p>Optional. Shows on your profile card.</p>
        <div class="st-fields">
          <label class="st-field"><span>Name</span><input data-fprof="name" value="${esc(p.name)}" placeholder="Your name" autocomplete="off" maxlength="40"></label>
          <label class="st-field"><span>Instagram</span><input data-fprof="handle" value="${esc(p.handle)}" placeholder="@handle" autocomplete="off" autocapitalize="off" maxlength="40"></label>
        </div>
        <div class="st-field"><span>Colors</span>${looksHtml(fs, "data-flook")}</div>`;
      next = "Finish";
    } else {
      body = `<h2>You're set.</h2><p>Your map is ready. This is your card.</p>
        <div class="st-art">${cardSvg(fs, THEMES.night, "ob")}</div>
        <p class="st-note">This was a preview. Nothing here touches your map.</p>`;
      next = "Back to Studio";
    }
    this.el.innerHTML = `
      <div class="st-ob-top"><div class="st-dots">${STEPS.map((_, i) => `<i class="${i <= this.step ? "on" : ""}"></i>`).join("")}</div><button class="btn" type="button" data-obclose>Close preview</button></div>
      <div class="st-ob-body">${body}</div>
      <div class="st-ob-foot">${this.step > 0 && step !== "done" ? `<button class="btn" type="button" data-back>Back</button>` : ""}<button class="btn primary" type="button" data-next>${next}</button></div>`;
  },
};

onboard.el.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || !onboard.fs) return;
  const fs = onboard.fs;
  if (b.hasAttribute("data-obclose")) onboard.close();
  else if (b.hasAttribute("data-back")) onboard.go(-1);
  else if (b.hasAttribute("data-next")) {
    if (STEPS[onboard.step] === "done") onboard.close();
    else onboard.go(1);
  } else if (b.dataset.ride) {
    fs.setPref("rider", b.dataset.ride);
    onboard.render();
  } else if (b.dataset.can !== undefined) {
    const k = b.dataset.can;
    fs.setLevel(k, "regular", fs.level(k) >= 2 ? 0 : 2);
    b.setAttribute("aria-pressed", String(fs.level(k) >= 2));
  } else if (b.dataset.want !== undefined) {
    const k = b.dataset.want;
    const r = fs.setLevel(k, "regular", fs.level(k) === 1 ? 0 : 1);
    if (!r.ok) toast(`${WANT_LIMIT} max. Tap one to drop it first.`);
    onboard.render();
  } else if (b.dataset.flook) {
    applyLook(fs, LOOKS.find((l) => l.id === b.dataset.flook));
    onboard.render();
  }
});
onboard.el.addEventListener("input", (e) => {
  const f = e.target.dataset.fprof;
  if (f && onboard.fs) onboard.fs.setProfile({ [f]: e.target.value });
});

/* ---------- map overlay (edit the map these images show) ---------- */

const picker = new LevelPicker(store, { hoverMode: !PHONE, toast });
const sheet = new Sheet({ label: "Trick breakdown", onClose: () => { selected = null; if (mapOpen) map.render(); } });
const breakdown = new Breakdown(store, { onNavigate: (key) => openTrick(key), onClose: () => sheet.close(), toast });
sheet.body.append(breakdown.el);
let selected = null;
let mapOpen = false;
function openTrick(key) {
  picker.hide();
  selected = key;
  breakdown.render(key);
  sheet.open();
  sheet.el.scrollTop = 0;
  map.render();
}
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
  $("#mapOverlay").hidden = false;
  document.body.classList.add("locked");
  map.render();
});
$("#closeMap").addEventListener("click", () => {
  mapOpen = false;
  $("#mapOverlay").hidden = true;
  document.body.classList.remove("locked");
  picker.hide();
});

store.subscribe((info) => {
  if (info.source === "profile") paintArt();
  else renderPageKeepingFocus();
  if (mapOpen) map.render();
});
function renderPageKeepingFocus() {
  const focused = document.activeElement?.dataset?.prof;
  if (focused) {
    paintArt();
    return;
  }
  renderPage();
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (sheet.isOpen) sheet.close();
  else if (!onboard.el.hidden) onboard.close();
  else if (mapOpen) $("#closeMap").click();
});

renderPage();
