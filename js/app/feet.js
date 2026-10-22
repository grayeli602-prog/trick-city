// Foot position editor: a top-down skateboard with two draggable shoes.
// Positions are stored for a regular rider (nose on the left) and mirrored
// on screen for goofy riders.

// One shoe seen from above, toe up, centered on 0,0, drawn cartoon style: thick
// outlines, a chunky white sole, a shiny black upper and fat white laces.
// Our own design, not any brand's.
const SOLE = "M0,-52 C15.5,-52 22,-40 21,-24 C20,-8 18,8 18,25 C18,43 10.5,52 0,52 C-10.5,52 -18,43 -18,25 C-18,8 -20,-8 -21,-24 C-22,-40 -15.5,-52 0,-52Z";
const UPPER = "M0,-45.5 C12.4,-45.5 17.6,-35 16.8,-21 C16,-7 14.4,7 14.4,21.9 C14.4,37.6 8.4,45.5 0,45.5 C-8.4,45.5 -14.4,37.6 -14.4,21.9 C-14.4,7 -16,-7 -16.8,-21 C-17.6,-35 -12.4,-45.5 0,-45.5Z";
const STITCH = "M0,-41.6 C10.9,-41.6 15.4,-32 14.7,-19.2 C14,-6.4 12.6,6.4 12.6,20 C12.6,34.4 7.4,41.6 0,41.6 C-7.4,41.6 -12.6,34.4 -12.6,20 C-12.6,6.4 -14,-6.4 -14.7,-19.2 C-15.4,-32 -10.9,-41.6 0,-41.6Z";
const TONGUE = "M-7.5,-28.5 C-7.5,-34 7.5,-34 7.5,-28.5 L8,12.5 C8,16.5 -8,16.5 -8,12.5Z";
const COLLAR = "M0,16.5 C8,16.5 10.8,22.5 10.8,29.5 C10.8,38.5 6.8,43 0,43 C-6.8,43 -10.8,38.5 -10.8,29.5 C-10.8,22.5 -8,16.5 0,16.5Z";
const HEEL_TAB = "M-4.2,44 L4.2,44 L3.8,50.2 C3.8,51.6 -3.8,51.6 -3.8,50.2Z";
const LACES = [-22, -13.5, -5, 3.5];
const LABEL_Y = 30;
const INK = "#111";
const WHITE = "#fbfaf6";
const shoeArt = [
  `<path class="sole" d="${SOLE}" fill="${WHITE}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`,
  `<path d="${UPPER}" fill="#1e1e1e" stroke="${INK}" stroke-width="1.6"/>`,
  `<path d="${STITCH}" fill="none" stroke="${WHITE}" stroke-width="1.1" stroke-dasharray="2.4 2.2" opacity=".35"/>`,
  `<path d="M-9.5,-35.5 C-7,-40.5 -1.5,-42 3.5,-41.2" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" opacity=".8"/>`,
  `<circle cx="8" cy="-38.5" r="1.5" fill="#fff" opacity=".8"/>`,
  `<path d="${TONGUE}" fill="#2c2c2c" stroke="${INK}" stroke-width="1.4"/>`,
  ...LACES.map((y) => `<circle cx="-10.4" cy="${y + 0.8}" r="1.1" fill="#8a8a8a"/><circle cx="10.4" cy="${y + 0.8}" r="1.1" fill="#8a8a8a"/>`),
  ...LACES.map((y) => `<path d="M-9,${y} L9,${y + 1.6}" stroke="${INK}" stroke-width="5.6" stroke-linecap="round"/><path d="M-9,${y} L9,${y + 1.6}" stroke="${WHITE}" stroke-width="3.2" stroke-linecap="round"/>`),
  `<path d="${HEEL_TAB}" fill="#1e1e1e" stroke="${INK}" stroke-width="1.4"/>`,
  `<path d="${COLLAR}" fill="#efede8" stroke="${INK}" stroke-width="2.2"/>`,
].join("");
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

  _shoe(id, label) {
    const p = this._view(this.feet[id]);
    return `<g class="shoe${this.selected === id ? " on" : ""}" data-shoe="${id}" transform="translate(${p.x},${p.y}) rotate(${p.a})">
      ${shoeArt}
      <text x="0" y="${LABEL_Y + 4.6}" text-anchor="middle" font-size="13" font-weight="700" fill="${INK}" font-family="Geist, system-ui, sans-serif" transform="rotate(${-p.a},0,${LABEL_Y})">${label}</text>
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
      ${this._shoe("b", "B")}${this._shoe("f", "F")}
    </svg>`;
  }

  _place(id) {
    const p = this._view(this.feet[id]);
    const g = this.svg.querySelector(`[data-shoe="${id}"]`);
    g.setAttribute("transform", `translate(${p.x},${p.y}) rotate(${p.a})`);
    g.querySelector("text:last-of-type").setAttribute("transform", `rotate(${-p.a},0,${LABEL_Y})`);
  }

  _select(id) {
    this.selected = id;
    this.range.hidden = false;
    this.range.value = this._view(this.feet[id]).a;
    this.hint.textContent = `Rotate ${id === "f" ? "front" : "back"} foot`;
    for (const shoe of this.svg.querySelectorAll(".shoe")) shoe.classList.toggle("on", shoe.dataset.shoe === id);
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
