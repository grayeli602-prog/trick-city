// Bottom sheet that slides up from the bottom. Swipe the grabber down to close.

export class Sheet {
  constructor({ className = "", label = "Details", onClose = null } = {}) {
    this.onClose = onClose;
    this.el = document.createElement("section");
    this.el.className = `sheet ${className}`.trim();
    this.el.hidden = true;
    this.el.setAttribute("aria-label", label);
    this.grab = document.createElement("button");
    this.grab.className = "grab";
    this.grab.type = "button";
    this.grab.setAttribute("aria-label", "Close");
    this.body = document.createElement("div");
    this.el.append(this.grab, this.body);
    document.body.append(this.el);
    this.grab.addEventListener("click", () => { if (!this._dragged) this.close(); });
    this._bindSwipe();
  }

  get isOpen() { return !this.el.hidden && this.el.classList.contains("open"); }

  open() {
    clearTimeout(this._hideT);
    if (this.el.hidden) {
      this.el.hidden = false;
      this.el.scrollTop = 0;
      void this.el.offsetHeight; // start the slide from below
    }
    this.el.style.transform = "";
    this.el.classList.add("open");
  }

  close({ silent = false } = {}) {
    if (this.el.hidden) return;
    this.el.classList.remove("open");
    this.el.style.transform = "";
    clearTimeout(this._hideT);
    this._hideT = setTimeout(() => { this.el.hidden = true; }, 330);
    if (!silent) this.onClose?.();
  }

  _bindSwipe() {
    let start = null;
    this.grab.addEventListener("pointerdown", (e) => {
      start = { y: e.clientY, t: performance.now() };
      this._dragged = false;
      this.grab.setPointerCapture(e.pointerId);
      this.el.classList.add("dragging");
    });
    this.grab.addEventListener("pointermove", (e) => {
      if (!start) return;
      const dy = Math.max(0, e.clientY - start.y);
      if (dy > 4) this._dragged = true;
      this.el.style.transform = `translateY(${dy}px)`;
    });
    const end = (e) => {
      if (!start) return;
      const dy = Math.max(0, e.clientY - start.y);
      const fast = dy / Math.max(1, performance.now() - start.t) > 0.6;
      start = null;
      this.el.classList.remove("dragging");
      if (dy > 90 || (fast && dy > 30)) this.close();
      else this.el.style.transform = "";
      setTimeout(() => { this._dragged = false; }, 0);
    };
    this.grab.addEventListener("pointerup", end);
    this.grab.addEventListener("pointercancel", end);
  }
}
