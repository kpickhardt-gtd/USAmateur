# Oak Hill Marshal Guide — 2027 U.S. Amateur

A mobile-friendly site for hole marshals: pick East or West course, pick a hole,
see a satellite view with the marshal station(s) highlighted.

## ⚠️ Important — the map pins are still placeholders

`js/holes-data.js` currently has each hole's center arranged in a rough circle
around the clubhouse, just so the map has *something* to show — it does not
reflect Oak Hill's real hole-by-hole layout yet.

**Before this goes live, use the built-in admin editor to fix that:**

1. Open `admin.html` in a browser (locally, or on the deployed GitHub Pages
   site — it's not linked from the marshal-facing pages, so bookmark the URL).
2. Pick a course and hole from the dropdowns.
3. Pan/zoom the satellite map until you're looking at the real hole.
4. Click **"Set hole center/zoom to current map view"** so the hole opens
   there for marshals.
5. Click on the map to drop a highlighted marshal spot; drag its numbered pin
   to the exact spot. Use the list below the map to rename it (e.g. "Behind
   tee box, left side," "Fairway crossing point") and resize the highlight
   circle with the +/- buttons. Add as many spots per hole as you need.
6. Repeat for every hole on both courses.
7. Click **Download updated holes-data.js**, then replace
   `js/holes-data.js` in this folder with the downloaded file.

Your edits are auto-saved to that browser's local storage as a safety net
while you work, but the only way they reach the live site is downloading and
committing the file — nothing is saved to a server.

## Running it locally

There's no server or build process. Just open `index.html` in a browser, or
for the closest experience to how it'll behave on GitHub Pages, run a tiny
local server from this folder:

```
python3 -m http.server 8000
```

then visit `http://localhost:8000`.

## Deploying to GitHub Pages (your account, for now)

1. Create a new repo (e.g. `oak-hill-marshals`) on your GitHub account and
   push everything in this folder to it.
2. In the repo, go to **Settings → Pages**.
3. Under "Build and deployment," set Source to **Deploy from a branch**,
   branch **main**, folder **/(root)**. Save.
4. GitHub will give you a URL like
   `https://yourusername.github.io/oak-hill-marshals/` within a minute or two.
5. Share that link with marshals — it works great saved to a phone's home
   screen (Safari/Chrome → Share → Add to Home Screen) so it opens full-screen
   like an app. The admin editor lives at the same domain, e.g.
   `https://yourusername.github.io/oak-hill-marshals/admin.html`.

## Moving to an official domain later

Since there's no backend, moving is just hosting the same static files
somewhere else (a custom domain via GitHub Pages, Netlify, Vercel, or your
club's own web host) — no code changes needed. If you get an official domain,
just point its DNS at GitHub Pages (or wherever you move it) and update any
printed QR codes/links.

## File structure

```
index.html          Welcome page, East/West course picker
course.html          18-hole grid for whichever course is in the URL (?course=east|west)
hole.html            Satellite map + marshal spot(s) for one hole (?course=...&hole=...)
admin.html           Hidden admin tool: pan/zoom the map, place & edit marshal spots
css/style.css        All styling (marshal-facing pages + admin)
js/holes-data.js     Hole coordinates and marshal spot data — edit via admin.html, or by hand
js/app.js            Shared rendering logic for course.html / hole.html
js/admin.js          Admin editor logic (map editing, drag/resize, export)
```

## Notes on the satellite imagery

Maps use Leaflet.js with Esri World Imagery satellite tiles — both free, no
API key required, and fine to use on a public GitHub Pages site. No changes
needed there.

## Data format

Each hole in `js/holes-data.js` looks like this:

```json
{
  "number": 7,
  "par": 4,
  "center": [43.116891, -77.53307],
  "zoom": 18,
  "marshals": [
    { "lat": 43.116901, "lng": -77.53310, "label": "Landing zone, right rough", "radius": 12 }
  ]
}
```

`center`/`zoom` control where the map opens when a marshal taps into that
hole. Each entry in `marshals` draws one highlighted circle (`radius` in
meters) with a numbered pin marshals can tap for the label. A hole can have
as many marshal spots as it needs — admin.html manages this array for you,
but it's plain JSON if you ever want to hand-edit it.
