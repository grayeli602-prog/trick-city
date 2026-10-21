# Trick Map

Map your flatground skate tricks. Every trick is an ollie plus ingredients (flips, shoves, 180s, body varials as add-ons), split into Sun, Earth and Moon sides.

- **Map:** drag orbs, hover (PC) or hold (phone) to set a level, tap to open the breakdown and foot positions. On a phone, two fingers pan and zoom.
- **Stance grid:** regular, fakie, switch and nollie for every trick.
- **Levels:** Not yet, Want it (3 max), Landed, Locked in.
- **Saves on your device.** No account. Settings → Save backup makes a file you can restore from, and the app keeps a daily restore point.

## Install on your phone
Open the site in Safari, tap Share, then Add to Home Screen.

## Test versions
Settings → Try test versions opens `/lab/`: five takes on the app (Native, Pro tool, Progress, Spatial, Studio). Each one works on its own copy of your map, so nothing there changes your real map. Tap the heart on features you want to keep, then copy your picks from the lab page.

## How it's built
A static site with no build step: plain ES modules, deployed on Vercel straight from this repo.

```
index.html            app shell
css/base.css          colors, type, shared controls
css/components.css    map, grid, sheet, breakdown, feet editor
css/app.css           main app layout (PC page, phone full screen)
js/core/catalog.js    ingredients, sides, stances, trick names
js/core/store.js      saved state, migrations, undo, restore points, backups
js/core/model.js      map layout: bands, columns, connections
js/core/draw.js       SVG helpers: orbs, subway lines, labels
js/app/*.js           map view, stance grid, level picker, breakdown, settings
lab/                  the five test versions and the lab page
sw.js                 offline support (network first, cache fallback)
tests/                node tests
```

Saved data lives in `localStorage` under `trickmap` (schema 2). The first open after an update keeps an untouched copy of the old save in `trickmap.before-v2` and a restore point.

## Run it locally
```
python3 -m http.server 8000
```
Then open http://localhost:8000. ES modules need a server; opening the file directly won't work.

## Tests
```
node --test tests/core.test.js tests/sw.test.js
```
