// Trick catalog: ingredients, sides, stances and levels, plus the rules for
// turning a trick's recipe into a key and a name. Pure data and functions.
//
// A trick is an ollie plus ingredients. Its recipe is { ingredientId: count }
// (count 1 or 2) and its key is the sorted recipe, e.g. "bs:1,kf:1" for a
// varial kickflip. The ollie is the empty key "".

export const SIDES = Object.freeze({ sun: "Sun", earth: "Earth", moon: "Moon" });
export const SIDE_ORDER = Object.freeze(["sun", "earth", "moon"]);
export const STANCES = Object.freeze(["regular", "fakie", "switch", "nollie"]);
export const STANCE_LABEL = Object.freeze({ regular: "Regular", fakie: "Fakie", switch: "Switch", nollie: "Nollie" });
export const STANCE_SHORT = Object.freeze({ regular: "Reg", fakie: "Fakie", switch: "Switch", nollie: "Nollie" });
export const LEVELS = Object.freeze(["Not yet", "Want it", "Landed", "Locked in"]);
export const WANT_LIMIT = 3;
export const MAX_COUNT = 2;
export const BASE_COLOR = "#9a9a94";

export const DEFAULT_INGREDIENTS = Object.freeze([
  { id: "kf", name: "Kickflip", color: "#ff5a3c", side: "sun", builtin: true },
  { id: "bs", name: "Pop shove", color: "#3f78ff", side: "sun", builtin: true },
  { id: "fb", name: "FS 180", color: "#2fb35f", side: "sun", builtin: true },
  { id: "hf", name: "Heelflip", color: "#f2b01e", side: "moon", builtin: true },
  { id: "fs", name: "FS shove", color: "#17a8a0", side: "moon", builtin: true },
  { id: "bb", name: "BS 180", color: "#8c5cf0", side: "moon", builtin: true },
  { id: "bvb", name: "BS body varial", color: "#e2559b", side: "moon", builtin: true, addon: true },
  { id: "bvf", name: "FS body varial", color: "#8fbf2f", side: "sun", builtin: true, addon: true },
]);

export const DEFAULT_SIDE_COLORS = Object.freeze({ sun: "#ffcc4d", earth: "#6f9a7a", moon: "#1d2033" });

/* ---------- recipes and keys ---------- */

export function keyOf(recipe) {
  return Object.keys(recipe)
    .filter((id) => recipe[id] > 0)
    .sort()
    .map((id) => `${id}:${recipe[id]}`)
    .join(",");
}

export function parseKey(key) {
  const recipe = {};
  if (!key) return recipe;
  for (const part of key.split(",")) {
    const [id, n] = part.split(":");
    recipe[id] = Number(n);
  }
  return recipe;
}

export const sizeOf = (recipe) => Object.values(recipe).reduce((a, b) => a + b, 0);

/** Keys of the tricks this one is built from (one ingredient less). */
export function parentKeys(key) {
  const recipe = parseKey(key);
  return Object.keys(recipe).map((id) => {
    const parent = { ...recipe };
    parent[id] -= 1;
    return keyOf(parent);
  });
}

/** Key of the trick with one more (delta 1) or one less (delta -1) of an ingredient. */
export function stepKey(key, id, delta) {
  const recipe = parseKey(key);
  recipe[id] = Math.max(0, Math.min(MAX_COUNT, (recipe[id] || 0) + delta));
  return keyOf(recipe);
}

/** The ingredient that turns `parent` into `child`. */
export function addedIngredient(parent, child) {
  const p = parseKey(parent);
  const c = parseKey(child);
  return Object.keys(c).find((id) => (c[id] || 0) > (p[id] || 0)) || null;
}

/** Ingredient ids repeated by count, in the user's ingredient order. */
export function unitList(recipe, ingredients) {
  const order = (id) => {
    const i = ingredients.findIndex((x) => x.id === id);
    return i < 0 ? 99 : i;
  };
  const units = [];
  for (const id of Object.keys(recipe).sort((a, b) => order(a) - order(b))) {
    for (let i = 0; i < recipe[id]; i++) units.push(id);
  }
  return units;
}

/* ---------- the starting catalog (28 flatground tricks) ---------- */

const LEGACY_CATALOG = [
  "", "s:bs1", "s:fs1", "s:bs2", "s:fs2", "b:bs1", "b:fs1", "b:bs2", "b:fs2", "s:bs2|b:bs1", "s:fs2|b:fs1",
  "f:k1", "f:k2", "f:k1|s:bs1", "f:k1|s:fs1", "f:k1|s:bs2", "f:k1|s:fs2", "f:k1|b:bs1", "f:k1|b:fs1", "f:k1|s:bs2|b:bs1",
  "f:h1", "f:h2", "f:h1|s:fs1", "f:h1|s:bs1", "f:h1|s:fs2", "f:h1|s:bs2", "f:h1|b:bs1", "f:h1|b:fs1",
];
const LEGACY_IDS = { "s:bs": "bs", "s:fs": "fs", "f:k": "kf", "f:h": "hf", "b:bs": "bb", "b:fs": "fb" };

