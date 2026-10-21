// Share: an Instagram story image (1080 × 1920) and a profile card
// (1080 × 1350) of the map, drawn as SVG and saved as PNG.

import { buildModel, LAYOUT } from "../core/model.js";
import { SIDES, SIDE_ORDER, WANT_LIMIT } from "../core/catalog.js";
import { splitLevelKey } from "../core/store.js";
import { esc, edgePath, orbSvg, tone, wrapWords } from "../core/draw.js";
import { Sheet } from "./sheet.js";

const FONT = `Geist, -apple-system, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif`;
const MONO = `"Geist Mono", ui-monospace, Menlo, Consolas, monospace`;
const HOST = typeof location !== "undefined" && location.host && !/^(127\.|localhost|\[)/.test(location.host) ? location.host : "Trick Map";

export const THEMES = {
  night: { name: "Night", swatch: "#0f0f0e", bg: "#0f0f0e", fg: "#f2f2ee", muted: "#8e8e88", faint: "#4b4b47", line: "#2a2a28", chip: "#1c1c1a", sun: "#241f13", earth: "#171716", moon: "#12131c" },
  day: { name: "Day", swatch: "#fafaf8", bg: "#fafaf8", fg: "#111111", muted: "#7c7c76", faint: "#c9c8c2", line: "#e2e1dc", chip: "#efeee9", sun: "#fff4dc", earth: "#f2f2ee", moon: "#e7e8f1" },
  vivid: { name: "Vivid", swatch: "linear-gradient(135deg,#ffcc4d,#8c5cf0)", bg: "#0b0b14", fg: "#ffffff", muted: "#a3a3b8", faint: "#4a4a63", line: "#262640", chip: "#1a1a2e", sun: "#2a2011", earth: "#121a16", moon: "#141633", glow: true },
};
export const SIZES = { story: [1080, 1920], card: [1080, 1350] };

/* ---------- numbers ---------- */

function stats(store) {
  const M = buildModel(store, { stance: "regular", filter: "all" });
  const got = M.nodes.filter((n) => n.lv >= 2);
  const bySide = { sun: 0, earth: 0, moon: 0 };
  for (const n of got) if (n.k !== "") bySide[n.side]++;
  const dominant = SIDE_ORDER.reduce((a, b) => (bySide[b] > bySide[a] ? b : a), "earth");
  const s = store.state;
  return {
    landed: got.length,
    locked: M.nodes.filter((n) => n.lv === 3).length,
    other: Object.keys(s.levels).filter((lk) => s.levels[lk] >= 2 && !lk.startsWith("regular|") && !store.isAddonOnly(splitLevelKey(lk).key)).length,
    wants: store.wants().map((w) => store.name(w.key, w.stance)),
    best: [...got].filter((n) => n.k !== "").sort((a, b) => b.lv - a.lv || b.fl - a.fl).slice(0, 3).map((n) => n.name),
    dominant: bySide[dominant] ? dominant : null,
  };
}

function who(store) {
  const p = store.state.profile;
  const handle = p.handle.trim().replace(/^@?/, "@");
  return { name: p.name.trim(), handle: handle === "@" ? "" : handle };
}

/* ---------- drawing ---------- */

/** The map drawn into a box, with literal colors so it also works as an image. */
function mapArt(store, t, box, id, { labelSize, orbK, lineW }) {
  const M = buildModel(store, { stance: "regular", filter: "all" });
  const xs = M.nodes.map((n) => n.x);
  const x0 = Math.min(LAYOUT.X0, ...xs) - 36;
  const x1 = Math.max(LAYOUT.X0 + M.maxFl * LAYOUT.COLW, ...xs) + 36;
  const k = Math.min(box.w / (x1 - x0), box.h / M.H);
  const ox = box.x + (box.w - (x1 - x0) * k) / 2 - x0 * k;
  const oy = box.y + (box.h - M.H * k) / 2;
  const P = (n) => ({ x: n.x * k + ox, y: n.y * k + oy });
  const palette = store.pref("palette");
  const lit = (svg) => svg.replace(/var\(--(bg|fg|faint|muted)\)/g, (m, v) => t[v]);
  let g = `<defs><clipPath id="${id}-clip"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${box.r}"/></clipPath></defs><g clip-path="url(#${id}-clip)">`;
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
    g += `<text x="${p.x.toFixed(1)}" y="${(p.y + 13 * orbK + labelSize).toFixed(1)}" text-anchor="middle" font-family='${FONT}' font-size="${labelSize}" font-weight="600" fill="${t.fg}" stroke="${t[n.side] || t.bg}" stroke-width="${labelSize * 0.3}" stroke-linejoin="round" paint-order="stroke">${lines.map((l, i) => `<tspan x="${p.x.toFixed(1)}" dy="${i ? labelSize * 1.12 : 0}">${esc(l)}</tspan>`).join("")}</text>`;
  }
  return `${g}</g>`;
}

