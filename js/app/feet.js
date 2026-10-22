// Foot position editor: a top-down skateboard with two draggable shoes.
// Positions are stored for a regular rider (nose on the left) and mirrored
// on screen for goofy riders.

// One shoe seen from above, toe up, centered on 0,0: a black skate shoe with a
// white sole, white laces and a light collar. Our own drawing, no brand's.
const SOLE = "M0,-50 C13,-50 19,-39 18,-24 C17,-8 15,8 15,24 C15,41 9,50 0,50 C-9,50 -15,41 -15,24 C-15,8 -17,-8 -18,-24 C-19,-39 -13,-50 0,-50Z";
const UPPER = "M0,-44 C10.4,-44 15.2,-34.3 14.4,-21.1 C13.6,-7 12,7 12,21.1 C12,36.1 7.2,44 0,44 C-7.2,44 -12,36.1 -12,21.1 C-12,7 -13.6,-7 -14.4,-21.1 C-15.2,-34.3 -10.4,-44 0,-44Z";
const TONGUE = "M-6.5,-27 C-6.5,-31 6.5,-31 6.5,-27 L7,12 C7,15.5 -7,15.5 -7,12Z";
const COLLAR = "M0,15.5 C7.2,15.5 9.5,21 9.5,28 C9.5,36.5 5.8,41 0,41 C-5.8,41 -9.5,36.5 -9.5,28 C-9.5,21 -7.2,15.5 0,15.5Z";
const LACES = [-23, -16, -9, -2, 5];
const LABEL_Y = 28.5;
const shoeArt = [
  `<path class="sole" d="${SOLE}" fill="#f3f2ed" stroke="#101010" stroke-width="1.5"/>`,
  `<path d="${UPPER}" fill="#151515"/>`,
  `<path d="M-12,-30.5 C-5,-35.5 5,-35.5 12,-30.5" fill="none" stroke="#454545" stroke-width="1" stroke-dasharray="2 1.6"/>`,
  `<path d="${TONGUE}" fill="#232323"/>`,
  ...LACES.map((y) => `<circle cx="-9.2" cy="${y}" r="1" fill="#777"/><circle cx="9.2" cy="${y}" r="1" fill="#777"/>`),
  ...LACES.map((y) => `<path d="M-8.4,${y} L8.4,${y + 1.2}" stroke="#f3f2ed" stroke-width="2.3" stroke-linecap="round"/>`),
  `<path d="${COLLAR}" fill="#e7e5df" stroke="#0c0c0c" stroke-width="1.2"/>`,
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
      <text x="0" y="${LABEL_Y + 4.3}" text-anchor="middle" font-size="12" font-weight="700" fill="#151515" font-family="Geist, system-ui, sans-serif" transform="rotate(${-p.a},0,${LABEL_Y})">${label}</text>
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
