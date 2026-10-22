// Stance grid: every trick on a row, a level dot for each stance.

import { SIDES, SIDE_ORDER, STANCES, STANCE_SHORT, LEVELS } from "../core/catalog.js";
import { buildModel } from "../core/model.js";
import { esc, dotSvg, bandIconSvg, gray } from "../core/draw.js";

export class GridView {
  constructor(root, store, { onOpen = () => {}, onCell = () => {}, onCellLeave = () => {}, hover = false, include = () => [] } = {}) {
    this.root = root;
    this.store = store;
    this.include = include;
    root.addEventListener("click", (e) => {
      const cell = e.target.closest(".gcell");
      if (cell) return onCell(cell.dataset.k, cell.dataset.st, cell);
      const name = e.target.closest("[data-open]");
      if (name) onOpen(name.dataset.open);
    });
    if (hover) {
      let timer;
      root.addEventListener("pointerover", (e) => {
        if (e.pointerType !== "mouse") return;
        const cell = e.target.closest(".gcell");
        if (!cell) return;
        clearTimeout(timer);
        timer = setTimeout(() => onCell(cell.dataset.k, cell.dataset.st, cell, { hover: true }), 180);
      });
      root.addEventListener("pointerout", (e) => {
        const cell = e.target.closest(".gcell");
        if (!cell || cell.contains(e.relatedTarget)) return;
        clearTimeout(timer);
        onCellLeave(cell.dataset.k, cell.dataset.st);
      });
    }
  }

  render() {
    const store = this.store;
    const M = buildModel(store, { include: this.include() || [] });
    const colors = store.state.sideColors;
    let h = `<div class="grid" role="table" aria-label="Stance grid"><div class="grow ghead" role="row"><span></span>${STANCES.map((st) =>
      `<span role="columnheader" class="${st === "regular" ? "on" : ""}">${STANCE_SHORT[st]}</span>`).join("")}</div>`;
    let rowsShown = 0;
    for (const side of SIDE_ORDER) {
      const rows = M.nodes.filter((n) => n.side === side).sort((a, b) => a.fl - b.fl || a.ay - b.ay);
      if (!rows.length) continue;
      h += `<div class="gband ${side}">${bandIconSvg(side, colors)}${SIDES[side]}</div>`;
      for (const n of rows) {
        const name = store.name(n.k, "regular");
        rowsShown++;
        h += `<div class="grow" role="row"><button class="gname" type="button" data-open="${esc(n.k)}"><i style="background:${gray(n.col)}"></i><span>${esc(name)}</span></button>${STANCES.map((st) => {
          const lv = store.level(n.k, st);
          return `<button class="gcell" type="button" data-k="${esc(n.k)}" data-st="${st}" aria-label="${esc(name)}, ${st}: ${LEVELS[lv]}">${dotSvg(lv)}</button>`;
        }).join("")}</div>`;
      }
    }
    if (!rowsShown) h += `<p class="gempty">No tricks to show. Switch Show to Everything in Settings.</p>`;
    this.root.innerHTML = `${h}</div>`;
  }
}