function glow(t, store, id, w, h) {
  if (!t.glow) return "";
  const sun = store.state.sideColors.sun;
  return `<defs><radialGradient id="${id}-g1" cx="85%" cy="8%" r="60%"><stop offset="0" stop-color="${sun}" stop-opacity=".45"/><stop offset="1" stop-color="${sun}" stop-opacity="0"/></radialGradient>
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

export function cardSvg(store, t, id) {
  const [W, H] = SIZES.card;
  const st = stats(store);
  const { name, handle } = who(store);
  const rider = store.pref("rider") === "goofy" ? "GOOFY" : "REGULAR";
  const pill = textW(rider, 24) * 1.25 + 40;
  const sub = [handle || "@handle", st.dominant ? `${SIDES[st.dominant]} rider` : "Just getting started"].join("  ·  ");
  const nums = [[st.landed, "landed"], [st.locked, "locked in"], [st.other, "other stances"], [`${st.wants.length}/${WANT_LIMIT}`, "wants"]];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${t.bg}"/>${glow(t, store, id, W, H)}
    <text x="70" y="104" font-family='${MONO}' font-size="26" letter-spacing="7" fill="${t.muted}">TRICK MAP</text>
    <rect x="${1010 - pill}" y="70" width="${pill}" height="48" rx="24" fill="none" stroke="${t.line}" stroke-width="2"/>
    <text x="${1010 - pill / 2}" y="102" text-anchor="middle" font-family='${MONO}' font-size="24" letter-spacing="3" fill="${t.fg}">${rider}</text>
    <text x="70" y="212" font-family='${FONT}' font-size="80" font-weight="700" letter-spacing="-2" fill="${name ? t.fg : t.faint}">${esc(name || "Your name")}</text>
    <text x="72" y="266" font-family='${FONT}' font-size="32" fill="${t.muted}">${esc(sub)}</text>
    ${mapArt(store, t, { x: 60, y: 310, w: 960, h: 640, r: 30 }, id, { labelSize: 19, orbK: 1.35, lineW: 3.4 })}
    ${nums.map(([v, l], i) => `<text x="${70 + i * 245}" y="1046" font-family='${FONT}' font-size="74" font-weight="700" letter-spacing="-2" fill="${t.fg}">${esc(String(v))}</text>
      <text x="${72 + i * 245}" y="1088" font-family='${FONT}' font-size="26" fill="${t.muted}">${l}</text>`).join("")}
    <text x="70" y="1162" font-family='${MONO}' font-size="22" letter-spacing="4" fill="${t.muted}">${st.wants.length ? "CHASING" : "BEST TRICKS"}</text>
    ${chips(st.wants.length ? st.wants : st.best.length ? st.best : ["Ollie"], 70, 1184, 28, t, 940)}
    <text x="70" y="1300" font-family='${MONO}' font-size="22" letter-spacing="2" fill="${t.muted}">${esc(HOST)}</text>
  </svg>`;
}

