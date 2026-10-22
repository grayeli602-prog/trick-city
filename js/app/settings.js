// Settings menu (gear) with display options and backup & restore.

import { parseBackup, summarize } from "../core/store.js";
import { esc, legendHtml } from "../core/draw.js";
import { Sheet } from "./sheet.js";

const PREFS = [
  ["filter", "Show", [["all", "Everything"], ["next", "Next stops"]]],
  ["layout", "Layout", [["auto", "Auto"], ["custom", "Custom"]]],
  ["rider", "I ride", [["regular", "Regular"], ["goofy", "Goofy"]]],
];

export function formatWhen(t) {
  if (!t) return "Never";
  const d = new Date(t);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 864e5);
  if (diff === 0) return `Today, ${time}`;
  if (diff === 1) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" })}, ${time}`;
}

function summaryHtml(sum) {
  return `<div class="summary">
    <div><b>${sum.landed}</b><span>landed or locked</span></div>
    <div><b>${sum.wants}</b><span>wants</span></div>
    <div><b>${sum.placed}</b><span>orbs placed</span></div>
  </div>`;
}

export class Settings {
  constructor(store, { wrap, phone = false, toast = () => {}, openIngredients = null }) {
    this.store = store;
    this.phone = phone;
    this.toast = toast;
    this.openIngredients = openIngredients;
    this.button = wrap.querySelector(".gear");
    this.panel = wrap.querySelector(".settings");
    this.dialog = new Sheet({ className: "dialog", label: "Backup" });

    this.file = document.createElement("input");
    this.file.type = "file";
    this.file.accept = ".json,application/json,text/plain";
    this.file.hidden = true;
    document.body.append(this.file);
    this.file.addEventListener("change", () => this._readFile());

    this.button.addEventListener("click", (e) => {
      e.stopPropagation();
      this.panel.hidden ? this.open() : this.close();
    });
    document.addEventListener("pointerdown", (e) => {
      if (!this.panel.hidden && !wrap.contains(e.target)) this.close();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") this.close(); });
    this.panel.addEventListener("click", (e) => this._click(e));
    store.subscribe(() => this.update());
    this.update();
  }

  open() {
    this.panel.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    this.update();
  }

  close() {
    this.panel.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
  }

  update() {
    const needs = this.store.needsBackup();
    this.button.querySelector(".dot")?.toggleAttribute("hidden", !needs);
    this.button.setAttribute("aria-label", needs ? "Settings. Back up your map." : "Settings");
    if (this.panel.hidden) return;
    const s = this.store.state;
    const last = s.meta.lastBackup;
    const points = this.store.snapshots().length;
    this.panel.innerHTML = `
      <div class="mono">Settings</div>
      <div class="prefs">${PREFS.map(([key, label, opts]) => `
        <div class="seg" role="group" aria-label="${label}"><span class="mono">${label}</span>${opts.map(([v, l]) =>
          `<button type="button" data-pref="${key}" data-val="${v}" aria-pressed="${s.prefs[key] === v}">${l}</button>`).join("")}</div>`).join("")}
      </div>
      <div class="setsec">
        <span class="mono">Backup</span>
        <div class="backupstate${needs ? " warn" : ""}"><span>Last backup: <b>${formatWhen(last)}</b>.${needs ? " Your map only lives on this device, so save a copy somewhere safe." : ""}</span></div>
        <div class="row">
          <button class="btn primary" type="button" data-backup>Save backup</button>
          <button class="btn" type="button" data-restore>Restore</button>
        </div>
        <button class="linkrow" type="button" data-points>Restore points <span class="hint">${points ? `${points} saved` : "None yet"}</span></button>
      </div>
      <div class="setsec">
        ${this.phone ? `<span class="mono">Levels</span><div class="legend">${legendHtml()}</div>` : ""}
        ${this.openIngredients ? `<button class="linkrow" type="button" data-ings>Ingredients and colors</button>` : ""}
        <p class="savestate${this.store.saveError ? " error" : ""}">${this.store.saveError ? "Couldn't save on this device. Storage may be full or turned off. Save a backup now." : "Saves automatically on this device."}</p>
      </div>`;
  }

  _click(e) {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.pref) {
      this.store.setPref(t.dataset.pref, t.dataset.val);
    } else if (t.hasAttribute("data-backup")) {
      this.saveBackup();
    } else if (t.hasAttribute("data-restore")) {
      this.file.value = "";
      this.file.click();
    } else if (t.hasAttribute("data-points")) {
      this.close();
      this.showPoints();
    } else if (t.hasAttribute("data-ings")) {
      this.close();
      this.openIngredients?.();
    }
  }

  /* ----- backup ----- */

  async saveBackup() {
    const { filename, text } = this.store.exportBackup();
    const file = typeof File === "function" ? new File([text], filename, { type: "application/json" }) : null;
    if (this.phone && file && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Trick Map backup" });
        this.store.markBackedUp();
        this.toast("Backup saved. Keep it in Files, Notes or anywhere off this phone.");
        return;
      } catch (err) {
        if (err?.name === "AbortError") return;
      }
    }
    const blob = file || new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    this.store.markBackedUp();
    this.toast(`Backup downloaded: <b>${esc(filename)}</b>`);
  }

