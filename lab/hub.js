// Lab hub: the five test versions, a heart for every feature worth keeping,
// and a way to send the picks back.

import { VERSIONS, featureList, bindPicks, picksText, sharePicks, hasRealMap, seededAt, isPicked, PHONE } from "./lab.js";
import { esc } from "../js/core/draw.js";

const C = { kf: "#ff5a3c", bs: "#3f78ff", fb: "#2fb35f", hf: "#f2b01e", fs: "#17a8a0", bb: "#8c5cf0", sun: "#ffcc4d", earth: "#6f9a7a", moon: "#7d84c9" };

const ART = {
  native: `<svg viewBox="0 0 320 150" aria-hidden="true">
    <rect x="112" y="14" width="96" height="150" rx="18" fill="var(--sheet)" stroke="var(--line)" stroke-width="2"/>
    <rect x="112" y="14" width="96" height="40" rx="18" fill="var(--sunband)"/><rect x="112" y="40" width="96" height="14" fill="var(--sunband)"/>
    <path d="M128 36 H150 L162 48 H188" fill="none" stroke="${C.kf}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="128" cy="36" r="5" fill="var(--fg)"/><circle cx="162" cy="48" r="5" fill="var(--bg)" stroke="var(--fg)" stroke-width="2"/><circle cx="188" cy="48" r="5" fill="var(--fg)"/>
    <rect x="112" y="76" width="96" height="74" rx="14" fill="var(--chip)" stroke="var(--line)"/>
    <rect x="148" y="82" width="24" height="4" rx="2" fill="var(--faint)"/>
    <rect x="122" y="96" width="50" height="6" rx="3" fill="var(--fg)" opacity=".8"/><rect x="122" y="108" width="74" height="5" rx="2.5" fill="var(--faint)"/>
    <rect x="122" y="118" width="62" height="5" rx="2.5" fill="var(--faint)"/>
    <g fill="var(--muted)"><circle cx="130" cy="140" r="4"/><circle cx="150" cy="140" r="4"/><circle cx="170" cy="140" r="4"/><circle cx="190" cy="140" r="4"/></g>
    <circle cx="130" cy="140" r="4" fill="var(--fg)"/>
  </svg>`,
  pro: `<svg viewBox="0 0 320 150" aria-hidden="true">
    <rect x="24" y="16" width="272" height="126" rx="10" fill="var(--sheet)" stroke="var(--line)" stroke-width="1.5"/>
    <line x1="24" y1="36" x2="296" y2="36" stroke="var(--line)"/><line x1="78" y1="36" x2="78" y2="142" stroke="var(--line)"/><line x1="232" y1="36" x2="232" y2="142" stroke="var(--line)"/>
    <rect x="110" y="22" width="90" height="9" rx="4.5" fill="var(--chip)" stroke="var(--line)"/><text x="118" y="29.5" font-size="7" fill="var(--muted)" font-family="monospace">⌘K search</text>
    <g fill="var(--faint)"><rect x="32" y="46" width="34" height="5" rx="2.5"/><rect x="32" y="58" width="26" height="5" rx="2.5"/><rect x="32" y="70" width="38" height="5" rx="2.5"/><rect x="32" y="82" width="22" height="5" rx="2.5"/></g>
    <rect x="32" y="46" width="34" height="5" rx="2.5" fill="var(--fg)"/>
    <path d="M100 110 H124 L140 80 H160" fill="none" stroke="${C.bs}" stroke-width="2.2"/><path d="M100 110 H130 L146 120 H200" fill="none" stroke="${C.hf}" stroke-width="2.2"/>
    <rect x="148" y="66" width="62" height="32" rx="3" fill="color-mix(in srgb, var(--fg) 7%, transparent)" stroke="var(--fg)" stroke-dasharray="3 2"/>
    <circle cx="100" cy="110" r="5" fill="var(--fg)"/><circle cx="160" cy="80" r="5" fill="var(--fg)"/><circle cx="196" cy="86" r="5" fill="var(--bg)" stroke="var(--fg)" stroke-width="1.6"/><circle cx="200" cy="120" r="5" fill="var(--bg)" stroke="var(--faint)" stroke-dasharray="2 2"/>
    <g fill="var(--faint)"><rect x="240" y="46" width="44" height="6" rx="3" fill="var(--fg)" opacity=".8"/><rect x="240" y="60" width="30" height="5" rx="2.5"/><rect x="240" y="72" width="40" height="12" rx="3"/><rect x="240" y="90" width="40" height="12" rx="3"/></g>
  </svg>`,
  progress: `<svg viewBox="0 0 320 150" aria-hidden="true">
    <g transform="translate(110 76) rotate(-90)" fill="none" stroke-linecap="round" stroke-width="10">
      <circle r="52" stroke="var(--chip)"/><circle r="52" stroke="${C.sun}" stroke-dasharray="${2 * Math.PI * 52 * 0.72} 999"/>
      <circle r="38" stroke="var(--chip)"/><circle r="38" stroke="${C.earth}" stroke-dasharray="${2 * Math.PI * 38 * 0.45} 999"/>
      <circle r="24" stroke="var(--chip)"/><circle r="24" stroke="${C.moon}" stroke-dasharray="${2 * Math.PI * 24 * 0.3} 999"/>
    </g>
    <g fill="var(--faint)"><rect x="190" y="34" width="90" height="7" rx="3.5"/><rect x="190" y="50" width="64" height="7" rx="3.5"/></g>
    <g><rect x="190" y="80" width="10" height="34" rx="2" fill="var(--faint)"/><rect x="206" y="94" width="10" height="20" rx="2" fill="var(--faint)"/><rect x="222" y="72" width="10" height="42" rx="2" fill="var(--fg)"/><rect x="238" y="100" width="10" height="14" rx="2" fill="var(--faint)"/><rect x="254" y="86" width="10" height="28" rx="2" fill="var(--faint)"/></g>
  </svg>`,
  spatial: `<svg viewBox="0 0 320 150" aria-hidden="true">
    <rect width="320" height="50" fill="var(--sunband)"/><rect y="50" width="320" height="50" fill="var(--earthband)"/><rect y="100" width="320" height="50" fill="var(--moonband)"/>
    <path d="M40 75 H80 L104 30 H150" fill="none" stroke="${C.kf}" stroke-width="2.5" opacity=".35"/>
    <path d="M40 75 H90 L114 120 H170" fill="none" stroke="${C.hf}" stroke-width="2.5" opacity=".35"/>
    <path d="M150 30 H190 L210 46 H250" fill="none" stroke="${C.bs}" stroke-width="2.5" opacity=".35"/>
    <path d="M40 75 H80 L104 30 H150 H190 L210 46 H250" fill="none" stroke="var(--fg)" stroke-width="3.5" stroke-dasharray="1 9" stroke-linecap="round"/>
    <circle cx="40" cy="75" r="6" fill="var(--fg)"/><circle cx="150" cy="30" r="6" fill="var(--fg)"/><circle cx="250" cy="46" r="7" fill="var(--bg)" stroke="var(--fg)" stroke-width="2"/><circle cx="250" cy="46" r="15" fill="none" stroke="var(--fg)" stroke-dasharray="3 3"/>
    <circle cx="170" cy="120" r="6" fill="var(--bg)" stroke="var(--faint)" stroke-dasharray="2 2"/>
    <rect x="256" y="104" width="54" height="38" rx="6" fill="var(--sheet)" stroke="var(--line)"/><rect x="276" y="110" width="20" height="14" rx="2" fill="none" stroke="var(--fg)"/>
  </svg>`,
  studio: `<svg viewBox="0 0 320 150" aria-hidden="true">
    <g transform="rotate(-6 120 80)"><rect x="84" y="12" width="72" height="128" rx="10" fill="var(--sheet)" stroke="var(--line)" stroke-width="1.5"/>
      <rect x="92" y="22" width="40" height="6" rx="3" fill="var(--fg)"/><rect x="92" y="32" width="26" height="4" rx="2" fill="var(--faint)"/>
      <rect x="92" y="44" width="56" height="20" fill="var(--sunband)"/><rect x="92" y="64" width="56" height="20" fill="var(--earthband)"/><rect x="92" y="84" width="56" height="20" fill="var(--moonband)"/>
      <path d="M98 74 H110 L118 54 H140" fill="none" stroke="${C.kf}" stroke-width="2"/><path d="M98 74 H112 L120 94 H140" fill="none" stroke="${C.hf}" stroke-width="2"/>
      <g fill="var(--faint)"><rect x="92" y="112" width="16" height="14" rx="3"/><rect x="112" y="112" width="16" height="14" rx="3"/><rect x="132" y="112" width="16" height="14" rx="3"/></g></g>
    <g transform="rotate(5 220 80)"><rect x="172" y="34" width="104" height="80" rx="12" fill="var(--chip)" stroke="var(--line)" stroke-width="1.5"/>
      <circle cx="196" cy="60" r="12" fill="${C.sun}"/><rect x="214" y="52" width="46" height="6" rx="3" fill="var(--fg)"/><rect x="214" y="63" width="30" height="4" rx="2" fill="var(--faint)"/>
      <g><circle cx="190" cy="94" r="5" fill="${C.kf}"/><circle cx="206" cy="94" r="5" fill="${C.bs}"/><circle cx="222" cy="94" r="5" fill="${C.hf}"/><circle cx="238" cy="94" r="5" fill="${C.bb}"/></g></g>
  </svg>`,
};

