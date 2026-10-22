// Friends: your map syncs to a private online copy whenever it changes,
// friends add each other by code or invite link, and a friend's map opens
// view-only (map or grid) with their level next to yours on every trick.

import { createStore, shareable } from "../core/store.js";
import { SIDES, STANCES, STANCE_LABEL, STANCE_SHORT, LEVELS, parentKeys } from "../core/catalog.js";
import { esc, dotSvg, orbSvg, tone } from "../core/draw.js";
import { MapView } from "./mapview.js";
import { GridView } from "./grid.js";
import { Sheet } from "./sheet.js";

const API = "api/friends";
const CACHE_KEY = "trickmap.friends";
const SYNC_KEY = "trickmap.friends.sync";
const SYNC_DELAY = 4000;
const POLL_MS = 30000;
const MAX_CACHE = 1_500_000; // characters; above this the cache keeps names and counts only
const CODE_RE = /^[2-9A-HJ-NP-Z]{8}$/;

export const cleanCode = (s) => String(s || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
export const prettyCode = (c) => (c && c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c || "");

/** A friend code from whatever was typed or pasted: the code, a link, or the whole invite text. */
export function extractCode(text) {
  const s = String(text || "").toUpperCase();
  const link = s.match(/FRIEND=([0-9A-Z]{8})/);
  if (link) return link[1];
  const code = s.match(/(?:^|[^0-9A-Z])([2-9A-HJ-NP-Z]{4})[-\s]?([2-9A-HJ-NP-Z]{4})(?![0-9A-Z])/);
  return code ? code[1] + code[2] : cleanCode(s);
}

export function ago(t) {
  if (!t) return "never";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
}

function hashOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function readJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function writeText(key, text) {
  try {
    localStorage.setItem(key, text);
  } catch {
    try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
  }
}
function removeKeys(...keys) {
  try { for (const k of keys) localStorage.removeItem(k); } catch { /* storage unavailable */ }
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;

const MESSAGES = {
  offline: "You're offline. Try again when you're back online.",
  "not-configured": "Friends isn't set up on this site yet.",
  "no-such-code": "No one has that code. Check it and try again.",
  "too-many": "That's the friend limit (100).",
  "thats-you": "That's your own code.",
  "slow-down": "Too many tries. Wait a bit and try again.",
  "bad-key": "This device's friends key isn't working. Turn friends off and on again.",
};
const say = (err, fallback) => MESSAGES[err?.code] || fallback;

/** A friend as the app keeps them: their map plus counts and their latest progress for the list. */
function prep(f) {
  if (!f || typeof f !== "object" || !CODE_RE.test(f.code)) return null;
  const snapshot = f.snapshot && typeof f.snapshot === "object" ? f.snapshot : null;
  let stats = f.stats || { landed: 0, locked: 0 };
  let latest = f.latest || null;
  if (snapshot) {
    const s = createStore({ key: null, readOnly: true, initial: snapshot });
    const levels = Object.values(s.state.levels);
    stats = { landed: levels.filter((v) => v >= 2).length, locked: levels.filter((v) => v === 3).length };
    const h = [...s.state.history].reverse().find((x) => x.to > x.from && x.to >= 2);
    latest = h ? { name: s.name(h.k, h.st), level: h.to, t: h.t } : null;
  }
  return {
    code: f.code,
    name: typeof f.name === "string" ? f.name : "",
    handle: typeof f.handle === "string" ? f.handle : "",
    updatedAt: Number(f.updatedAt) || 0,
    stats,
    latest,
    snapshot,
  };
}

/* ---------- talking to the server ---------- */

export class FriendsClient {
  constructor(store) {
    this.store = store;
    const cached = readJSON(CACHE_KEY, []);
    this.friends = Array.isArray(cached) ? cached.map(prep).filter(Boolean) : [];
    this.sync = readJSON(SYNC_KEY, { hash: "", at: 0 });
    this.listeners = new Set();
    this.pending = false;
    this.problem = null; // "not-configured" | "offline" | "bad-key" | null
    this._timer = null;
    this._refreshedAt = 0;
    store.subscribe((info) => {
      if (info.source === "account" || info.source === "restore" || info.source === "other-tab") this.emit();
      if (this.account && !["account", "save-status", "backup"].includes(info.source)) this.scheduleSync();
    });
    window.addEventListener("online", () => { if (this.pending) this.syncNow(); });
    document.addEventListener("visibilitychange", () => {
      if (!this.account) return;
      if (document.visibilityState === "hidden") {
        if (this._timer) this.syncNow();
      } else if (Date.now() - this._refreshedAt > POLL_MS) this.refresh().catch(() => {});
    });
  }

  get account() { return this.store.state.account; }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }

  /** On app start: send changes made while offline and get the latest from friends. */
  start() {
    if (!this.account) return;
    this.syncNow();
    this.refresh().catch(() => {});
  }

  async api(action, body = {}, { keepalive = false } = {}) {
    const text = JSON.stringify({ action, ...body });
    let res;
    try {
      res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
        keepalive: keepalive && text.length < 60000,
      });
    } catch {
      throw Object.assign(new Error("offline"), { code: "offline" });
    }
    let data = {};
    try { data = await res.json(); } catch { /* not JSON: no server behind this path */ }
    if (!res.ok) {
      const code = data.error || ([404, 405, 501].includes(res.status) ? "not-configured" : `http-${res.status}`);
      throw Object.assign(new Error(code), { code, status: res.status });
    }
    return data;
  }

  /** api() that also tracks whether friends works right now (shown in the sheet). */
  async call(action, body, opts) {
    try {
      const data = await this.api(action, body, opts);
      if (this.problem) {
        this.problem = null;
        this.emit();
      }
      return data;
    } catch (err) {
      if (["not-configured", "offline", "bad-key"].includes(err.code) && this.problem !== err.code) {
        this.problem = err.code;
        this.emit();
      }
      throw err;
    }
  }

  _auth() {
    const a = this.account;
    return { code: a.code, key: a.key };
  }

  _save() {
    let text = JSON.stringify(this.friends);
    if (text.length > MAX_CACHE) text = JSON.stringify(this.friends.map((f) => ({ ...f, snapshot: null })));
    writeText(CACHE_KEY, text);
  }

  async turnOn() {
    const p = this.store.state.profile;
    const { code, key } = await this.call("join", { name: p.name, handle: p.handle });
    this.store.setAccount({ code, key });
    await this.syncNow({ force: true });
    this.refresh().catch(() => {});
  }

  scheduleSync() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.syncNow(), SYNC_DELAY);
  }

  async syncNow({ force = false } = {}) {
    clearTimeout(this._timer);
    this._timer = null;
    if (!this.account) return false;
    const s = this.store.state;
    const snapshot = shareable(s);
    const hash = hashOf(JSON.stringify({ ...snapshot, updatedAt: 0 }));
    if (!force && hash === this.sync.hash) return true;
    try {
      await this.call("sync", { ...this._auth(), name: s.profile.name, handle: s.profile.handle, snapshot }, { keepalive: document.visibilityState === "hidden" });
      this.sync = { hash, at: Date.now() };
      writeText(SYNC_KEY, JSON.stringify(this.sync));
      this.pending = false;
      this.emit();
      return true;
    } catch {
      this.pending = true;
      this.emit();
      return false;
    }
  }

  async refresh() {
    if (!this.account) return;
    const { friends } = await this.call("list", this._auth());
    this.friends = (Array.isArray(friends) ? friends : []).map(prep).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt);
    this._refreshedAt = Date.now();
    this._save();
    this.emit();
  }

  peek(code) {
    return this.api("peek", { friend: code });
  }

  async add(code) {
    const { friend } = await this.call("add", { ...this._auth(), friend: code });
    const f = prep(friend);
    if (f) {
      this.friends = [f, ...this.friends.filter((x) => x.code !== f.code)];
      this._save();
      this.emit();
    }
    this.refresh().catch(() => {});
    return f;
  }

  async remove(code) {
    await this.call("remove", { ...this._auth(), friend: code });
    this.friends = this.friends.filter((f) => f.code !== code);
    this._save();
    this.emit();
  }

  /** Delete the online copy, leave every friend list, and forget the key on this device. */
  async turnOff() {
    try {
      await this.call("leave", this._auth());
    } catch (err) {
      // A key the server no longer knows has nothing to delete; just forget it here.
      if (err.code !== "bad-key" && err.code !== "not-configured") throw err;
    }
    clearTimeout(this._timer);
    this._timer = null;
    this.friends = [];
    this.sync = { hash: "", at: 0 };
    this.pending = false;
    this.problem = null;
    removeKeys(CACHE_KEY, SYNC_KEY);
    this.store.setAccount(null);
  }

  inviteLink() {
    const url = new URL("./", location.href);
    url.searchParams.set("friend", this.account.code);
    return url.href;
  }
}