  async _readFile() {
    const f = this.file.files?.[0];
    if (!f) return;
    this.close();
    let text = "";
    try {
      text = await f.text();
    } catch {
      this.toast("That file couldn't be opened. Try saving it to Files first.");
      return;
    }
    const parsed = parseBackup(text);
    if (!parsed.ok) {
      this._dialog(`<div class="shead"><h2>Can't restore that file</h2></div><p class="hint error">${esc(parsed.error)}</p>
        <div class="row"><button class="btn" type="button" data-cancel>OK</button></div>`);
      return;
    }
    this._confirmRestore({
      title: "Restore this backup?",
      when: parsed.exportedAt ? `Saved ${formatWhen(parsed.exportedAt)}` : "",
      summary: parsed.summary,
      apply: () => this.store.replaceState(parsed.state, "Before restoring a backup"),
    });
  }

  _confirmRestore({ title, when, summary, apply }) {
    this._dialog(`
      <div class="shead"><div><div class="mono">${esc(when)}</div><h2>${esc(title)}</h2></div><button class="x" type="button" data-cancel aria-label="Close">×</button></div>
      ${summaryHtml(summary)}
      <p class="hint">This replaces the map on this device. Your current map is saved as a restore point first, so you can switch back.</p>
      <div class="row"><button class="btn primary" type="button" data-apply>Replace my map</button><button class="btn" type="button" data-cancel>Cancel</button></div>`,
    { apply: () => { apply(); this.dialog.close(); this.toast("Map restored."); } });
  }

  showPoints() {
    const list = this.store.snapshots();
    const rows = list.map((p) => {
      let sum = null;
      try { sum = summarize(JSON.parse(p.data)); } catch { /* skip */ }
      return `<div class="point"><div><b>${esc(formatWhen(p.t))}</b><span>${esc(p.reason)}${sum ? ` · ${sum.landed} landed · ${sum.placed} placed` : ""}</span></div>
        <button class="btn small" type="button" data-point="${esc(p.id)}">Restore</button></div>`;
    }).join("");
    this._dialog(`
      <div class="shead"><div><div class="mono">On this device</div><h2>Restore points</h2></div><button class="x" type="button" data-cancel aria-label="Close">×</button></div>
      <p class="hint">Trick Map saves a copy of your map once a day and before every restore. These stay on this device, so also save a backup file now and then.</p>
      <div class="points">${rows || `<p class="hint">No restore points yet. One is saved automatically each day you open the app.</p>`}</div>`,
    {
      point: (id) => {
        const p = list.find((x) => x.id === id);
        if (!p) return;
        let state = null;
        try { state = JSON.parse(p.data); } catch { /* skip */ }
        if (!state) return;
        this._confirmRestore({
          title: "Go back to this version?",
          when: formatWhen(p.t),
          summary: summarize(state),
          apply: () => this.store.restoreSnapshot(id),
        });
      },
    });
  }

  _dialog(html, handlers = {}) {
    const body = this.dialog.body;
    body.innerHTML = `<div class="sin">${html}</div>`;
    body.onclick = (e) => {
      const t = e.target.closest("button");
      if (!t) return;
      if (t.hasAttribute("data-cancel")) this.dialog.close();
      else if (t.hasAttribute("data-apply")) handlers.apply?.();
      else if (t.dataset.point) handlers.point?.(t.dataset.point);
    };
    this.dialog.open();
  }
}
