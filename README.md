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

* `t` — 0 at the tee, 1 at the green, measured **along the centre line**
  (may fall outside that range, e.g. behind the tee)
* `offsetYards` — yards left/right of the fairway, perpendicular to whichever
  leg of the hole the station sits on
* `radiusYards` — how much ground the highlight covers

No pixels, no latitude/longitude. **That is what makes the images swappable:**
drop in a new picture, re-mark its tee and green, and every station lands
correctly with no re-work.

### Stage 1 — make the hole images

1. Open `admin.html` — there's a small **Committee** link in the footer of the
   welcome page — and pick a course and hole.
2. Find the hole on the satellite map. Shift-drag (or two-finger twist) to
   spin the imagery while hunting.
3. **Place tee pin**, click the tee box — the pin appears immediately — then
   it advances to the green automatically; click the top of the green. The view
   rotates and scales itself to the tee→green line, so what you see is what
   you'll capture. Nudge with the rotate (±1°/±5°) and zoom (±¼/±½) buttons.
4. **Doglegs:** click **Add shot point S1** and then the fairway corner. The
   centre line becomes Tee → S1 → Green instead of cutting across. Par 5s
   often want an S2 as well; add as many as the hole needs, and **Remove last**
   backs one off. All markers are draggable.
5. **Capture hole image** downloads `east-01.jpg`. Save it into
   `images/holes/` in the repo.
6. Tick **Image for this hole is final**.

Hole yardage is measured **along the centre line**, so a dogleg reports its
real playing length rather than the straight-line distance. If a shot point
sits far enough off the tee→green line that it would be cropped, the capture
zooms out just enough to include it — tee and green stay centred and
symmetric, just inset a little more than 8%/92%. A deliberate zoom nudge is
never overridden.

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
   where they are in the new picture. Drag any **S** marker to where the
   dogleg corner falls on the new image.
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

## Deploying to GitHub Pages

### Before you push: run the preflight check

Open `preflight.html` from the site folder. It loads every hole image named in
`js/holes-data.js` and reports what's actually there.

Fix anything red first — a red row means that hole will show an empty frame.
The most common cause is a file name whose capitalisation differs, or a
duplicate download saved as `east-01 (1).jpg`.

### Does git preserve the folder structure?

Yes. Git tracks each file by its full path, so `css/`, `js/`, `images/holes/`
and `vendor/leaflet/` all arrive intact and the relative links keep working.
Three caveats worth knowing:

1. **Git does not track empty folders.** `images/holes/` only exists in the
   repo because there are files in it. (A `README.md` is committed there for
   exactly this reason.)
2. **Case matters once deployed.** Windows treats `East-01.jpg` and
   `east-01.jpg` as the same file; GitHub Pages, on Linux, does not. This is
   the single most likely reason a site that works locally breaks when
   published — hence the preflight check.
3. **Commit the images too.** They're ordinary files in the repo, not
   uploaded separately. At ~200–400 KB each, all 36 are well within normal
   git limits; no Git LFS needed.

### Option A — GitHub website only (no git installed)

**You never create folders by hand.** On GitHub a folder isn't a thing you make
— it exists only because a file's path mentions it. Dragging folders onto the
upload page preserves their paths, so `css/`, `js/`, `images/holes/` and
`vendor/leaflet/` all get created for you.

Two things that will bite you:

* **Don't upload the .zip.** GitHub will just store the zip as a file; it does
  not unpack it. Unzip it on your PC first.
* **Drag the folder's *contents*, not the folder itself.** If you drag
  `oak-hill-marshals` as a folder, everything lands under
  `oak-hill-marshals/index.html` — one level too deep — and the published site
  root will be empty. You want `index.html` at the top of the repo.

Steps:

1. Unzip the site on your PC. Open the `oak-hill-marshals` folder so you can
   see `index.html`, `css`, `js`, `images`, `vendor` etc.
2. On github.com: **+** (top right) → **New repository**. Name it
   `oak-hill-marshals`, set **Public**, add nothing else, **Create repository**.
3. On the empty repo's quick-setup page, click **uploading an existing file**.
4. Select everything inside the folder — `Ctrl+A` works — and drag it onto the
   upload area. Both loose files and folders can go in the same drag.
5. Wait for the list to finish populating, then check it shows paths with
   slashes, e.g. `css/style.css` and `images/holes/east-01.jpg`. If you only
   see the file names with no folders, the folder structure was lost — stop and
   use the per-folder fallback below.
6. Type a commit message and click **Commit changes**.