/* ---------- a friend's map, view only ---------- */

const ICON_BACK = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const firstName = (f) => (f?.name || "Friend").trim().split(/\s+/)[0];

export class FriendView {
  constructor(me, client, { phone = false, onClose = null } = {}) {
    this.me = me;
    this.client = client;
    this.onClose = onClose;
    this.stance = "regular";
    this.view = "map";
    this.sel = null;
    this.friend = null;
    this.el = document.createElement("section");
    this.el.className = "fv";
    this.el.hidden = true;
    this.el.setAttribute("aria-label", "Friend's map");
    this.el.innerHTML = `
      <header class="fv-bar">
        <button class="px-ib" type="button" data-back aria-label="Back to friends">${ICON_BACK}</button>
        <div class="fv-who"><b data-name></b><span data-sub></span></div>
        <div class="seg fv-views" data-views role="group" aria-label="View"></div>
      </header>
      <div class="fv-chips" data-chips></div>
      <div class="fv-stage">
        <div class="fv-map" data-map></div>
        <div class="fv-grid" data-grid hidden></div>
        <div class="fv-card" data-card hidden></div>
      </div>`;
    document.body.append(this.el);
    this.$ = (s) => this.el.querySelector(s);
    this.store = createStore({ key: null, readOnly: true, initial: {} });
    this.map = new MapView(this.$("[data-map]"), this.store, {
      projection: phone ? "fit" : "contain",
      minZoom: phone ? 1 : 0.6,
      maxZoom: 5,
      orbDrag: false,
      emptyDrag: "pan", // nothing to drag here, so any drag moves the map
      doubleTapEmpty: phone ? "reset" : null,
      decorate: (n) => {
        const on = n.k === this.sel;
        return { ring: false, strong: on, extra: on ? `<circle class="px-selring" r="13.5"/>` : "" };
      },
      onTap: (key) => this.showTrick(key),
      onTapEmpty: () => this.showTrick(null),
    });
    this.grid = new GridView(this.$("[data-grid]"), this.store, {
      onOpen: (key) => this.showTrick(key),
      onCell: (key, st) => this.showTrick(key, st),
    });
    this.el.addEventListener("click", (e) => this._click(e));
    // Newer data for the friend on screen (the list refreshes while this is open).
    client.subscribe(() => {
      if (!this.isOpen) return;
      const f = client.friends.find((x) => x.code === this.friend.code);
      if (f && f.snapshot && f.updatedAt !== this.friend.updatedAt) {
        this._load(f);
        this.render();
        if (this.sel !== null) this.showTrick(this.sel);
      }
    });
    // Your levels are in the trick card, and your Colors setting applies here too.
    me.subscribe(() => {
      if (!this.isOpen) return;
      this.store.state.prefs.palette = me.pref("palette");
      this.render();
      if (this.sel !== null) this.showTrick(this.sel);
    });
    // The back gesture closes this instead of leaving the app.
    window.addEventListener("popstate", () => {
      if (this.isOpen && !history.state?.fv) this.close({ fromHistory: true });
    });
  }

