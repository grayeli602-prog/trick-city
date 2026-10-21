// Ingredient and color editor: rename, recolor, pick a side, add your own.

import { SIDES } from "../core/catalog.js";
import { esc } from "../core/draw.js";

export class IngredientsEditor {
  constructor(root, store) {
    this.root = root;
    this.store = store;
    root.innerHTML = `
      <p class="hint">Every trick is an ollie plus ingredients. Edit these or add your own. Side decides whether a trick lands on Sun or Moon.</p>
      <div class="irows" data-rows></div>
      <div><button class="btn" type="button" data-add-ing>+ Add ingredient</button></div>
      <div class="sidecolors" data-sidecolors></div>`;
    this.rows = root.querySelector("[data-rows]");
    this.sideColors = root.querySelector("[data-sidecolors]");

    root.addEventListener("input", (e) => {
      const t = e.target;
      if (t.dataset.color) store.updateIngredient(t.dataset.color, { color: t.value }, { source: "ing-live" });
      else if (t.dataset.name) store.updateIngredient(t.dataset.name, { name: t.value }, { source: "ing-live" });
      else if (t.dataset.sidecolor) store.setSideColor(t.dataset.sidecolor, t.value, { source: "ing-live" });
    });
    root.addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset.side) store.updateIngredient(t.dataset.side, { side: t.value });
    });
    root.addEventListener("click", (e) => {
      const del = e.target.closest("[data-del]");
      if (del) store.deleteIngredient(del.dataset.del);
      if (e.target.closest("[data-add-ing]")) {
        const id = store.addIngredient();
        const input = this.rows.querySelector(`[data-name="${CSS.escape(id)}"]`);
        input?.focus();
        input?.select();
      }
    });
    store.subscribe((info) => { if (info.source !== "ing-live") this.render(); });
    this.render();
  }

  render() {
    const s = this.store.state;
    this.rows.innerHTML = s.ingredients.map((i) => `
      <div class="irow">
        <input type="color" data-color="${esc(i.id)}" value="${i.color}" aria-label="Color for ${esc(i.name)}">
        <input type="text" data-name="${esc(i.id)}" value="${esc(i.name)}" aria-label="Ingredient name" autocomplete="off">
        <select data-side="${esc(i.id)}" aria-label="Side for ${esc(i.name)}">${Object.entries(SIDES).map(([v, l]) => `<option value="${v}" ${i.side === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        ${i.builtin ? "<span></span>" : `<button class="del" type="button" data-del="${esc(i.id)}" aria-label="Delete ${esc(i.name)}">×</button>`}
      </div>`).join("");
    this.sideColors.innerHTML = Object.entries(SIDES).map(([v, l]) =>
      `<label><input type="color" data-sidecolor="${v}" value="${s.sideColors[v]}"> ${l} color</label>`).join("");
  }
}
