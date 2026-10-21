// Level picker: the small popover for Not yet / Want it / Landed / Locked in.
// Opens on hover (PC) or on hold (phone), never on a plain tap.

import { LEVELS, WANT_LIMIT, STANCE_LABEL } from "../core/catalog.js";
import { esc } from "../core/draw.js";

export class LevelPicker {
  constructor(store, { hoverMode = false, toast = () => {}, onPick = null } = {}) {
    this.store = store;
    this.hoverMode = hoverMode;
    this.toast = toast;
    this.onPick = onPick;
    this.cur = null;
    this.el = document.createElement("div");
    this.el.className = "pop";
    this.el.hidden = true;
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Set level");
    document.body.append(this.el);

    this.el.addEventListener("click", (e) => this._click(e));
    this.el.addEventListener("pointerenter", () => clearTimeout(this._hideT));
    this.el.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") this.scheduleHide(250); });
    document.addEventListener("pointerdown", (e) => {
      if (this.el.hidden || this.el.contains(e.target) || e.target.closest(".orb,.gcell,[data-levels]")) return;
      this.hide();
    }, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") this.hide(); });
    store.subscribe(() => { if (!this.el.hidden && this.cur) this._paint(); });
  }

  get open() { return !this.el.hidden; }

  show(key, stance, anchor, { showStance = false } = {}) {
    if (!anchor) return;
    clearTimeout(this._hideT);
    this.cur = { key, stance, anchor, showStance, warn: false };
    this._paint();
    this.el.hidden = false;
    this._place();
  }

  scheduleHide(ms = 300) {
    clearTimeout(this._hideT);
    this._hideT = setTimeout(() => this.hide(), ms);
  }

  hide() {
    clearTimeout(this._hideT);
    this.el.hidden = true;
    this.cur = null;
  }

  _paint() {
    const { key, stance, showStance, warn } = this.cur;
    const level = this.store.level(key, stance);
    const wants = this.store.wants().length;
    const title = warn
      ? `<div class="pt warn">${WANT_LIMIT} wants max. Drop one first.</div>`
      : `<div class="pt">${esc(this.store.name(key, stance))}${showStance ? ` <span>· ${STANCE_LABEL[stance]}</span>` : ""}</div>`;
    this.el.innerHTML = `${title}<div class="pr">${LEVELS.map((label, i) =>
      `<button type="button" data-lv="${i}" aria-pressed="${level === i}">${label}${i === 1 ? ` <small>${wants}/${WANT_LIMIT}</small>` : ""}</button>`).join("")}</div>`;
  }

  _place() {
    const anchor = this.cur?.anchor;
    if (!anchor || !anchor.isConnected) return;
    const r = anchor.getBoundingClientRect();
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    let x = r.left + r.width / 2 - w / 2;
    let y = r.top - h - 10;
    x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    if (y < 8) y = r.bottom + 10;
    this.el.style.left = `${Math.round(x)}px`;
    this.el.style.top = `${Math.round(y)}px`;
  }

  _click(e) {
    const b = e.target.closest("[data-lv]");
    if (!b || !this.cur) return;
    const { key, stance } = this.cur;
    const value = Number(b.dataset.lv);
    const result = this.store.setLevel(key, stance, value);
    if (!result.ok) {
      this.cur.warn = true;
      this._paint();
      const names = result.wants.map((w) => esc(this.store.name(w.key, w.stance))).join(", ");
      this.toast(`You can only want ${WANT_LIMIT} tricks at a time. Drop one first: ${names}.`);
      return;
    }
    this.toast(`<b>${esc(this.store.name(key, stance))}</b> · ${LEVELS[value]}`);
    this.onPick?.(key, stance, value);
    if (!this.hoverMode) this.hide();
  }
}