  get isOpen() { return !this.el.hidden; }

  _load(friend) {
    this.friend = friend;
    this.store = createStore({ key: null, readOnly: true, initial: friend.snapshot || {} });
    this.store.state.prefs.palette = this.me.pref("palette");
    this.map.store = this.store;
    this.grid.store = this.store;
  }

  open(friend) {
    this._load(friend);
    this.sel = null;
    this.stance = "regular";
    this.map.o.stance = "regular";
    this.$("[data-card]").hidden = true;
    this.el.hidden = false;
    this.map.resetCamera(false);
    this.render();
    clearInterval(this._poll);
    this._poll = setInterval(() => {
      if (document.visibilityState === "visible") this.client.refresh().catch(() => {});
    }, POLL_MS);
    try {
      if (!history.state?.fv) history.pushState({ fv: 1 }, "");
    } catch { /* history unavailable */ }
  }

  close({ fromHistory = false } = {}) {
    if (!this.isOpen) return;
    this.el.hidden = true;
    clearInterval(this._poll);
    this.friend = null;
    this.sel = null;
    if (!fromHistory && history.state?.fv) history.back();
    this.onClose?.();
  }

  render() {
    const f = this.friend;
    if (!f) return;
    const handle = f.handle ? `@${f.handle.replace(/^@/, "")}` : "";
    this.$("[data-name]").textContent = f.name || "Friend";
    this.$("[data-sub]").textContent = [handle, `${f.stats.landed} landed`, `updated ${ago(f.updatedAt)}`].filter(Boolean).join(" · ");
    this.$("[data-views]").innerHTML = [["map", "Map"], ["grid", "Grid"]].map(([v, l]) => `<button type="button" data-view="${v}" aria-pressed="${this.view === v}">${l}</button>`).join("");
    this.$("[data-chips]").innerHTML = `${this.view === "map"
      ? STANCES.map((st) => `<button class="px-fchip" type="button" data-stance="${st}" aria-pressed="${this.stance === st}">${STANCE_LABEL[st]}</button>`).join("")
      : `<span class="hint">Every stance side by side. Tap one to compare.</span>`}<span class="fv-ro mono">View only</span>`;
    this.$("[data-map]").hidden = this.view !== "map";
    this.$("[data-grid]").hidden = this.view !== "grid";
    if (this.view === "map") this.map.render();
    else this.grid.render();
  }