Limits: 100 files per upload and 25 MiB per file. This site is 22 files plus
your hole images — around 58 in total with all 36 — so it fits in one go.
The biggest file is 144 KB. If you ever exceed 100 files, upload
`images/holes/` as a second commit.

`.gitignore` starts with a dot, so Windows may hide it and `Ctrl+A` may skip
it. That's fine — it only excludes OS junk and the site doesn't need it.

#### If folder drag-and-drop doesn't work: use the FLAT build

Simplest fix — there are no folders to lose. `oak-hill-marshals-flat.zip`
contains the identical site with every file at the top level. Unzip it, select
all ~15 files plus your hole images, drag them in as ordinary files (plain file
drag always works), commit.

Your exported `holes-data.js` needs **no editing**: image paths run through
`resolveImageSrc()`, which keeps only the file name and prefixes it with
`IMAGE_BASE` — empty in the flat build. A record saying
`images/holes/east-01.jpg` resolves to `east-01.jpg` automatically.

In the flat build the hole images sit beside the pages, not in a subfolder.

#### Or: create the folders by typing paths

If you'd rather keep the folder layout, create each folder once by giving a
*path* as the file name, then upload into it:

1. **Add file** → **Create new file**.
2. In the name box type `css/style.css` — the moment you type `/`, GitHub turns
   `css` into a folder in the breadcrumb.
3. Paste the contents of that file, then **Commit changes**.
4. Repeat for the other text files: `js/app.js`, `js/capture.js`,
   `js/admin.js`, `js/holes-data.js`, `vendor/leaflet/leaflet.css`,
   `vendor/leaflet/leaflet.js`, `vendor/leaflet/leaflet-rotate.js`.
5. Binary files can't be typed in. For your hole images, navigate into
   `images/holes/` once it exists and use **Add file** → **Upload files**,
   which commits into whichever folder you're currently viewing.

That's slower, so try the drag first.

### Option B — command line

From inside the site folder:

```bash
git init
git add -A
git commit -m "Marshal guide: East course images and stations"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/oak-hill-marshals.git
git push -u origin main
```

Before committing, sanity-check that the images are actually staged:

```bash
git status --short | grep images/holes | head
```

If that prints nothing, the images aren't being picked up — check you're in
the right folder and that no global gitignore excludes `*.jpg`
(`git check-ignore -v images/holes/east-01.jpg` will say which rule is to
blame).

### Turn on Pages

1. Repo → **Settings** → **Pages**.
2. **Source**: Deploy from a branch. **Branch**: `main`, folder **/(root)**.
   **Save**.
3. Wait a minute or two, then reload. GitHub shows the live URL:
   `https://YOUR-USERNAME.github.io/oak-hill-marshals/`

Pages on a **private** repo needs a paid plan, so for a free account the repo
must be public. Worth a thought before you push: a public repo means the code,
the hole images and the marshal positions are all publicly visible, under a
URL carrying Oak Hill's name. Nothing here is sensitive, and the footer already
disclaims any official affiliation — but if the committee would rather it
weren't world-readable, that's a reason to use a private repo on a paid plan,
or to wait for the official hosting.

### After deploying

1. Open `https://YOUR-USERNAME.github.io/oak-hill-marshals/preflight.html`.
   Running it *on the live site* is what catches case problems, since that's
   the case-sensitive filesystem.
2. Open the site on your phone and walk a couple of holes.
3. For the demo, add it to a phone home screen (Share → Add to Home Screen) so
   it opens full-screen like an app.

Updates later are the same loop: replace `js/holes-data.js`, drop any new
images into `images/holes/`, commit, push. Pages redeploys in under a minute.
A hard refresh (Ctrl/Cmd-Shift-R) clears a cached copy of the old data file.

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
admin.html           Admin tool: stage 1 (images) + stage 2 (stations)
preflight.html       Setup check: confirms every hole image actually loads
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
    "green": { "x": 0.92, "y": 0.5 },
    "shots": [ { "x": 0.46, "y": 0.72 } ]
  },
  "imageReady": true,

  "source": {
    "kind": "satellite",
    "tee":   { "lat": 43.11255, "lng": -77.53240 },
    "green": { "lat": 43.11480, "lng": -77.52890 },
    "shots": [ { "lat": 43.11290, "lng": -77.53060 } ],
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

`image.shots` are the dogleg corners, in the same normalised units as the tee
and green. The centre line runs tee → shots → green, and `t` is measured along
it. With no shot points there's a single segment and the maths is identical to
a straight hole, so existing data is unaffected.

`marshals` is stage 2's output and references neither pixels nor coordinates,
which is why replacing `image` costs nothing but re-marking a few points.
`lengthYards` is the path length, and converts yards into pixels for drawing.
