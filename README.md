# Oak Hill Marshal Guide — 2027 U.S. Amateur

A mobile-friendly site for hole marshals: pick East or West course, pick a hole,
see that hole's image with the marshal station(s) highlighted — oriented so the
hole reads tee-to-green on any screen.

## Two stages, deliberately separate

The build splits cleanly in two, so that changing where hole pictures come
from does **not** invalidate the marshal work.

```
STAGE 1  Hole images          STAGE 2  Marshal stations
satellite / artwork  ──▶  image + tee & green marks  ──▶  stations on the axis
```

**Stage 1** produces one image per hole plus two facts about it: where the tee
and the green sit on that picture. Today those images are captured from
satellite imagery. Later they can be official course artwork instead.

**Stage 2** places marshal stations on that image — but stores them in the
hole's *own* coordinates:

* `t` — 0 at the tee, 1 at the green (may fall outside that range)
* `offsetYards` — yards left/right of the centre line
* `radiusYards` — how much ground the highlight covers

No pixels, no latitude/longitude. **That is what makes the images swappable:**
drop in a new picture, re-mark its tee and green, and every station lands
correctly with no re-work.

### Stage 1 — make the hole images

1. Open `admin.html` (not linked from the marshal pages — bookmark it) and
   pick a course and hole.
2. Find the hole on the satellite map. Shift-drag (or two-finger twist) to
   spin the imagery while hunting.
3. **Place tee pin**, click the tee box; it advances to the green
   automatically — click the top of the green. The view rotates and scales
   itself to that axis, so what you see is what you'll capture. Nudge with
   the rotate (±1°/±5°) and zoom (±¼/±½) buttons.
4. **Capture hole image** downloads `east-01.jpg`. Save it into
   `images/holes/` in the repo.
5. Tick **Image for this hole is final**.

Images come out 2048×1152, landscape, tee-left/green-right. Short holes are
captured smaller rather than upscaled — satellite detail runs out around
0.3 m/pixel, and a blurry stretch would be worse than fewer pixels. The
framing is identical either way.

*Or* use **upload an image** instead of capturing — that's the path for
official course artwork when you get it.

### Stage 2 — place the marshal stations

1. Switch to the **Marshal stations** tab (it needs an image first).
2. Click the image to drop a station; drag its numbered pin to fine-tune.
   Each row shows its position as "196 yd from tee · 18 yd left".
3. Describe the spot and size the highlight with **−** / **+** (in yards).
4. Tick **signed off**.

**Preview as: Computer / Phone** shows both framings — marshals are on phones,
you're probably not.

### Swapping in different images later

This is the case the split exists for:

1. Stage 1 → **upload an image** for the hole (or drop the file into
   `images/holes/` and point `image.src` at it).
2. Stage 2 → **Re-mark tee on image** and **Re-mark green on image**, clicking
   where they are in the new picture.
3. Done. Every station repositions itself. Nothing is re-entered.

### Saving and splitting the work

Edits live in your browser as you go; only the export buttons produce files.

* **Export hole** — one `hole-east-07.json`. Good for doing a few at a time
  or handing holes to someone else.
* **Import hole file(s)** — merges those back in; select several at once.
* **Export holes-data.js** — the whole dataset. Replace `js/holes-data.js`
  and commit, along with any new images.

The header tracks progress; the hole dropdown marks ✓ (image final) and
✓✓ (stations signed off). If your browser copy and the file on disk disagree,
a banner says so rather than silently preferring one.

### Checking that an export actually loaded

The hole grid tells you which stage each hole has reached, so you can confirm a
committed `holes-data.js` took effect:

| Tile | Meaning |
|---|---|
| **Pending** (dim green) | No image — stage 1 not done for this hole |
| **No spots** (amber) | Image loaded, no marshal stations yet — stage 1 done, stage 2 to do |
| **Hole** (green) | Image + at least one station — ready for marshals |

Below the grid, a "Setup in progress" line counts both stages. It disappears
once every hole is complete, so marshals never see it.

