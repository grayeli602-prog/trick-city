// Every file the service worker precaches must exist, or it won't install.
// Run with: node --test tests/core.test.js tests/sw.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sw = readFileSync(join(root, "sw.js"), "utf8");
const list = JSON.parse(sw.match(/const APP = (\[[\s\S]*?\]);/)[1].replace(/,\s*\]/, "]"));

test("precached files exist", () => {
  for (const file of list) {
    if (file === "./") continue;
    assert.ok(existsSync(join(root, file)), `missing ${file}`);
  }
});

test("every app module is precached", () => {
  for (const dir of ["js/core", "js/app"]) {
    for (const f of readdirSync(join(root, dir))) {
      if (f.endsWith(".js")) assert.ok(list.includes(`${dir}/${f}`), `${dir}/${f} is not in the service worker list`);
    }
  }
  for (const f of readdirSync(join(root, "css"))) assert.ok(list.includes(`css/${f}`), `css/${f} is not in the service worker list`);
});

test("every module import points at a real file", () => {
  const files = [
    ...readdirSync(join(root, "js/core")).map((f) => `js/core/${f}`),
    ...readdirSync(join(root, "js/app")).map((f) => `js/app/${f}`),
    ...readdirSync(join(root, "lab")).filter((f) => f.endsWith(".js")).map((f) => `lab/${f}`),
  ];
  for (const file of files) {
    const src = readFileSync(join(root, file), "utf8");
    for (const m of src.matchAll(/from "(\.[^"]+)"/g)) {
      assert.ok(existsSync(join(root, dirname(file), m[1])), `${file} imports missing ${m[1]}`);
    }
  }
});