export function storySvg(store, t, id) {
  const [W, H] = SIZES.story;
  const st = stats(store);
  const { name, handle } = who(store);
  const nums = [[st.landed, "landed"], [st.locked, "locked in"], [`${st.wants.length}/${WANT_LIMIT}`, "wants"]];
  const sub = [handle || "@handle", store.pref("rider") === "goofy" ? "Goofy" : "Regular", st.dominant ? `${SIDES[st.dominant]} rider` : ""].filter(Boolean).join("  ·  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${t.bg}"/>${glow(t, store, id, W, H)}
    <text x="70" y="268" font-family='${MONO}' font-size="30" letter-spacing="9" fill="${t.muted}">MY TRICK MAP</text>
    <text x="66" y="372" font-family='${FONT}' font-size="104" font-weight="700" letter-spacing="-3" fill="${name ? t.fg : t.faint}">${esc(name || "Your name")}</text>
    <text x="70" y="432" font-family='${FONT}' font-size="40" fill="${t.muted}">${esc(sub)}</text>
    ${mapArt(store, t, { x: 46, y: 480, w: 988, h: 1010, r: 40 }, id, { labelSize: 21, orbK: 1.5, lineW: 3.8 })}
    ${nums.map(([v, l], i) => `<text x="${70 + i * 330}" y="1606" font-family='${FONT}' font-size="88" font-weight="700" letter-spacing="-3" fill="${t.fg}">${esc(String(v))}</text>
      <text x="${72 + i * 330}" y="1652" font-family='${FONT}' font-size="30" fill="${t.muted}">${l}</text>`).join("")}
    ${st.wants.length ? `<text x="70" y="1728" font-family='${MONO}' font-size="24" letter-spacing="5" fill="${t.muted}">CHASING</text>${chips(st.wants, 70, 1750, 30, t, 940)}` : ""}
    <text x="${W / 2}" y="1876" text-anchor="middle" font-family='${MONO}' font-size="24" letter-spacing="3" fill="${t.muted}">${esc(HOST)}</text>
  </svg>`;
}

/** Rasterize an SVG string to a PNG blob. Web fonts don't load inside an image, so system fonts are used. */
export async function toPng(svg, w, h) {
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

/* ---------- the share sheet ---------- */

const THEME_KEY = "trickmap.share.theme";
const readTheme = () => { try { return localStorage.getItem(THEME_KEY); } catch { return null; } };
const saveTheme = (v) => { try { localStorage.setItem(THEME_KEY, v); } catch { /* ignore */ } };

export class ShareSheet {
  constructor(store, { toast = () => {}, phone = false } = {}) {
    this.store = store;
    this.toast = toast;
    this.phone = phone;
    this.kind = "story";
    this.theme = THEMES[readTheme()] ? readTheme() : "night";
    this.sheet = new Sheet({ className: "sharesheet", label: "Share your map" });
    this.el = document.createElement("div");
    this.el.className = "sin share";
    this.sheet.body.append(this.el);
    this.el.addEventListener("click", (e) => this._click(e));
    this.el.addEventListener("input", (e) => {
      const f = e.target.dataset.prof;
      if (f) store.setProfile({ [f]: e.target.value }, { source: "profile" });
    });
    store.subscribe(() => { if (this.sheet.isOpen) this.paintArt(); });
  }

  open() {
    this.render();
    this.sheet.open();
    this.sheet.el.scrollTop = 0;
  }

  render() {
    const p = this.store.state.profile;
    this.el.innerHTML = `
      <div class="shead"><div><div class="mono">Share</div><h2>Show off your map</h2></div><button class="x" type="button" data-close aria-label="Close">×</button></div>
      <div class="seg share-kind" role="group" aria-label="Image">${[["story", "Instagram story"], ["card", "Profile card"]].map(([v, l]) =>
        `<button type="button" data-kind="${v}" aria-pressed="${this.kind === v}">${l}</button>`).join("")}</div>
      <div class="share-grid">
        <div class="share-art ${this.kind}" data-art></div>
        <div class="share-side">
          <div class="share-fields">
            <label class="share-field"><span class="mono">Name</span><input data-prof="name" value="${esc(p.name)}" placeholder="Your name" autocomplete="off" maxlength="40"></label>
            <label class="share-field"><span class="mono">Instagram</span><input data-prof="handle" value="${esc(p.handle)}" placeholder="@handle" autocomplete="off" autocapitalize="off" maxlength="40"></label>
          </div>
          <div class="share-field"><span class="mono">Look</span><div class="share-themes">${Object.entries(THEMES).map(([id, t]) =>
            `<button type="button" class="share-theme" data-theme="${id}" aria-pressed="${id === this.theme}"><i style="background:${t.swatch}"></i>${t.name}</button>`).join("")}</div></div>
          <div class="row">
            <button class="btn primary" type="button" data-share>${this.kind === "story" ? "Share to story" : "Share card"}</button>
            <button class="btn" type="button" data-save>Save image</button>
          </div>
          <p class="hint">${this.kind === "story" ? "A 1080 × 1920 image of your whole map. Share it, then pick Instagram and Story." : "A 1080 × 1350 card with your numbers and what you're chasing."} Your name and handle stay on this device.</p>
        </div>
      </div>`;
    this.paintArt();
  }

  paintArt() {
    const art = this.el.querySelector("[data-art]");
    if (!art) return;
    const t = THEMES[this.theme];
    art.innerHTML = this.kind === "story" ? storySvg(this.store, t, "share") : cardSvg(this.store, t, "share");
    art.style.background = t.bg;
  }

  _click(e) {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.hasAttribute("data-close")) this.sheet.close();
    else if (b.dataset.kind) {
      this.kind = b.dataset.kind;
      this.render();
    } else if (b.dataset.theme) {
      this.theme = b.dataset.theme;
      saveTheme(this.theme);
      for (const x of this.el.querySelectorAll("[data-theme]")) x.setAttribute("aria-pressed", String(x.dataset.theme === this.theme));
      this.paintArt();
    } else if (b.hasAttribute("data-share")) this.export({ share: true });
    else if (b.hasAttribute("data-save")) this.export({ share: false });
  }

  async export({ share }) {
    const t = THEMES[this.theme];
    const svg = this.kind === "story" ? storySvg(this.store, t, "x") : cardSvg(this.store, t, "x");
    const [w, h] = SIZES[this.kind];
    const filename = `trick-map-${this.kind}.png`;
    let blob;
    try {
      blob = await toPng(svg, w, h);
    } catch {
      this.toast("Couldn't make the image in this browser.");
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
    this.toast(this.kind === "story" ? "Story image saved. Post it from your photos." : "Card saved.");
  }
}
