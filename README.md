# Trick Map

Map your flatground skate tricks, in black and white. Every trick is an ollie plus ingredients (flips, shoves, 180s, north and south kick-outs, body varials as add-ons), split into Sun, Earth and Moon sides. The shove-its without pop are foundations of their own, like the ollie.

- **Map:** drag orbs, hover (PC) or hold (phone) to set a level, tap to select. The inspector shows levels for every stance, where your feet go on the board, and what it's built from.
- **Search:** Cmd/Ctrl K or `/` finds any trick or command.
- **Undo and redo**, with a history list on PC.
- **Filters:** side, level, wants. Select several (Shift click, box select, or Select mode on a phone), drag them together, align and spread them out.
- **Stance grid:** regular, fakie, switch and nollie for every trick.
- **Share:** an Instagram story image and a profile card of your map.
- **Friends:** turn it on, send your invite link or code, and you'll see each other's maps (map or grid, view only, opening on their next stops). Tap a trick to see their level next to yours for every stance.
- **Saves on your device.** Settings → Save backup makes a file you can restore from, and the app keeps a daily restore point. With friends on, a copy of your map (no notes) also syncs online.

## Install on your phone
Open the site in Safari, tap Share, then Add to Home Screen.

## How it's built
A static site with no build step: plain ES modules, deployed on Vercel straight from this repo. Friends uses one Vercel Function and a free Upstash Redis database.

```
index.html            app shell
css/base.css          colors, type, shared controls
css/components.css    map, grid, sheet, breakdown, feet editor
css/app.css           app layout (PC panes, phone full screen), friends
js/core/catalog.js    ingredients, sides, stances, trick names
js/core/store.js      saved state, migrations, undo, restore points, backups
js/core/model.js      map layout: bands, columns, connections
js/core/draw.js       SVG helpers: orbs, subway lines, labels
js/app/main.js        the app: toolbar, filters, inspector, search, shortcuts
js/app/friends.js     friends: sync, invites, the friends sheet, a friend's map
js/app/*.js           map view, stance grid, level picker, breakdown, settings, share
api/friends.mjs       Vercel Function: POST /api/friends
server/friends.mjs    friends API logic (codes, keys, sync, friend lists)
sw.js                 offline support (network first, cache fallback)
tests/                node tests, a local server with friends
```

Saved data lives in `localStorage` under `trickmap` (schema 2). The first open after an update keeps an untouched copy of the old save in `trickmap.before-v2` and a restore point.

### Friends
Each person gets a friend code and a private key (kept with their map, so it travels in backups). The server stores a hash of the key, a copy of the map without notes, and a mutual friend list. Anyone with your code can add you; removing someone or turning friends off works both ways. Turning friends off deletes the online copy.

To set it up, connect a database to the project in Vercel: Storage → Upstash for Redis (free plan) → connect it to this project, then redeploy. The function reads `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`). Until then, the Friends sheet says friends isn't set up.

## Run it locally
```
node tests/serve.mjs
```
Then open http://127.0.0.1:8787. It serves the app and answers the friends API from an in-memory database. Any static server works for everything else (`python3 -m http.server 8000`); ES modules need a server, so opening the file directly won't work.

## Tests
```
node --test tests/core.test.js tests/sw.test.js tests/api.test.js
```