  /** The trick card: their level next to yours, for every stance. */
  showTrick(key, stance = null) {
    const card = this.$("[data-card]");
    const had = this.sel;
    this.sel = key;
    if (this.view === "map" && had !== key) this.map.render();
    if (key === null) {
      card.hidden = true;
      return;
    }
    const them = this.store;
    const palette = them.pref("palette");
    const focus = stance || this.stance;
    const from = parentKeys(key).filter((p) => !them.isAddonOnly(p)).map((p) => (p === "" ? "Ollie" : them.name(p)));
    card.hidden = false;
    card.innerHTML = `
      <div class="fv-card-top">
        <svg width="30" height="30" viewBox="-15 -15 30 30" aria-hidden="true">${orbSvg(them.level(key, focus), tone(them.color(key), palette), palette)}</svg>
        <div class="t"><b>${esc(them.name(key, focus))}</b><span>${SIDES[them.side(key)]}${from.length ? ` · from ${esc(from.join(" + "))}` : ""}</span></div>
        <button class="x" type="button" data-close aria-label="Close">×</button>
      </div>
      <div class="fv-cmp" role="table" aria-label="Levels compared">
        <span></span><b>${esc(firstName(this.friend))}</b><b>You</b>
        ${STANCES.map((st) => {
          const a = them.level(key, st);
          const b = this.me.level(key, st);
          return `<span class="st${st === focus ? " cur" : ""}">${STANCE_SHORT[st]}</span>
            <span class="lv${a > b ? " ahead" : ""}">${dotSvg(a, 16)}${LEVELS[a]}</span>
            <span class="lv${b > a ? " ahead" : ""}">${dotSvg(b, 16)}${LEVELS[b]}</span>`;
        }).join("")}
      </div>`;
  }