const root = document.querySelector("#hub");
const toastEl = document.querySelector(".hub-toast");
let toastT = 0;
const toast = (text) => {
  toastEl.textContent = text;
  toastEl.classList.add("on");
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove("on"), 2600);
};

const fmtDay = (t) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });

root.innerHTML = `
  <div class="hub-top">
    <div class="lab-bar"><a class="lab-back" href="../"><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>My map</span></a></div>
  </div>
  <header class="hub-head">
    <div class="mono">Lab</div>
    <h1>Five test versions</h1>
    <p>Each one opens a copy of your map, so try anything. Nothing here changes your real map. Tap the heart on every feature you want to keep, then send me your picks.</p>
  </header>
  ${hasRealMap() ? "" : `<div class="hub-empty">You don't have a map on this device yet, so the test versions start from the default tricks.</div>`}
  <div class="hub-grid">${VERSIONS.map((v) => {
    const at = seededAt(v.id);
    return `<article class="vcard">
      <a class="vcard-art" href="${v.id}.html" aria-label="Open ${esc(v.name)}"><span class="vcard-num">TEST ${v.n}${at ? ` · COPY FROM ${esc(fmtDay(at).toUpperCase())}` : ""}</span>${ART[v.id]}</a>
      <div class="vcard-body">
        <h2>${esc(v.name)} <small>${esc(v.tag)}</small></h2>
        <p>${esc(v.blurb)}</p>
        ${featureList(v.id)}
        <a class="btn primary vcard-open" href="${v.id}.html">Open ${esc(v.name)}</a>
      </div>
    </article>`;
  }).join("")}</div>
  <section class="hub-picks" aria-live="polite">
    <h3>Your picks</h3>
    <div data-picks></div>
    <div class="row"><button class="btn primary" type="button" data-send>${PHONE ? "Share picks" : "Copy picks"}</button></div>
  </section>`;

bindPicks(root);
const picksEl = root.querySelector("[data-picks]");
const paintPicks = () => {
  const text = picksText();
  picksEl.innerHTML = text ? `<pre>${esc(text)}</pre>` : `<p class="hint">Nothing picked yet. Hearts you tap here or inside a test version show up here.</p>`;
};
paintPicks();
window.addEventListener("lab-picks", paintPicks);
window.addEventListener("pageshow", () => {
  // Coming back from a version: refresh hearts picked inside it.
  for (const b of root.querySelectorAll("[data-pick]")) {
    const [vid, fid] = b.dataset.pick.split(":");
    b.setAttribute("aria-pressed", String(isPicked(vid, fid)));
  }
  paintPicks();
});
root.querySelector("[data-send]").addEventListener("click", () => sharePicks(toast));
