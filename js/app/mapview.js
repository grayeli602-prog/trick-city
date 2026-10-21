// Interactive trick map. Draws the Sun/Earth/Moon bands, the subway lines and
// the orbs, and turns pointer input into taps, holds, hovers, drags, box
// select, pans and pinch zoom.
//
// Projections:
//   "fit"      stretched to fill the box (phone); two fingers pan and zoom
//   "contain"  uniform scale with a free camera (PC); scroll to pan, pinch or
//              Ctrl/Cmd + scroll to zoom

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
      orbScale: 0.9,
      labelSize: 10.5,
      minZoom: 1,
      maxZoom: 4,
      emptyDrag: "none",       // "none" | "pan" | "marquee", or (pointerType, event) => one of those
      orbDrag: true,
      longPressMs: 450,
      doubleTapEmpty: "reset", // "reset" | null
      stance: "regular",
      focusY: 0.42,
      include: () => [],
      selection: () => null,   // Set of selected keys (ring, and they drag together)
      decorate: null,          // (node) => { dim, ring, strong, cls, extra, hideLabel }
      edgeStyle: null,         // (edge) => { opacity, width, color }
      onTap: null, onTapEmpty: null, onLongPress: null, onHover: null, onHoverEnd: null,
      onZoneChange: null, onMarquee: null, onCamera: null, onRender: null, onGestureStart: null,
      ...options,
    };

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

    if (typeof ResizeObserver !== "undefined") {
      let last = "";
      new ResizeObserver(() => {
        const size = `${root.clientWidth}x${root.clientHeight}`;
        if (size !== last && root.clientWidth) {
          last = size;
          this.render();
        }
      }).observe(root);
    }
  }

  /* ---------- coordinates ---------- */

  toScreen(x, y) {
    const b = this.base;
    const c = this.cam;
    return { x: (x * b.sx + b.ox) * c.z + c.tx, y: (y * b.sy + b.oy) * c.z + c.ty };
  }

  _project(M) {
    const b = this.base;
    b.vw = this.root.clientWidth || window.innerWidth;
    b.vh = this.root.clientHeight || window.innerHeight;
    const xs = M.nodes.map((n) => n.x);
    b.x0 = Math.min(LAYOUT.X0, ...xs);
    b.x1 = Math.max(LAYOUT.X0 + M.maxFl * LAYOUT.COLW, ...xs);
    if (this.o.projection === "fit") {
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
    } else if (this.M) {
      // Keep some of the map on screen.
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
    const { vw: W, vh: H } = this.base;
    const selected = this.o.selection() || null;

    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trick map">`;
    s += `<g class="mv-bands">${SIDE_ORDER.map((side) => `<rect data-band="${side}" fill="${BAND_FILL[side]}"/>`).join("")}</g>`;
    s += `<g class="mv-bandlabels">${SIDE_ORDER.map((side) =>
      `<g data-bandlabel="${side}">${bandIcon(side, colors)}<text class="mv-bandtext" x="11" y="3.5" font-size="9.5">${SIDES[side].toUpperCase()}</text></g>`).join("")}</g>`;
    s += `<g class="mv-edges">`;
    M.edges.forEach((e, i) => {
      const st = this.o.edgeStyle?.(e) || {};
      const opacity = st.opacity ?? (e.b.lv >= 2 && e.a.lv >= 2 ? 0.95 : 0.45);
      s += `<path data-e="${i}" fill="none" stroke="${st.color || tone(e.c, palette)}" stroke-width="${st.width || 2}" stroke-linejoin="round" stroke-linecap="round" opacity="${opacity}"/>`;
    });
    s += `</g><g class="mv-orbs">${M.nodes.map((n) => this._orb(n, M, palette, selected)).join("")}</g></svg>`;

    this.canvas.innerHTML = s;
    this.svg = this.canvas.firstElementChild;
    this.els = {
      bands: [...this.svg.querySelectorAll("[data-band]")],
      bandLabels: [...this.svg.querySelectorAll("[data-bandlabel]")],
      edges: [...this.svg.querySelectorAll("[data-e]")],
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
    if (!d.hideLabel) {
      const width = Math.max(56, LAYOUT.COLW * this.base.sx * this.cam.z - 6);
      const lines = wrapWords(n.name, width, fs);
      label = `<text y="${15 + fs * 0.8}" text-anchor="middle" font-size="${fs}" font-weight="${strong ? 600 : 500}" fill="${fill}" stroke="${halo}" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${lines.map((l, i) => `<tspan x="0" dy="${i ? fs * 1.1 : 0}">${esc(l)}</tspan>`).join("")}</text>`;
    }
    return `<g class="orb${d.cls ? ` ${d.cls}` : ""}" data-k="${esc(n.k)}"${d.dim != null ? ` opacity="${d.dim}"` : ""}>` +
      `<circle class="hit" r="24" fill="transparent"/>${ring ? SELECT_RING : ""}` +
      `<g class="dot" transform="scale(${this.o.orbScale})">${orbSvg(n.lv, tone(n.col, palette), palette)}</g>` +
      `${d.extra || ""}${label}</g>`;
  }

  /** Position bands, lines and orbs for the current camera (no rebuild). */
  _layout() {
    const M = this.M;
    if (!M || !this.els) return;
    for (const r of this.els.bands) {
      const band = M.bands[r.dataset.band];
      const y0 = this.toScreen(0, band.y0).y;
      const y1 = this.toScreen(0, band.y1).y;
      r.setAttribute("x", 0);
      r.setAttribute("y", y0);
      r.setAttribute("width", this.base.vw);
      r.setAttribute("height", Math.max(0, y1 - y0));
    }
    for (const g of this.els.bandLabels) {
      const band = M.bands[g.dataset.bandlabel];
      const y0 = this.toScreen(0, band.y0).y;
      const y1 = this.toScreen(0, band.y1).y;
      g.setAttribute("transform", `translate(12,${clamp(14, y0 + 14, y1 - 12)})`);
    }
    M.edges.forEach((e, i) => this._edge(i, e));
    for (const n of M.nodes) {
      const p = this.toScreen(n.x, n.y);
      this.els.orbs.get(n.k)?.setAttribute("transform", `translate(${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10})`);
    }
  }

  _edge(i, e) {
    this.els.edges[i]?.setAttribute("d", edgePath(this.toScreen(e.a.x, e.a.y), this.toScreen(e.b.x, e.b.y)));
  }

  _cameraChanged() {
    this._clampCamera();
    this._layout();
    this.o.onCamera?.(this.cam, this);
    // Labels wrap to the column width, so rebuild when the zoom changes a lot.
    if (Math.abs(Math.log(this.cam.z / (this._renderedZoom || 1))) > 0.35) {
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
    if (!n) return;
    const z = clamp(zoom ?? this.cam.z, this.o.minZoom, this.o.maxZoom);
    const bx = n.x * this.base.sx + this.base.ox;
    const by = n.y * this.base.sy + this.base.oy;
    this.animateTo({ z, tx: this.base.vw / 2 - bx * z, ty: this.base.vh * this.o.focusY - by * z });
  }

  resetCamera(animated = true) {
    const target = { z: 1, tx: 0, ty: 0 };
    if (animated) this.animateTo(target);
    else {
      Object.assign(this.cam, target);
      this._cameraChanged();
    }
  }

  /** Zoom by `factor` around a point (screen coordinates inside the map). */
  zoomAt(factor, cx, cy, ms = 0) {
    const z = clamp(this.cam.z * factor, this.o.minZoom, this.o.maxZoom);
    const k = z / this.cam.z;
    const target = { z, tx: cx - (cx - this.cam.tx) * k, ty: cy - (cy - this.cam.ty) * k };
    if (ms) this.animateTo(target, ms);
    else {
      Object.assign(this.cam, target);
      this._cameraChanged();
    }
  }

  /* ---------- input ---------- */

  _bind() {
    const r = this.root;
    r.addEventListener("pointerdown", (e) => this._down(e));
    r.addEventListener("pointermove", (e) => this._move(e));
    r.addEventListener("pointerup", (e) => this._up(e));
    r.addEventListener("pointercancel", (e) => this._up(e));
    r.addEventListener("lostpointercapture", (e) => { if (this.pointers.has(e.pointerId)) this._up(e); });
    r.addEventListener("contextmenu", (e) => e.preventDefault());
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
    for (const t of ["gesturestart", "gesturechange"]) r.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  }

  _down(e) {
    if (e.target.closest("[data-mv-ignore]")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { this.root.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this._stopAnim();
    if (this.pointers.size >= 2) {
      this._pinchStart();
      return;
    }
    const orb = e.target.closest(".orb");
    const key = orb ? orb.dataset.k : null;
    const g = (this.g = {
      id: e.pointerId, key, sx: e.clientX, sy: e.clientY, moved: false, long: false,
      type: e.pointerType, additive: e.shiftKey || e.metaKey || e.ctrlKey,
    });
    clearTimeout(this._hoverT);
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
    if (!g || g.id !== e.pointerId || g.long) return;
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (!g.moved) {
      if (Math.hypot(dx, dy) < 7) return;
      g.moved = true;
      clearTimeout(g.lp);
      if (g.key !== null && this.o.orbDrag) g.mode = "drag";
      else {
        const empty = typeof this.o.emptyDrag === "function" ? this.o.emptyDrag(g.type, e, g) : this.o.emptyDrag;
        g.mode = empty === "pan" ? "pan" : g.key === null && empty === "marquee" ? "marquee" : null;
      }
      if (g.mode === "drag") this._dragStart(g);
      else if (g.mode === "pan") g.t0 = { tx: this.cam.tx, ty: this.cam.ty };
      else if (g.mode === "marquee") this._marqueeStart(g);
      this.o.onGestureStart?.(g);
    }
    if (g.mode === "drag") this._dragMove(g, dx, dy);
    else if (g.mode === "pan") {
      this.cam.tx = g.t0.tx + dx;
      this.cam.ty = g.t0.ty + dy;
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
    if (g.long) return;
    if (e.type === "pointercancel" || e.type === "lostpointercapture") {
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
    else if (g.mode === "marquee") this._marqueeEnd(g);
  }

  _tapEmpty(e) {
    const now = performance.now();
    if (this.o.doubleTapEmpty === "reset" && now - (this._lastTap || 0) < 320) {
      this._lastTap = 0;
      this.resetCamera(true);
      return;
    }
    this._lastTap = now;
    this.o.onTapEmpty?.(e);
  }

  _wheel(e) {
    e.preventDefault();
    this._stopAnim();
    if (!e.ctrlKey && !e.metaKey) {
      // Scroll pans (Shift + scroll pans sideways on a mouse wheel).
      const k = e.deltaMode === 1 ? 16 : 1;
      const sideways = e.shiftKey && !e.deltaX;
      this.cam.tx -= (sideways ? e.deltaY : e.deltaX) * k;
      this.cam.ty -= (sideways ? 0 : e.deltaY) * k;
      this._cameraChanged();
      return;
    }
    // Pinch on a trackpad (sent as Ctrl + scroll) or Ctrl/Cmd + mouse wheel zooms.
    const r = this.root.getBoundingClientRect();
    this.zoomAt(Math.exp(-e.deltaY * 0.012), e.clientX - r.left, e.clientY - r.top);
  }

  /* ----- pinch ----- */

  _pinchStart() {
    const g = this.g;
    if (g) {
      clearTimeout(g.lp);
      if (g.mode === "drag") this._dragCancel(g);
      if (g.mode === "marquee") g.box?.remove();
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
    for (const it of g.items) {
      it.n.x = clamp(it.ox + dx / kx, this.base.x0, this.base.x1);
      it.n.y = clamp(it.oy + dy / ky, 14 / ky, M.H - 30 / ky);
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
    const changes = this.store.dropTricks(moves, autoPositions(this.M));
    if (changes.length) this.o.onZoneChange?.(changes);
  }

  /* ----- box select ----- */

  _marqueeStart(g) {
    const r = this.root.getBoundingClientRect();
    g.x0 = g.sx - r.left;
    g.y0 = g.sy - r.top;
    g.box = document.createElement("div");
    g.box.className = "mv-marquee";
    g.box.setAttribute("data-mv-ignore", "");
    this.root.append(g.box);
  }

  _marqueeMove(g, e) {
    const r = this.root.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
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