  _click(e) {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.hasAttribute("data-back")) this.close();
    else if (t.hasAttribute("data-close")) this.showTrick(null);
    else if (t.dataset.view) {
      this.view = t.dataset.view;
      this.showTrick(null);
      this.render();
    } else if (t.dataset.stance) {
      this.stance = t.dataset.stance;
      this.map.o.stance = this.stance;
      this.render();
      if (this.sel !== null) this.showTrick(this.sel);
    }
  }
}

/* ---------- the Friends sheet ---------- */

const initials = (name) => (name || "").trim().split(/\s+/).filter(Boolean).map((w) => [...w][0]).join("").slice(0, 2).toUpperCase() || "?";

export class FriendsSheet {
  constructor(client, view, { toast = () => {}, phone = false } = {}) {
    this.client = client;
    this.view = view;
    this.toast = toast;
    this.phone = phone;
    this.invite = null; // { code, name, missing } from an invite link
    this.busy = false;
    this.sheet = new Sheet({ className: "friendsheet", label: "Friends" });
    this.el = document.createElement("div");
    this.el.className = "sin friends";
    this.sheet.body.append(this.el);
    this.el.addEventListener("click", (e) => this._click(e));
    this.el.addEventListener("input", (e) => {
      if (e.target.matches("[data-myname]")) client.store.setProfile({ name: e.target.value }, { source: "profile" });
    });
    this.el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.matches("[data-code]")) this._addTyped();
      if (e.key === "Enter" && e.target.matches("[data-myname]")) e.target.blur();
    });
    client.subscribe(() => { if (this.sheet.isOpen) this.render(); });
  }

  open() {
    this.render();
    this.sheet.open();
    this.sheet.el.scrollTop = 0;
    if (this.client.account) this.client.refresh().catch(() => {});
  }

  /** At startup, from an invite link (?friend=CODE). */
  async takeInvite(raw) {
    const code = extractCode(raw);
    if (!CODE_RE.test(code)) return;
    const c = this.client;
    if (code === c.account?.code) {
      this.open();
      return;
    }
    const known = c.friends.find((f) => f.code === code);
    if (known) {
      this.open();
      this.toast(`You and <b>${esc(known.name || "them")}</b> are already friends.`);
      return;
    }
    this.invite = { code, name: "", missing: false };
    this.open();
    try {
      const p = await c.peek(code);
      this.invite.name = p.name || "";
    } catch (err) {
      if (err.code === "no-such-code") this.invite.missing = true;
    }
    this.render();
  }

  render() {
    const c = this.client;
    const a = c.account;
    const me = c.store.state.profile;
    const inv = this.invite;
    const invOk = inv && !inv.missing && inv.code !== a?.code && !c.friends.some((f) => f.code === inv.code);
    const who = inv?.name ? esc(inv.name) : "A friend";
    const nameField = `<label class="fr-field"><span class="mono">Your name</span><input data-myname value="${esc(me.name)}" placeholder="What friends see" autocomplete="off" maxlength="40" enterkeyhint="done"></label>`;
    let body;
    if (!a) {
      const iosSafari = invOk && isIOS() && !standalone();
      body = `
        ${invOk ? `<div class="fr-invite"><div><b>${who} invited you</b><span>Code ${prettyCode(inv.code)}</span></div></div>` : ""}
        ${inv?.missing ? `<p class="hint error">That invite code doesn't exist anymore. Ask for a new one.</p>` : ""}
        <p>See each other's maps and compare tricks. Anyone you give your code to can add you. Your map syncs to a private online copy whenever you change it.</p>
        ${c.problem === "not-configured" ? `<p class="hint error">Friends isn't set up on this site yet. It needs a free database connected to the site in Vercel.</p>` : ""}
        ${iosSafari ? `<div class="fr-steps"><b>Using the Home Screen app?</b>
            <span>Safari and the Home Screen app keep separate maps. Open Trick Map from your Home Screen (or add it: Share, then Add to Home Screen), go to Friends and add code <b>${prettyCode(inv.code)}</b>.</span>
            <div class="row"><button class="btn" type="button" data-copycode="${inv.code}">Copy code</button></div></div>` : ""}
        ${nameField}
        <div class="row"><button class="btn primary" type="button" data-on ${this.busy ? "disabled" : ""}>${this.busy ? "Turning on…" : invOk ? `Turn on friends and add ${who}` : "Turn on friends"}</button></div>`;
    } else {
      const list = c.friends;
      const status = c.problem === "offline" ? "Offline. Your map syncs when you're back online."
        : c.problem === "bad-key" ? MESSAGES["bad-key"]
        : c.problem === "not-configured" ? "Friends isn't reachable on this site right now."
        : c.pending ? "Waiting to sync your latest changes."
        : `Your map synced ${ago(c.sync.at)}.`;
      body = `
        ${invOk ? `<div class="fr-invite"><div><b>${who} invited you</b><span>Code ${prettyCode(inv.code)}</span></div><button class="btn primary small" type="button" data-addinvite>Add</button></div>` : ""}
        <div class="fr-me">
          <div><span class="mono">Your code</span><button class="fr-code" type="button" data-copycode="${a.code}" title="Copy code">${prettyCode(a.code)}</button></div>
          <button class="btn primary" type="button" data-share>${this.phone ? "Invite friends" : "Copy invite"}</button>
        </div>
        <div class="fr-add"><input data-code placeholder="Friend's code" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" aria-label="Friend's code"><button class="btn" type="button" data-add>Add</button></div>
        <div class="fr-list">${list.length ? list.map((f) => `
          <div class="fr-row">
            <button class="fr-open" type="button" data-open="${f.code}">
              <span class="fr-av" aria-hidden="true">${esc(initials(f.name))}</span>
              <span class="fr-txt"><b>${esc(f.name || "Friend")}</b>
                <span>${f.stats.landed} landed · ${f.stats.locked} locked in</span>
                ${f.latest ? `<span>${esc(f.latest.name)} ${LEVELS[f.latest.level].toLowerCase()} · ${ago(f.latest.t)}</span>` : ""}</span>
              <span class="fr-go" aria-hidden="true">›</span>
            </button>
            <button class="fr-x" type="button" data-remove="${f.code}" aria-label="Remove ${esc(f.name || "friend")}">×</button>
          </div>`).join("") : `<p class="hint">No friends yet. Send your invite, or add their code.</p>`}</div>
        <div class="fr-foot">
          ${nameField}
          <p class="hint${c.problem === "bad-key" ? " error" : ""}">${status}</p>
          <button class="btn danger small" type="button" data-off>Turn off friends</button>
        </div>`;
    }
    // Keep typing where it was if this re-renders while an input has focus.
    const focused = document.activeElement;
    const typing = focused && this.el.contains(focused) && focused.matches("input")
      ? { sel: focused.matches("[data-code]") ? "[data-code]" : "[data-myname]", value: focused.value, pos: focused.selectionStart }
      : null;
    const codeValue = this.el.querySelector("[data-code]")?.value || "";
    this.el.innerHTML = `<div class="shead"><div><div class="mono">Friends</div><h2>${a ? `Friends${c.friends.length ? ` · ${c.friends.length}` : ""}` : "Skate with friends"}</h2></div><button class="x" type="button" data-close aria-label="Close">×</button></div>${body}`;
    const codeInput = this.el.querySelector("[data-code]");
    if (codeInput) codeInput.value = codeValue;
    if (typing) {
      const input = this.el.querySelector(typing.sel);
      if (input) {
        input.value = typing.value;
        input.focus();
        try { input.setSelectionRange(typing.pos, typing.pos); } catch { /* not a text input */ }
      }
    }
  }

  async _addTyped() {
    const input = this.el.querySelector("[data-code]");
    const code = extractCode(input?.value);
    if (!CODE_RE.test(code)) {
      this.toast("Codes are 8 letters and numbers, like K7Q2-M9XA.");
      return;
    }
    await this._add(code);
  }

  async _add(code) {
    const c = this.client;
    if (code === c.account?.code) {
      this.toast(MESSAGES["thats-you"]);
      return;
    }
    const known = c.friends.find((f) => f.code === code);
    if (known) {
      this.toast(`You and <b>${esc(known.name || "them")}</b> are already friends.`);
      this.invite = null;
      this.render();
      return;
    }
    try {
      const f = await c.add(code);
      this.invite = null;
      const input = this.el.querySelector("[data-code]");
      if (input) input.value = "";
      this.toast(`You and <b>${esc(f?.name || "your friend")}</b> are friends now.`);
    } catch (err) {
      this.toast(say(err, "Couldn't add them. Try again."));
    }
    this.render();
  }

  async _click(e) {
    const t = e.target.closest("button");
    if (!t) return;
    const c = this.client;
    if (t.hasAttribute("data-close")) this.sheet.close();
    else if (t.hasAttribute("data-on")) {
      const nameInput = this.el.querySelector("[data-myname]");
      if (!nameInput?.value.trim()) {
        this.toast("Add your name first so friends know it's you.");
        nameInput?.focus();
        return;
      }
      this.busy = true;
      this.render();
      try {
        await c.turnOn();
        this.busy = false;
        const inv = this.invite;
        if (inv && !inv.missing) await this._add(inv.code);
        else this.toast("Friends is on. Send your invite.");
      } catch (err) {
        this.toast(say(err, "Couldn't turn on friends. Try again."));
      }
      this.busy = false;
      this.render();
    } else if (t.hasAttribute("data-addinvite")) this._add(this.invite.code);
    else if (t.hasAttribute("data-add")) this._addTyped();
    else if (t.dataset.copycode) {
      const code = prettyCode(t.dataset.copycode);
      try {
        await navigator.clipboard.writeText(code);
        this.toast(`Code <b>${code}</b> copied.`);
      } catch {
        this.toast(`Code: <b>${code}</b>`);
      }
    } else if (t.hasAttribute("data-share")) this.shareInvite();
    else if (t.dataset.open) {
      const f = c.friends.find((x) => x.code === t.dataset.open);
      if (!f) return;
      if (!f.snapshot) {
        this.toast(`${esc(firstName(f))}'s map isn't loaded yet. Try again in a moment.`);
        c.refresh().catch(() => {});
        return;
      }
      this.sheet.close({ silent: true });
      this.view.open(f);
    } else if (t.dataset.remove) {
      const f = c.friends.find((x) => x.code === t.dataset.remove);
      if (!confirm(`Remove ${f?.name || "this friend"}? You'll stop seeing each other's maps.`)) return;
      try {
        await c.remove(t.dataset.remove);
      } catch (err) {
        this.toast(say(err, "Couldn't remove them. Try again."));
      }
    } else if (t.hasAttribute("data-off")) {
      if (!confirm("Turn off friends? Your online copy is deleted and you leave your friends' lists. Your map stays on this device.")) return;
      try {
        await c.turnOff();
        this.toast("Friends is off.");
      } catch (err) {
        this.toast(say(err, "Couldn't reach the server. Try again."));
      }
      this.render();
    }
  }

  /** Phone: the share sheet. PC: copy the invite. */
  async shareInvite() {
    const c = this.client;
    if (!c.account) {
      this.open();
      return;
    }
    const link = c.inviteLink();
    const text = `Add me on Trick Map. My code is ${prettyCode(c.account.code)}`;
    if (this.phone && navigator.share) {
      try {
        await navigator.share({ title: "Trick Map", text, url: link });
        return;
      } catch (err) {
        if (err?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${link}`);
      this.toast("Invite copied. Send it to your friends.");
    } catch {
      window.prompt("Copy this and send it:", `${text}\n${link}`);
    }
  }
}
