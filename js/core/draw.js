// Small drawing helpers shared by every view: escaping, grays, orbs,
// subway-style connection lines, and label wrapping. They return SVG strings.
// Lines and orbs are black and white: a line's gray comes from its ingredient.

import { LEVELS } from "./catalog.js";

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const BAND_FILL = Object.freeze({ sun: "var(--sunband)", earth: "var(--earthband)", moon: "var(--moonband)" });

/** Gray of a hex color, by perceived brightness. */
export function gray(hex) {
  if (!hex || hex[0] !== "#") return hex;
  const n = parseInt(hex.slice(1), 16);
  const y = Math.round(0.3 * ((n >> 16) & 255) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255));
  const h = y.toString(16).padStart(2, "0");
  return `#${h}${h}${h}`;
}


/** Subway-style line: straight, one 45° bend, straight. Falls back to a curve when going left. */
export function edgePath(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx > 40) {
    const d = Math.min(Math.abs(dy), dx * 0.55);
    const mx = a.x + (dx - d) / 2;
    return `M${r1(a.x)},${r1(a.y)}H${r1(mx)}L${r1(mx + d)},${r1(a.y + Math.sign(dy) * d)}V${r1(b.y)}H${r1(b.x)}`;
  }
  const c = Math.max(40, Math.abs(dy) * 0.4);
  return `M${r1(a.x)},${r1(a.y)}C${r1(a.x + c)},${r1(a.y)} ${r1(b.x - c)},${r1(b.y)} ${r1(b.x)},${r1(b.y)}`;
}
const r1 = (v) => Math.round(v * 10) / 10;

/** Orb for a level: dashed ring (not yet), ring (want it), solid (landed), solid with a ring (locked in). */
export function orbSvg(level) {
  if (level === 0) return `<circle r="7" fill="var(--bg)" stroke="var(--faint)" stroke-width="1.5" stroke-dasharray="2 2"/>`;
  if (level === 1) return `<circle r="7" fill="var(--bg)" stroke="var(--fg)" stroke-width="1.6"/>`;
  if (level === 2) return `<circle r="7" fill="var(--fg)"/>`;
  return `<circle r="11" fill="none" stroke="var(--fg)" stroke-width="1.5"/><circle r="8" fill="var(--fg)"/>`;
}

export const SELECT_RING = `<circle r="24" fill="none" stroke="var(--fg)" stroke-width="1.5" stroke-dasharray="3 3"/>`;

export function bandIcon(side, colors) {
  if (side === "sun") return `<circle r="5" fill="${colors.sun}"/>`;
  if (side === "moon") return `<circle r="5" fill="${colors.moon}" stroke="var(--muted)" stroke-width=".8"/>`;
  return `<path d="M0,-5 A5,5 0 0,0 0,5Z" fill="${colors.sun}"/><path d="M0,-5 A5,5 0 0,1 0,5Z" fill="${colors.moon}"/><circle r="5" fill="none" stroke="var(--muted)" stroke-width=".8"/>`;
}

export const bandIconSvg = (side, colors, size = 12) =>
  `<svg width="${size}" height="${size}" viewBox="-6 -6 12 12" aria-hidden="true">${bandIcon(side, colors)}</svg>`;

/** Level dot for lists and the stance grid. */
export function dotSvg(level, size = 18) {
  const c = size / 2;
  const r = size * 0.3;
  const open = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">`;
  if (level === 0) return `${open}<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--faint)" stroke-width="1.5" stroke-dasharray="2 2"/></svg>`;
  if (level === 1) return `${open}<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--fg)" stroke-width="1.6"/></svg>`;
  if (level === 2) return `${open}<circle cx="${c}" cy="${c}" r="${r}" fill="var(--fg)"/></svg>`;
  return `${open}<circle cx="${c}" cy="${c}" r="${r + 2.6}" fill="none" stroke="var(--fg)"/><circle cx="${c}" cy="${c}" r="${r}" fill="var(--fg)"/></svg>`;
}

export function legendHtml() {
  return LEVELS.map((label, i) =>
    `<span><svg width="34" height="34" viewBox="-17 -17 34 34" aria-hidden="true">${orbSvg(i)}</svg>${label}</span>`).join("");
}

/** Split a label into at most two lines that fit `maxW` pixels at font size `fs`. */
export function wrapWords(text, maxW, fs) {
  const cw = fs * 0.56;
  const out = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (next.length * cw > maxW && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  if (out.length > 2) {
    out[1] = out.slice(1).join(" ");
    out.length = 2;
  }
  return out.map((l) => (l.length * cw > maxW ? l.slice(0, Math.max(3, Math.floor(maxW / cw) - 1)) + "…" : l));
}

export const ingredientCount = (n) => (n ? `${n} ingredient${n > 1 ? "s" : ""}` : "Base");
