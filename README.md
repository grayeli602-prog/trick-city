# Trick Map

Map your flatground skate tricks. Every trick is an ollie plus ingredients (flips, shoves, 180s, body varials as add-ons), split into Sun, Earth and Moon sides.

- **Map:** drag orbs, hover (PC) or hold (phone) to set a level, tap to select. The inspector shows levels for every stance, exact position, side, and what it's built from.
- **Search:** Cmd/Ctrl K or `/` finds any trick or command.
- **Undo and redo**, with a history list on PC.
- **Filters:** side, level, wants. Select several (Shift click, box select, or Select mode on a phone), drag them together, align and spread them out.
- **Stance grid:** regular, fakie, switch and nollie for every trick.
- **Share:** an Instagram story image and a profile card of your map.
- **Saves on your device.** No account. Settings → Save backup makes a file you can restore from, and the app keeps a daily restore point.

## Install on your phone
Open the site in Safari, tap Share, then Add to Home Screen.

## How it's built
A static site with no build step: plain ES modules, deployed on Vercel straight from this repo.

```
index.html            app shell
css/base.css          colors, type, shared controls
css/components.css    map, grid, sheet, breakdown, feet editor
css/app.css           app layout (PC panes, phone full screen)
js/core/catalog.js    ingredients, sides, stances, trick names
js/core/store.js      saved state, migrations, undo, restore points, backups
js/core/model.js      map layout: bands, columns, connections
js/core/draw.js       SVG helpers: orbs, subway lines, labels
js/app/main.js        the app: toolbar, filters, inspector, search, shortcuts
js/app/*.js           map view, stance grid, level picker, breakdown, settings, share
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
