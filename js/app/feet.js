// Foot position editor: a top-down skateboard with two draggable shoes.
// Positions are stored for a regular rider (nose on the left) and mirrored
// on screen for goofy riders.

const SHOE = "M0,-50 C13,-50 19,-39 18,-24 C17,-8 15,8 15,24 C15,41 9,50 0,50 C-9,50 -15,41 -15,24 C-15,8 -17,-8 -18,-24 C-19,-39 -13,-50 0,-50Z";
const TOE_CAP = "M0,-50 C13,-50 19,-39 18,-28 L-18,-28 C-19,-39 -13,-50 0,-50Z";
const INSOLE = "M0,-38 C8,-38 10,-30 10,-22 L10,8 C10,14 6,16 0,16 C-6,16 -10,14 -10,8 L-10,-22 C-10,-30 -8,-38 0,-38Z";
const BOLTS = [86, 100, 260, 274].flatMap((x) => [[x, 68], [x, 92]]);

export class FeetEditor {
  constructor(container, store, key, stance = "regular") {
    this.store = store;
    this.key = key;
    this.stance = stance;
    this.selected = null;
    this.feet = JSON.parse(JSON.stringify(store.feet(key, stance)));
    container.innerHTML = `${this._svg()}
      <div class="footctl">
        <span class="hint" data-hint>Drag the shoes. Tap one to rotate it.</span>
        <input type="range" min="-90" max="90" step="5" aria-label="Rotate shoe" hidden>
        <button class="btn small" type="button" data-reset>Reset feet</button>
      </div>`;
    this.svg = container.querySelector("svg");
    this.range = container.querySelector("input[type=range]");
    this.hint = container.querySelector("[data-hint]");
    container.querySelector("[data-reset]").addEventListener("click", () => store.resetFeet(key, stance));
    this.range.addEventListener("input", () => this._rotate());
    this._bindDrag();
  }

  get goofy() { return this.store.pref("rider") === "goofy"; }

  /** Stored (regular) coordinates to screen coordinates, and back. */
  _view(p) { return this.goofy ? { x: 360 - p.x, y: p.y, a: -p.a } : p; }

  _shoe(id, label, fill) {
    const p = this._view(this.feet[id]);
    return `<g class="shoe" data-shoe="${id}" transform="translate(${p.x},${p.y}) rotate(${p.a})">
      <path d="${SHOE}" fill="${fill}" stroke="#1a1a1a" stroke-width="2"/>
      <path d="${TOE_CAP}" fill="#b9b3a8" stroke="#1a1a1a" stroke-width="1.5"/>
      <text x="0" y="-36" text-anchor="middle" font-size="9" font-weight="700" fill="#1a1a1a" font-family="Geist Mono, monospace">TOE</text>
      <rect x="-8" y="42" width="16" height="9" rx="3" fill="#1a1a1a"/>
      <path d="${INSOLE}" fill="none" stroke="#1a1a1a" stroke-width="1" opacity=".35"/>
      ${[-26, -18, -10, -2].map((y) => `<line x1="-6" y1="${y}" x2="6" y2="${y}" stroke="#1a1a1a" stroke-width="1.3" opacity=".5"/>`).join("")}
      <text x="0" y="36" text-anchor="middle" font-size="14" font-weight="600" fill="#1a1a1a" transform="rotate(${-p.a},0,36)">${label}</text>
    </g>`;
  }

  _svg() {
    const label = (x, anchor, text) =>
      `<text x="${x}" y="152" ${anchor ? `text-anchor="${anchor}" ` : ""}font-size="10" font-family="Geist Mono, monospace" fill="#5a4300" letter-spacing="1">${text}</text>`;
    return `<svg class="deck" viewBox="0 0 360 160" role="img" aria-label="Foot position">
      <rect x="16" y="39" width="328" height="82" rx="41" fill="#d9b98a"/>
      <rect x="19" y="42" width="322" height="76" rx="38" fill="#3b3833"/>
      ${BOLTS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.2" fill="#9a958b"/>`).join("")}
      ${label(22, null, this.goofy ? "TAIL" : "NOSE")}
      ${label(338, "end", this.goofy ? "NOSE" : "TAIL")}
      <text x="180" y="20" text-anchor="middle" font-size="10" font-family="Geist Mono, monospace" fill="#5a4300" letter-spacing="1">TOE SIDE</text>
      ${label(180, "middle", "HEEL SIDE")}
      ${this._shoe("b", "B", "#f4f1ea")}${this._shoe("f", "F", "#ffffff")}
    </svg>`;
  }

  _place(id) {
    const p = this._view(this.feet[id]);
    const g = this.svg.querySelector(`[data-shoe="${id}"]`);
    g.setAttribute("transform", `translate(${p.x},${p.y}) rotate(${p.a})`);
    g.querySelector("text:last-of-type").setAttribute("transform", `rotate(${-p.a},0,36)`);
  }

  _select(id) {
    this.selected = id;
    this.range.hidden = false;
    this.range.value = this._view(this.feet[id]).a;
    this.hint.textContent = `Rotate ${id === "f" ? "front" : "back"} foot`;
    for (const shoe of this.svg.querySelectorAll(".shoe")) {
      shoe.querySelector("path").setAttribute("stroke-width", shoe.dataset.shoe === id ? "3.5" : "2");
    }
  }

  _rotate() {
    if (!this.selected) return;
    const a = Number(this.range.value);
    this.feet[this.selected].a = this.goofy ? -a : a;
    this._place(this.selected);
    this.store.setFeet(this.key, this.stance, this.feet, { source: "feet" });
  }

  _bindDrag() {
    const point = (e) => {
      const m = this.svg.getScreenCTM();
      if (!m) return { x: 0, y: 0 };
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      return { x: p.x, y: p.y };
    };
    let drag = null;
    this.svg.addEventListener("pointerdown", (e) => {
      const shoe = e.target.closest(".shoe");
      if (!shoe) return;
      e.preventDefault();
      shoe.setPointerCapture(e.pointerId);
      const id = shoe.dataset.shoe;
      const p = point(e);
      const v = this._view(this.feet[id]);
      drag = { id, dx: v.x - p.x, dy: v.y - p.y, moved: false, sx: p.x, sy: p.y };
    });
    this.svg.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const p = point(e);
      if (Math.hypot(p.x - drag.sx, p.y - drag.sy) > 3) drag.moved = true;
      const x = Math.round(Math.max(0, Math.min(360, p.x + drag.dx)));
      this.feet[drag.id].x = this.goofy ? 360 - x : x;
      this.feet[drag.id].y = Math.round(Math.max(0, Math.min(160, p.y + drag.dy)));
      this._place(drag.id);
    });
    const end = () => {
      if (!drag) return;
      const { id, moved } = drag;
      drag = null;
      this._select(id);
      if (moved) this.store.setFeet(this.key, this.stance, this.feet, { source: "feet" });
    };
    this.svg.addEventListener("pointerup", end);
    this.svg.addEventListener("pointercancel", end);
  }
}
