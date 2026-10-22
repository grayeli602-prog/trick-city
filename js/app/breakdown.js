// Trick breakdown: name, side, ingredients, add-ons and how it connects.
// Foot placement lives in the inspector.

import { SIDES, parseKey, parentKeys, stepKey, depthOf, rooted, maxCount, BASE_COLOR } from "../core/catalog.js";
import { buildModel } from "../core/model.js";
import { esc, ingredientCount, gray } from "../core/draw.js";

export class Breakdown {
  constructor(store, { stance = "regular", onNavigate = () => {}, onClose = null, toast = () => {}, closeButton = true } = {}) {
    this.store = store;
    this.stance = stance;
    this.onNavigate = onNavigate;
    this.onClose = onClose;
    this.toast = toast;
    this.closeButton = closeButton;
    this.key = null;
    this.el = document.createElement("div");
    this.el.className = "sin";
    this.el.addEventListener("click", (e) => this._click(e));
    this.el.addEventListener("input", (e) => {
      if (e.target.matches("[data-name]")) this.store.rename(this.key, e.target.value, { source: "name" });
    });
    this.el.addEventListener("change", (e) => {
      if (e.target.matches("[data-name]")) this.render(this.key);
    });
    store.subscribe((info) => {
      if (this.key === null || !this.el.isConnected) return;
      if (info.source === "name" || info.source === "feet") return;
      this.render(this.key);
    });
  }

  /** Go to another trick from inside the breakdown (adds it to the map if needed). */
  goTo(key) {
    if (this.store.isAddonOnly(key)) {
      this.toast("Add-ons like body varials go on top of a trick, not on their own.");
      return;
    }
    this.store.ensureTrick(key);
    this.onNavigate(key);
  }

  render(key) {
    this.key = key;
    const store = this.store;
    const recipe = parseKey(key);
    const ids = Object.keys(recipe).sort((a, b) => store.ingIndex(a) - store.ingIndex(b));
    const side = store.side(key);
    const M = buildModel(store, { stance: this.stance, include: [key], filter: "all" });
    const children = M.edges.filter((e) => e.a.k === key).map((e) => e.b.k);
    const parents = parentKeys(key);
    const available = store.state.ingredients.filter((i) => !(recipe[i.id] >= maxCount(i)) && !(i.addon && !key));
    const quick = store.state.ingredients.filter((i) => i.addon || i.id === "bb" || i.id === "fb");
    const chip = (k) => `<button class="chip" type="button" data-go="${esc(k)}"><i style="background:${gray(store.color(k))}"></i>${esc(store.name(k, this.stance))}</button>`;
    const focusedName = document.activeElement?.matches?.("[data-name]") && this.el.contains(document.activeElement);

    this.el.innerHTML = `
      <div class="shead">
        <div style="flex:1;min-width:0">
          <div class="mono">${ingredientCount(depthOf(recipe))} · ${this.stance} · ${SIDES[side]}</div>
          <input class="nameinput" data-name value="${esc(store.name(key, this.stance))}" aria-label="Trick name" autocomplete="off">
        </div>
        ${this.closeButton ? `<button class="x" type="button" data-close aria-label="Close">×</button>` : ""}
      </div>
      <div class="sec">
        <span class="mono">Side</span>
        <div class="side">${Object.entries(SIDES).map(([v, l]) => `<button type="button" data-side="${v}" aria-pressed="${side === v}">${l}</button>`).join("")}</div>
      </div>
      <div class="sec">
        <span class="mono">Breakdown</span>
        ${rooted(recipe) ? "" : `<div class="ing"><i style="background:${BASE_COLOR}"></i><span class="nm">Ollie <small>base</small></span></div>`}
        ${ids.map((id) => {
          const ing = store.ing(id) || { name: id, color: "#888888", side: "earth" };
          return `<div class="ing"><i style="background:${gray(ing.color)}"></i><span class="nm">${esc(ing.name)}<small>${SIDES[ing.side]}</small></span>
            <div class="step"><button type="button" data-step="${esc(id)}" data-d="-1" aria-label="Less ${esc(ing.name)}">−</button><span>x${recipe[id]}</span><button type="button" data-step="${esc(id)}" data-d="1" aria-label="More ${esc(ing.name)}" ${recipe[id] >= maxCount(ing) ? "disabled" : ""}>+</button></div></div>`;
        }).join("")}
        <div class="addrow">
          <select data-addsel aria-label="Ingredient to add">${available.map((i) => `<option value="${esc(i.id)}">${esc(i.name)}${recipe[i.id] ? " (make it x2)" : ""}</option>`).join("")}</select>
          <button class="btn" type="button" data-add>Add</button>
        </div>
        <p class="hint">Changing ingredients jumps to that trick and puts it on your map, linked to this one.</p>
      </div>
      <div class="sec">
        <span class="mono">Add-ons</span>
        <div class="chips">${quick.map((i) => `<button class="chip" type="button" data-step="${esc(i.id)}" data-d="1" ${recipe[i.id] >= maxCount(i) || (i.addon && !key) ? "disabled" : ""}><i style="background:${gray(i.color)}"></i>+ ${esc(i.name)}</button>`).join("")}</div>
        <p class="hint">${key ? "Adds it on top of this trick as a new linked trick." : "Body varials go on top of a trick. Pick a trick first."}</p>
      </div>
      <div class="sec"><span class="mono">Built from</span><div class="chips">${parents.length ? parents.map(chip).join("") : `<span class="hint">Nothing. This is the base.</span>`}</div></div>
      <div class="sec"><span class="mono">Leads to</span><div class="chips">${children.length ? children.map(chip).join("") : `<span class="hint">Nothing on the map yet. Add an ingredient above.</span>`}</div></div>
      <div class="row">
        <button class="btn small" type="button" data-resetpos>Reset position</button>
        ${key ? `<button class="btn small" type="button" data-remove>Remove from map</button>` : ""}
        ${store.state.names[key] ? `<button class="btn small" type="button" data-resetname>Use auto name</button>` : ""}
      </div>`;
    if (focusedName) this.el.querySelector("[data-name]")?.focus();
  }

  focusAdd() {
    this.el.querySelector("[data-addsel]")?.focus();
  }

  _click(e) {
    const t = e.target.closest("button");
    if (!t || this.key === null) return;
    const key = this.key;
    const store = this.store;
    if (t.hasAttribute("data-close")) this.onClose?.();
    else if (t.dataset.side) store.setSide(key, t.dataset.side);
    else if (t.dataset.step) this.goTo(stepKey(key, t.dataset.step, Number(t.dataset.d)));
    else if (t.hasAttribute("data-add")) {
      const id = this.el.querySelector("[data-addsel]")?.value;
      if (id) this.goTo(stepKey(key, id, 1));
    } else if (t.dataset.go !== undefined) this.goTo(t.dataset.go);
    else if (t.hasAttribute("data-resetpos")) store.resetPosition(key);
    else if (t.hasAttribute("data-resetname")) store.rename(key, "");
    else if (t.hasAttribute("data-remove")) {
      const name = store.name(key);
      store.removeTrick(key);
      this.toast(`Removed <b>${esc(name)}</b>`);
      this.onClose?.();
    }
  }
}