function legacyKey(old) {
  const recipe = {};
  if (old) {
    for (const part of old.split("|")) {
      const [group, value] = part.split(":");
      recipe[LEGACY_IDS[`${group}:${value.slice(0, -1)}`]] = Number(value.slice(-1));
    }
  }
  return keyOf(recipe);
}

export const CATALOG = Object.freeze(LEGACY_CATALOG.map(legacyKey));

/* ---------- names ---------- */

const CORE_IDS = new Set(["bs", "fs", "kf", "hf", "bb", "fb"]);
const FLIP_SHOVE = {
  kbs1: "varial kickflip", kfs1: "hardflip", kbs2: "360 flip", kfs2: "360 hardflip",
  hfs1: "varial heelflip", hbs1: "inward heelflip", hfs2: "laser flip", hbs2: "360 inward heelflip",
};

/** Real skate name for a recipe made of shoves, flips and 180s, or null. */
export function classicName(recipe, stance) {
  const shove = { d: null, n: 0 };
  const flip = { d: null, n: 0 };
  const body = { d: null, n: 0 };
  for (const id in recipe) {
    const n = recipe[id];
    if (id === "bs" || id === "fs") {
      if (shove.n) return null;
      shove.d = id; shove.n = n;
    } else if (id === "kf" || id === "hf") {
      if (flip.n) return null;
      flip.d = id[0]; flip.n = n;
    } else if (id === "bb" || id === "fb") {
      if (body.n) return null;
      body.d = id === "bb" ? "bs" : "fs"; body.n = n;
    } else {
      return null;
    }
  }

  let core = "";
  if (!flip.n) {
    if (shove.n) core = (shove.d === "fs" ? "FS " : "") + (shove.n === 2 ? "360 shove-it" : "pop shove-it");
  } else {
    const name = flip.d === "k" ? "kickflip" : "heelflip";
    const double = flip.n === 2 ? "double " : "";
    core = shove.n ? double + FLIP_SHOVE[flip.d + shove.d + shove.n] : double + name;
  }

  let spin = "";
  if (body.n) {
    spin = stance === "fakie" && body.d === "bs"
      ? (body.n === 1 ? "half-cab" : "full-cab")
      : `${body.d.toUpperCase()} ${body.n === 1 ? 180 : 360}`;
    if (shove.n === 2 && shove.d === body.d && body.n === 1 && !flip.n) {
      core = "";
      spin = (body.d === "fs" ? "FS " : "") + "bigspin";
    } else if (shove.n === 2 && shove.d === "bs" && body.d === "bs" && body.n === 1 && flip.d === "k" && flip.n === 1) {
      core = "";
      spin = "bigflip";
    } else if (body.n === 1 && !shove.n && flip.n === 1) {
      core = "";
      spin = stance === "fakie" && body.d === "bs"
        ? (flip.d === "k" ? "half-cab flip" : "half-cab heelflip")
        : `${body.d.toUpperCase()} ${flip.d === "k" ? "flip" : "heelflip"}`;
    }
  }
  return [spin, core].filter(Boolean).join(" ") || "ollie";
}

/** Name for any key in a stance, using the user's ingredient names for extras. */
export function autoName(key, stance, ingredients) {
  const recipe = parseKey(key);
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const base = {};
  const extras = [];
  for (const id in recipe) {
    if (CORE_IDS.has(id)) base[id] = recipe[id];
    else extras.push((recipe[id] === 2 ? "double " : "") + (byId.get(id)?.name || id));
  }
  let name = classicName(base, stance);
  if (name === null) name = unitList(base, ingredients).map((id) => byId.get(id)?.name || id).join(" + ");
  if (extras.length) name = extras.join(" ") + (name === "ollie" ? "" : ` ${name}`);
  const prefix = stance === "regular" || (stance === "fakie" && /cab/.test(name)) ? "" : `${stance} `;
  name = prefix + name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/* ---------- foot positions ---------- */

/**
 * Default shoe placement on the 360x160 deck drawing, for a regular rider
 * (nose on the left). Front foot angles toward the nose for flip tricks.
 */
export function defaultFeet(key, stance) {
  const recipe = parseKey(key);
  const flip = recipe.kf || recipe.hf;
  const nollie = stance === "nollie";
  const back = { x: nollie ? 318 : 48, y: 80, a: nollie ? -15 : 15 };
  const front = {
    x: nollie ? 150 : flip ? 205 : 215,
    y: flip ? (recipe.hf ? 72 : 96) : 80,
    a: flip ? (recipe.hf ? 20 : 45) : 10,
  };
  const mirror = (p) => ({ x: 360 - p.x, y: p.y, a: -p.a });
  return { b: mirror(back), f: mirror(front) };
}