So after doing stage 1 for a course and committing the export, expect all 18 to
read **No spots** — that is confirmation the file loaded, not a failure. If they
read **Pending** instead, the data really didn't load: check you replaced
`js/holes-data.js` (not another copy), and hard-refresh to clear the cached
script (Ctrl/Cmd-Shift-R).

## Running it locally

There's no server or build process. Just open `index.html` in a browser, or
for the closest experience to how it'll behave on GitHub Pages, run a tiny
local server from this folder:

```
python3 -m http.server 8000
```

then visit `http://localhost:8000`.

**Keep the folder together.** The pages load `css/`, `js/`, and
`vendor/leaflet/` by relative path, so the subfolders have to stay next to the
`.html` files. Copying a single `.html` file somewhere on its own will leave
you with an unstyled page and no map.

## Troubleshooting: the map area is blank

Two different failures look similar, and they have different fixes:

| What you see | Cause | Fix |
|---|---|---|
| Empty box, no `+`/`−` zoom buttons, page looks unstyled | The `css/`, `js/`, or `vendor/` folders aren't sitting next to the HTML file | Open the page from the complete site folder |
| Dark box with `+`/`−` buttons, no picture, on a **marshal page** | That hole's image file is missing from `images/holes/` | Check the file named in `image.src` was committed |
| Grey box with a note across the top, in **admin stage 1** | Satellite tiles couldn't be fetched | Connect to the internet — stage 1 needs Esri; nothing else does |

Marshal pages need only their one image file, so once deployed they work on a
weak connection. Stage 1 of the admin tool is the only part that needs live
satellite access.

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
hole.html            One hole: its image + marshal stations (?course=...&hole=...)
admin.html           Hidden admin tool: stage 1 (images) + stage 2 (stations)
css/style.css        All styling (marshal-facing pages + admin)
images/holes/        The hole images — east-01.jpg ... west-18.jpg
js/holes-data.js     Image records + marshal stations — written by admin.html
js/app.js            Axis maths, image transforms, course & hole rendering
js/capture.js        Stage 1 only: satellite tiles -> a single hole image
js/admin.js          Admin editor logic for both stages
vendor/leaflet/      Bundled Leaflet 1.9.4 + leaflet-rotate — don't edit
```

## Notes on imagery

Satellite tiles (Esri World Imagery, free and no API key) are used **only by
stage 1**, to author the images. The marshal-facing pages load no tiles at all
— they show a single JPEG. That matters on a crowded course where cell service
is poor: one image loads far more reliably than dozens of map tiles.

Writing satellite tiles into an exported image needs the tile server to permit
it (a CORS header). If it refuses, capture stops with a clear message and you
can use **upload an image** instead — the same path you'd use for official
artwork. I could not verify Esri's header from my build environment, so this is
the one thing to confirm on the first real capture.

Leaflet is bundled in `vendor/leaflet/` rather than loaded from a CDN, so the
app can't be broken by a blocked or offline CDN.

## Data format

```json
{
  "number": 7,
  "par": 4,
  "lengthYards": 414,

  "image": {
    "src": "images/holes/east-07.jpg",
    "width": 2048, "height": 1152,
    "tee":   { "x": 0.08, "y": 0.5 },
    "green": { "x": 0.92, "y": 0.5 }
  },
  "imageReady": true,

  "source": {
    "kind": "satellite",
    "tee":   { "lat": 43.11255, "lng": -77.53240 },
    "green": { "lat": 43.11480, "lng": -77.52890 },
    "bearingNudge": 0, "zoomNudge": 0
  },

  "marshals": [
    { "t": 0.62, "offsetYards": -18, "radiusYards": 14,
      "label": "Fairway crossing, left rough" }
  ],
  "spotsDone": true
}
```

`image` is stage 1's output; `tee`/`green` are fractions of the image's own
width and height. `source` is only the satellite provenance for re-capturing —
nothing at marshal time reads it, and a hole using uploaded artwork doesn't
need it at all.

`marshals` is stage 2's output and references neither pixels nor coordinates,
which is why replacing `image` costs nothing but re-marking two points.
`lengthYards` converts the yard figures into pixels for drawing.
