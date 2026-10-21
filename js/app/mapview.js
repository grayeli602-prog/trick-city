// Interactive trick map. Draws the Sun/Earth/Moon bands, the subway lines and
// the orbs, and turns pointer input into taps, holds, hovers, drags, pans and
// pinch zoom. Used by the main app and every lab version.
//
// Projections:
//   "pc"      map coordinates 1:1 inside a scrolling box (desktop)
//   "fit"     stretched to fill the box, two-finger pan/zoom on top (phone)
//   "contain" uniform scale, free camera (lab: Spatial)

import { buildModel, bandAt, autoPositions, LAYOUT } from "../core/model.js";
import { SIDES, SIDE_ORDER } from "../core/catalog.js";
import { esc, edgePath, orbSvg, bandIcon, tone, wrapWords, SELECT_RING, BAND_FILL } from "../core/draw.js";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export class MapView {
  constructor(root, store, options = {}) {
    this.root = root;
    this.store = store;
    this.o = {
      projection: "fit",
      labels: null,           // "right" | "below"
      orbScale: null,
      labelSize: null,
      minZoom: 1,
      maxZoom: 4,
      emptyDrag: "none",      // "none" | "pan" | "marquee", or (pointerType, event) => one of those
      orbDrag: true,
      inertia: false,
      wheelZoom: false,       // wheel zooms (horizontal wheel pans)
      wheelPan: false,        // wheel pans, pinch or ctrl+wheel zooms (trackpad style)
      longPressMs: 450,
      doubleTapEmpty: "reset", // "reset" | "zoom" | null
      stance: "regular",
      focusY: 0.42,
      include: () => [],
      selection: () => null,  // Set of keys that are selected (ring + drag together)
      decorate: null,         // (node) => { dim, ring, cls, extra, hideLabel, labelExtra(svg or ({ bottom, lines }) => svg) }
      edgeStyle: null,        // (edge) => { opacity, width, color, glow }
      overlay: null,          // (M, view) => svg drawn between lines and orbs (screen coordinates)
      onTap: null, onTapEmpty: null, onLongPress: null, onLongMove: null, onLongEnd: null,
      onHover: null, onHoverEnd: null, onDrop: null, onZoneChange: null, onMarquee: null,
      onCamera: null, onRender: null, onGestureStart: null,
      ...options,
    };
    const pc = this.o.projection === "pc";
    if (!this.o.labels) this.o.labels = pc ? "right" : "below";
    if (this.o.orbScale == null) this.o.orbScale = pc ? 1 : 0.9;
    if (this.o.labelSize == null) this.o.labelSize = this.o.labels === "right" ? 12.5 : 10.5;

    this.cam = { z: 1, tx: 0, ty: 0 };
    this.base = { sx: 1, sy: 1, ox: 0, oy: 0, vw: 0, vh: 0, x0: 0, x1: 0 };
    this.pointers = new Map();
    this.g = null;
    this.pinch = null;
    this.anim = 0;
    this.M = null;

    root.classList.add("mv", `mv-${this.o.projection}`);
    this.canvas = document.createElement("div");
    this.canvas.className = "mv-canvas";
    root.prepend(this.canvas);
    this._bind();

    if (!pc && typeof ResizeObserver !== "undefined") {
      let last = "";
      this._ro = new ResizeObserver(() => {
        const size = `${root.clientWidth}x${root.clientHeight}`;
        if (size !== last && root.clientWidth) {
          last = size;
          this.render();
        }
      });
      this._ro.observe(root);
    }
  }

  /* ---------- coordinates ---------- */

  get camera() { return this.o.projection !== "pc"; }

  toScreen(x, y) {
    if (!this.camera) return { x, y };
    const b = this.base;
    const c = this.cam;
    return { x: (x * b.sx + b.ox) * c.z + c.tx, y: (y * b.sy + b.oy) * c.z + c.ty };
  }

  toWorld(x, y) {
    if (!this.camera) return { x, y };
    const b = this.base;
    const c = this.cam;
    return { x: ((x - c.tx) / c.z - b.ox) / b.sx, y: ((y - c.ty) / c.z - b.oy) / b.sy };
  }

  _project(M) {
    const b = this.base;
    b.vw = this.root.clientWidth || window.innerWidth;
    b.vh = this.root.clientHeight || window.innerHeight;
    const xs = M.nodes.map((n) => n.x);
    b.x0 = Math.min(LAYOUT.X0, ...xs);
    b.x1 = Math.max(LAYOUT.X0 + M.maxFl * LAYOUT.COLW, ...xs);
    if (!this.camera) {
      Object.assign(b, { sx: 1, sy: 1, ox: 0, oy: 0 });
    } else if (this.o.projection === "fit") {
      const mx = Math.min(48, b.vw * 0.11);
      b.sx = (b.vw - 2 * mx) / Math.max(1, b.x1 - b.x0);
      b.ox = mx - b.x0 * b.sx;
      b.sy = b.vh / M.H;
      b.oy = 0;
    } else {
      const m = 28;
      const s = Math.min((b.vw - 2 * m - 90) / Math.max(1, b.x1 - b.x0), (b.vh - 2 * m) / M.H);
      b.sx = b.sy = s;
      b.ox = (b.vw - (b.x1 - b.x0) * s) / 2 - b.x0 * s;
      b.oy = (b.vh - M.H * s) / 2;
    }
  }

  _clampCamera() {
    const c = this.cam;
    const b = this.base;
    c.z = clamp(c.z, this.o.minZoom, this.o.maxZoom);
    if (this.o.projection === "fit") {
      c.tx = clamp(c.tx, b.vw - b.vw * c.z, 0);
      c.ty = clamp(c.ty, b.vh - b.vh * c.z, 0);
    } else if (this.o.projection === "contain" && this.M) {
      const left = (b.x0 * b.sx + b.ox) * c.z;
      const right = (b.x1 * b.sx + b.ox) * c.z;
      const top = b.oy * c.z;
      const bottom = (this.M.H * b.sy + b.oy) * c.z;
      c.tx = clamp(c.tx, b.vw * 0.25 - right, b.vw * 0.75 - left);
      c.ty = clamp(c.ty, b.vh * 0.25 - bottom, b.vh * 0.75 - top);
    }
  }

  /* ---------- drawing ---------- */

  render() {
    const store = this.store;
    const { palette } = store.state.prefs;
    const colors = store.state.sideColors;
    const M = (this.M = buildModel(store, { stance: this.o.stance, include: this.o.include() || [] }));
    this._project(M);
    this._clampCamera();
    const pc = !this.camera;
    const W = pc ? M.W : this.base.vw;
    const H = pc ? M.H : this.base.vh;
    const selected = this.o.selection() || null;

    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trick map">`;
    s += `<g class="mv-bands">${SIDE_ORDER.map((side) => `<rect data-band="${side}" fill="${BAND_FILL[side]}"/>`).join("")}</g>`;
    s += `<g class="mv-bandlabels">${SIDE_ORDER.map((side) =>
      `<g data-bandlabel="${side}">${bandIcon(side, colors)}<text class="mv-bandtext" x="${pc ? 14 : 11}" y="${pc ? 4 : 3.5}" font-size="${pc ? 10.5 : 9.5}">${SIDES[side].toUpperCase()}</text></g>`).join("")}</g>`;
    if (pc) {
      for (let fl = 1; fl <= M.maxFl; fl++) {
        s += `<text class="mv-coltext" x="${LAYOUT.X0 + fl * LAYOUT.COLW - 4}" y="${M.bands.sun.y0 + 22}" font-size="10">+${fl}</text>`;
      }
    }
    s += `<g class="mv-edges">`;
    let glow = "";
    M.edges.forEach((e, i) => {
      const st = this.o.edgeStyle?.(e) || {};
      const opacity = st.opacity ?? (e.b.lv >= 2 && e.a.lv >= 2 ? 0.95 : 0.45);
      const width = st.width || (pc ? 2.4 : 2);
      s += `<path data-e="${i}" fill="none" stroke="${st.color || tone(e.c, palette)}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round" opacity="${opacity}"/>`;
      if (st.glow) glow += `<path data-eg="${i}" class="mv-flow" fill="none" stroke="var(--fg)" stroke-width="${width + 1.6}" stroke-linecap="round"/>`;
    });
    s += `</g><g class="mv-glow">${glow}</g>`;
    if (this.o.overlay) s += `<g class="mv-overlay">${this.o.overlay(M, this) || ""}</g>`;
    s += `<g class="mv-orbs">${M.nodes.map((n) => this._orb(n, M, palette, selected)).join("")}</g></svg>`;

    this.canvas.innerHTML = s;
    this.svg = this.canvas.firstElementChild;
    this.els = {
      bands: [...this.svg.querySelectorAll("[data-band]")],
      bandLabels: [...this.svg.querySelectorAll("[data-bandlabel]")],
      edges: [...this.svg.querySelectorAll("[data-e]")],
      glows: new Map([...this.svg.querySelectorAll("[data-eg]")].map((p) => [Number(p.dataset.eg), p])),
      orbs: new Map([...this.svg.querySelectorAll(".orb")].map((g) => [g.dataset.k, g])),
    };
    this._renderedZoom = this.cam.z;
    this._layout();
    this.o.onRender?.(M, this);
  }

  _orb(n, M, palette, selected) {
    const d = this.o.decorate?.(n) || {};
    const ring = d.ring ?? (selected ? selected.has(n.k) : false);
    const strong = ring || d.strong;
    const fill = n.lv ? "var(--fg)" : "var(--muted)";
    const halo = BAND_FILL[bandAt(M, n.y)];
    const fs = this.o.labelSize;
    let label = "";
    let bottom = 14;
    let lineCount = 0;
    if (!d.hideLabel) {
      if (this.o.labels === "right") {
        label = `<text x="18" y="4" font-size="${fs}" font-weight="${strong ? 600 : 500}" fill="${fill}" stroke="${halo}" stroke-width="5" stroke-linejoin="round" paint-order="stroke">${esc(n.name)}</text>`;
        lineCount = 1;
      } else {
        const width = Math.max(56, LAYOUT.COLW * this.base.sx * this.cam.z - 6);
        const lines = wrapWords(n.name, width, fs);
        label = `<text y="${15 + fs * 0.8}" text-anchor="middle" font-size="${fs}" font-weight="${strong ? 600 : 500}" fill="${fill}" stroke="${halo}" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${lines.map((l, i) => `<tspan x="0" dy="${i ? fs * 1.1 : 0}">${esc(l)}</tspan>`).join("")}</text>`;
        lineCount = lines.length;
        bottom = 15 + fs * 0.8 + (lines.length - 1) * fs * 1.1 + fs * 0.35;
      }
    }
    const extra = typeof d.labelExtra === "function" ? d.labelExtra({ bottom, lines: lineCount, fs, halo }) : d.labelExtra || "";
    return `<g class="orb${d.cls ? ` ${d.cls}` : ""}" data-k="${esc(n.k)}"${d.dim != null ? ` opacity="${d.dim}"` : ""}>` +
      `<circle class="hit" r="24" fill="transparent"/>${ring ? SELECT_RING : ""}` +
      `<g class="dot" transform="scale(${this.o.orbScale})"><g class="dot-in">${orbSvg(n.lv, tone(n.col, palette), palette)}</g></g>` +
      `${d.extra || ""}${label}${extra}</g>`;
  }

  /** Position bands, lines and orbs for the current camera (no rebuild). */
  _layout() {
    const M = this.M;
    if (!M || !this.els) return;
    const pc = !this.camera;
    for (const r of this.els.bands) {
      const band = M.bands[r.dataset.band];
      const y0 = this.toScreen(0, band.y0).y;
      const y1 = this.toScreen(0, band.y1).y;
      r.setAttribute("x", 0);
      r.setAttribute("y", y0);
      r.setAttribute("width", pc ? M.W : this.base.vw);
      r.setAttribute("height", Math.max(0, y1 - y0));
    }
    for (const g of this.els.bandLabels) {
      const band = M.bands[g.dataset.bandlabel];
      if (pc) g.setAttribute("transform", `translate(14,${band.y0 + 18})`);
      else {
        const y0 = this.toScreen(0, band.y0).y;
        const y1 = this.toScreen(0, band.y1).y;
        g.setAttribute("transform", `translate(12,${clamp(14, y0 + 14, y1 - 12)})`);
      }
    }
    M.edges.forEach((e, i) => this._edge(i, e));
    for (const n of M.nodes) {
      const p = this.toScreen(n.x, n.y);
      this.els.orbs.get(n.k)?.setAttribute("transform", `translate(${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10})`);
    }
  }

  _edge(i, e) {
    const d = edgePath(this.toScreen(e.a.x, e.a.y), this.toScreen(e.b.x, e.b.y));
    this.els.edges[i]?.setAttribute("d", d);
    this.els.glows.get(i)?.setAttribute("d", d);
  }

  _cameraChanged() {
    this._clampCamera();
    this._layout();
    this.o.onCamera?.(this.cam, this);
    // Labels wrap to the column width, so rebuild when the zoom changes a lot.
    if (this.camera && Math.abs(Math.log(this.cam.z / (this._renderedZoom || 1))) > 0.35) {
      cancelAnimationFrame(this._rerender);
      this._rerender = requestAnimationFrame(() => {
        if (!this.g && !this.pinch) this.render();
      });
    }
  }

  /* ---------- camera ---------- */

  _stopAnim() {
    cancelAnimationFrame(this.anim);
    this.anim = 0;
  }

  animateTo(target, ms = 460) {
    this._stopAnim();
    const from = { ...this.cam };
    const start = performance.now();
    const dur = reducedMotion() ? 1 : ms;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const e = ease(t);
      this.cam.z = from.z + (target.z - from.z) * e;
      this.cam.tx = from.tx + (target.tx - from.tx) * e;
      this.cam.ty = from.ty + (target.ty - from.ty) * e;
      this._cameraChanged();
      this.anim = t < 1 ? requestAnimationFrame(step) : 0;
      if (!this.anim) this.render();
    };
    this.anim = requestAnimationFrame(step);
  }

  /** Center a trick on screen, optionally at a zoom level. */
  focusOn(key, zoom) {
    const n = this.M?.map.get(key);
    if (!n || !this.camera) return;
    const z = clamp(zoom ?? this.cam.z, this.o.minZoom, this.o.maxZoom);
    const bx = n.x * this.base.sx + this.base.ox;
    const by = n.y * this.base.sy + this.base.oy;
    this.animateTo({ z, tx: this.base.vw / 2 - bx * z, ty: this.base.vh * this.o.focusY - by * z });
  }

  /** Center a map point on screen. With `ms`, animate there. */
  centerOn(x, y, zoom = this.cam.z, ms = 0) {
    if (!this.camera) return;
    const z = clamp(zoom, this.o.minZoom, this.o.maxZoom);
    const bx = x * this.base.sx + this.base.ox;
    const by = y * this.base.sy + this.base.oy;
    this.setCamera({ z, tx: this.base.vw / 2 - bx * z, ty: this.base.vh / 2 - by * z }, ms);
  }

  setCamera(target, ms = 0) {
    if (!this.camera) return;
    if (ms) {
      this.animateTo(target, ms);
      return;
    }
    this._stopAnim();
    Object.assign(this.cam, target);
    this._cameraChanged();
  }

  resetCamera(animated = true) {
    const target = { z: 1, tx: 0, ty: 0 };
    if (animated) this.animateTo(target);
    else {
      Object.assign(this.cam, target);
      this._cameraChanged();
    }
  }

  zoomAt(factor, cx, cy) {
    const z = clamp(this.cam.z * factor, this.o.minZoom, this.o.maxZoom);
    const k = z / this.cam.z;
    this.cam.tx = cx - (cx - this.cam.tx) * k;
    this.cam.ty = cy - (cy - this.cam.ty) * k;
    this.cam.z = z;
    this._cameraChanged();
  }

  /** The visible orb element for a key (for anchoring popovers). */
  anchorOf(key) {
    return this.els?.orbs.get(key)?.querySelector(".dot") || null;
  }

  /* ---------- input ---------- */

  _bind() {
    const r = this.root;
    r.addEventListener("pointerdown", (e) => this._down(e));
    r.addEventListener("pointermove", (e) => this._move(e));
    r.addEventListener("pointerup", (e) => this._up(e));
    r.addEventListener("pointercancel", (e) => this._up(e));
    r.addEventListener("lostpointercapture", (e) => { if (this.pointers.has(e.pointerId)) this._up(e); });
    r.addEventListener("contextmenu", (e) => { if (e.target.closest(".orb") || this.camera) e.preventDefault(); });
    r.addEventListener("wheel", (e) => this._wheel(e), { passive: false });
    r.addEventListener("pointerover", (e) => {
      if (e.pointerType !== "mouse" || this.g || !this.o.onHover) return;
      const orb = e.target.closest(".orb");
      if (!orb) return;
      clearTimeout(this._hoverT);
      this._hoverT = setTimeout(() => this.o.onHover(orb.dataset.k, orb.querySelector(".dot")), 180);
    });
    r.addEventListener("pointerout", (e) => {
      if (e.pointerType !== "mouse") return;
      const orb = e.target.closest(".orb");
      if (!orb || orb.contains(e.relatedTarget)) return;
      clearTimeout(this._hoverT);
      this.o.onHoverEnd?.(orb.dataset.k);
    });
    if (this.camera) {
      for (const t of ["gesturestart", "gesturechange"]) r.addEventListener(t, (e) => e.preventDefault(), { passive: false });
    }
  }

  _down(e) {
    if (e.target.closest("[data-mv-ignore]")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.camera || e.pointerType === "mouse") {
      try { this.root.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    this._stopAnim();
    if (this.pointers.size >= 2) {
      if (this.camera) this._pinchStart();
      return;
    }
    const orb = e.target.closest(".orb");
    const key = orb ? orb.dataset.k : null;
    const g = (this.g = {
      id: e.pointerId, key, sx: e.clientX, sy: e.clientY, moved: false, long: false,
      type: e.pointerType, additive: e.shiftKey || e.metaKey || e.ctrlKey, samples: [],
    });
    clearTimeout(this._hoverT);
    if (orb) {
      orb.classList.add("pressing");
      g.orb = orb;
    }
    if (key !== null && this.o.onLongPress && e.pointerType !== "mouse") {
      g.lp = setTimeout(() => {
        if (this.g !== g || g.moved) return;
        g.long = true;
        this.o.onLongPress(key, orb.querySelector(".dot"), g);
      }, this.o.longPressMs);
    }
    if (e.pointerType === "mouse") e.preventDefault();
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pinch) {
      this._pinchMove();
      return;
    }
    const g = this.g;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (g.long) {
      this.o.onLongMove?.(g.key, dx, dy, e, g);
      return;
    }
    if (!g.moved) {
      if (Math.hypot(dx, dy) < 7) return;
      g.moved = true;
      clearTimeout(g.lp);
      if (g.key !== null && this.o.orbDrag) g.mode = "drag";
      else {
        const empty = typeof this.o.emptyDrag === "function" ? this.o.emptyDrag(g.type, e, g) : this.o.emptyDrag;
        if (empty === "pan" && this.camera) g.mode = "pan";
        else if (g.key === null && empty === "marquee") g.mode = "marquee";
        else g.mode = null;
      }
      this._unpress(g);
      if (g.mode === "drag") this._dragStart(g);
      else if (g.mode === "pan") g.t0 = { tx: this.cam.tx, ty: this.cam.ty };
      else if (g.mode === "marquee") this._marqueeStart(g);
      this.o.onGestureStart?.(g);
    }
    if (g.mode === "drag") this._dragMove(g, dx, dy);
    else if (g.mode === "pan") {
      this.cam.tx = g.t0.tx + dx;
      this.cam.ty = g.t0.ty + dy;
      g.samples.push({ t: performance.now(), dx, dy });
      if (g.samples.length > 6) g.samples.shift();
      this._cameraChanged();
    } else if (g.mode === "marquee") this._marqueeMove(g, e);
  }

  _up(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) {
        this.pinch = null;
        this.render();
      }
      return;
    }
    const g = this.g;
    if (!g || g.id !== e.pointerId) return;
    this.g = null;
    clearTimeout(g.lp);
    this._unpress(g);
    const cancelled = e.type === "pointercancel" || e.type === "lostpointercapture";
    if (g.long) {
      this.o.onLongEnd?.(g.key, cancelled ? null : e, g);
      return;
    }
    if (cancelled) {
      if (g.mode === "drag") this._dragCancel(g);
      if (g.mode === "marquee") g.box?.remove();
      return;
    }
    if (!g.moved) {
      if (g.key !== null) this.o.onTap?.(g.key, e, g);
      else this._tapEmpty(e);
      return;
    }
    if (g.mode === "drag") this._dragEnd(g);
    else if (g.mode === "pan") this._panEnd(g);
    else if (g.mode === "marquee") this._marqueeEnd(g);
  }

  _unpress(g) {
    g?.orb?.classList.remove("pressing");
  }

  _tapEmpty(e) {
    const now = performance.now();
    if (this.camera && now - (this._lastTap || 0) < 320) {
      this._lastTap = 0;
      if (this.o.doubleTapEmpty === "reset") this.resetCamera(true);
      else if (this.o.doubleTapEmpty === "zoom") {
        const r = this.root.getBoundingClientRect();
        const cx = e.clientX - r.left;
        const cy = e.clientY - r.top;
        const z = this.cam.z >= this.o.maxZoom * 0.7 ? 1 : Math.min(this.o.maxZoom, this.cam.z * 2);
        const k = z / this.cam.z;
        this.animateTo({ z, tx: cx - (cx - this.cam.tx) * k, ty: cy - (cy - this.cam.ty) * k }, 320);
      }
      return;
    }
    this._lastTap = now;
    this.o.onTapEmpty?.(e);
  }

  _wheel(e) {
    if (!this.camera || !(this.o.wheelZoom || this.o.wheelPan)) return;
    e.preventDefault();
    this._stopAnim();
    const r = this.root.getBoundingClientRect();
    const k = e.deltaMode === 1 ? 16 : 1;
    if (this.o.wheelPan && !e.ctrlKey && !e.metaKey) {
      this.cam.tx -= (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k;
      this.cam.ty -= (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k;
      this._cameraChanged();
      return;
    }
    if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 0.6) {
      this.cam.tx -= e.deltaX;
      this.cam.ty -= e.deltaY;
      this._cameraChanged();
      return;
    }
    this.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0025)), e.clientX - r.left, e.clientY - r.top);
  }

  /* ----- pinch ----- */

  _pinchStart() {
    const g = this.g;
    if (g) {
      clearTimeout(g.lp);
      this._unpress(g);
      if (g.mode === "drag") this._dragCancel(g);
      if (g.long) this.o.onLongEnd?.(g.key, null, g);
      this.g = null;
    }
    const [a, b] = [...this.pointers.values()];
    const r = this.root.getBoundingClientRect();
    this.pinch = {
      d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top,
      z: this.cam.z, tx: this.cam.tx, ty: this.cam.ty,
    };
    this.o.onGestureStart?.({ pinch: true });
  }

  _pinchMove() {
    const [a, b] = [...this.pointers.values()];
    if (!b) return;
    const p = this.pinch;
    const r = this.root.getBoundingClientRect();
    const mx = (a.x + b.x) / 2 - r.left;
    const my = (a.y + b.y) / 2 - r.top;
    const z = clamp(p.z * (Math.hypot(a.x - b.x, a.y - b.y) / p.d), this.o.minZoom, this.o.maxZoom);
    this.cam.z = z;
    this.cam.tx = mx - ((p.mx - p.tx) / p.z) * z;
    this.cam.ty = my - ((p.my - p.ty) / p.z) * z;
    this._cameraChanged();
  }

  _panEnd(g) {
    if (!this.o.inertia || g.samples.length < 2) return;
    const a = g.samples[0];
    const b = g.samples[g.samples.length - 1];
    if (performance.now() - b.t > 90) return;
    const dt = Math.max(8, b.t - a.t);
    let vx = ((b.dx - a.dx) / dt) * 16;
    let vy = ((b.dy - a.dy) / dt) * 16;
    const step = () => {
      vx *= 0.92;
      vy *= 0.92;
      this.cam.tx += vx;
      this.cam.ty += vy;
      this._cameraChanged();
      this.anim = Math.hypot(vx, vy) > 0.35 ? requestAnimationFrame(step) : 0;
    };
    this.anim = requestAnimationFrame(step);
  }

  /* ----- dragging orbs ----- */

  _dragStart(g) {
    const selected = this.o.selection();
    const keys = selected && selected.has(g.key) ? [...selected] : [g.key];
    g.items = keys.map((k) => this.M.map.get(k)).filter(Boolean).map((n) => ({ n, ox: n.x, oy: n.y }));
    const moving = new Set(g.items.map((it) => it.n.k));
    g.edges = [];
    this.M.edges.forEach((e, i) => { if (moving.has(e.a.k) || moving.has(e.b.k)) g.edges.push(i); });
    for (const it of g.items) this.els.orbs.get(it.n.k)?.classList.add("dragging");
  }

  _dragMove(g, dx, dy) {
    const kx = this.base.sx * this.cam.z;
    const ky = this.base.sy * this.cam.z;
    const M = this.M;
    const xMin = this.camera ? this.base.x0 : 14;
    const xMax = this.camera ? this.base.x1 : M.W - 14;
    const yMin = this.camera ? 14 / ky : 14;
    const yMax = this.camera ? M.H - 30 / ky : M.H - 14;
    for (const it of g.items) {
      it.n.x = clamp(it.ox + dx / kx, xMin, xMax);
      it.n.y = clamp(it.oy + dy / ky, yMin, yMax);
      const p = this.toScreen(it.n.x, it.n.y);
      this.els.orbs.get(it.n.k)?.setAttribute("transform", `translate(${p.x},${p.y})`);
    }
    for (const i of g.edges) this._edge(i, M.edges[i]);
  }

  _dragCancel(g) {
    for (const it of g.items || []) {
      it.n.x = it.ox;
      it.n.y = it.oy;
    }
    this.render();
  }

  _dragEnd(g) {
    const moves = g.items.map((it) => ({ key: it.n.k, x: it.n.x, y: it.n.y, zone: bandAt(this.M, it.n.y) }));
    if (this.o.onDrop) this.o.onDrop(moves, this.M, g);
    else {
      const changes = this.store.dropTricks(moves, autoPositions(this.M));
      if (changes.length) this.o.onZoneChange?.(changes);
    }
  }

  /* ----- marquee select (desktop) ----- */

  _marqueeStart(g) {
    const r = this.root.getBoundingClientRect();
    g.x0 = g.sx - r.left + this.root.scrollLeft;
    g.y0 = g.sy - r.top + this.root.scrollTop;
    g.box = document.createElement("div");
    g.box.className = "mv-marquee";
    g.box.setAttribute("data-mv-ignore", "");
    this.root.append(g.box);
  }

  _marqueeMove(g, e) {
    const r = this.root.getBoundingClientRect();
    const x = e.clientX - r.left + this.root.scrollLeft;
    const y = e.clientY - r.top + this.root.scrollTop;
    g.rect = { x0: Math.min(x, g.x0), y0: Math.min(y, g.y0), x1: Math.max(x, g.x0), y1: Math.max(y, g.y0) };
    Object.assign(g.box.style, {
      left: `${g.rect.x0}px`, top: `${g.rect.y0}px`,
      width: `${g.rect.x1 - g.rect.x0}px`, height: `${g.rect.y1 - g.rect.y0}px`,
    });
  }

  _marqueeEnd(g) {
    g.box?.remove();
    if (!g.rect) return;
    const keys = this.M.nodes.filter((n) => {
      const p = this.toScreen(n.x, n.y);
      return p.x >= g.rect.x0 && p.x <= g.rect.x1 && p.y >= g.rect.y0 && p.y <= g.rect.y1;
    }).map((n) => n.k);
    this.o.onMarquee?.(keys, g.additive);
  }
}
