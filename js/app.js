/* ============================================================
   Oak Hill Marshal Guide — shared core

   THE TWO STAGES ARE FORMALLY SEPARATE
   ------------------------------------
   Stage 1  produces a hole IMAGE plus two facts about it: where the tee
            and the green sit on that image (as fractions of its size).
            Today the images are captured from satellite; later they can be
            official course artwork instead. Nothing downstream cares.

   Stage 2  places marshal stations in HOLE-AXIS coordinates:
              t            0 = tee, 1 = green (may go outside 0..1)
              offsetYards  perpendicular distance from the centre line,
                           positive = right when looking tee -> green
              radiusYards  size of the highlight circle
            These are image-independent. Swap in a different image, re-mark
            its tee and green, and every station lands correctly with no
            re-work. That is the whole point of the split.

   So a hole record looks like:
     lengthYards  real hole length, used to turn yards into pixels
     image        { src, width, height, tee:{x,y}, green:{x,y} }   <- stage 1
     source       { kind:'satellite', tee/green latlng, nudges }   <- provenance
     marshals     [ { t, offsetYards, radiusYards, label } ]       <- stage 2
   ============================================================ */

/* Bumped whenever the code changes. Shown in the admin header so you can tell
   at a glance whether the browser is running the version you just uploaded,
   rather than a cached copy. */
const BUILD_STAMP = '2026-08-25j';

/* ---------- imagery sources (stage 1 only) ----------

   WHY MORE THAN ONE, AND WHY NOT GOOGLE
   -------------------------------------
   Google's imagery is often the sharpest, and it is the obvious thing to
   reach for. It cannot be used here: the Map Tiles API policies forbid
   pre-fetching, storing or caching tiles, and list "offline uses" among the
   prohibited ones. This tool exists to composite tiles into a JPEG and commit
   it to a repository, which is squarely what that prohibits — so it is a
   licensing wall, not a technical one, and no API key changes it.

   What DOES help, and cost nothing:

   1. Esri publishes zoom levels up to 23 (about 2cm per pixel), and this tool
      was capped at 19 (about 30cm). In a metro area like Rochester that threw
      away most of the available detail for no reason. The cap is now per
      source, and probed at runtime rather than assumed.

   2. New York State publishes its own orthoimagery, flown in SPRING — before
      the leaves come in. For a golf course that is often more useful than a
      sharper summer image, because fairway edges, cart paths and bunkers are
      not hidden under tree canopy. Public domain, attribution only.

   Each source declares the deepest zoom it is WILLING to serve; the real
   limit for a given place is found by probing (see probeMaxZoom). */

const IMAGERY_SOURCES = {
  esri: {
    label: 'Esri World Imagery',
    note: 'Sharpest where it has recent metro coverage. Usually summer, leaf-on.',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    maxZoom: 21
  },
  nysLatest: {
    label: 'NYS Orthoimagery (latest)',
    note: 'New York State, flown in spring — leaf-off, so the ground is visible.',
    url: 'https://orthos.its.ny.gov/arcgis/rest/services/wms/Latest/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery &copy; NYS ITS Geospatial Services',
    maxZoom: 20
  },
  nys2023: {
    label: 'NYS Orthoimagery 2023',
    note: 'A fixed vintage — useful for comparing against a newer flight.',
    url: 'https://orthos.its.ny.gov/arcgis/rest/services/wms/2023/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery &copy; NYS ITS Geospatial Services',
    maxZoom: 20
  }
};

const DEFAULT_IMAGERY = 'esri';

function imagerySource(key) {
  return IMAGERY_SOURCES[key] || IMAGERY_SOURCES[DEFAULT_IMAGERY];
}

/* Kept so older callers and saved data that name no source still work. */
const SATELLITE_TILE_URL = IMAGERY_SOURCES.esri.url;
const SATELLITE_ATTRIBUTION = IMAGERY_SOURCES.esri.attribution;

/* The deepest zoom a source actually serves for a given point.

   A source's declared maxZoom is only its ceiling; real coverage varies street
   by street. Rather than assume, fetch one tile at each level from the deepest
   down and take the first that carries real imagery.

   "Carries real imagery" is doing the work in that sentence. The first version
   of this asked only whether the tile LOADED, which is useless here: Esri
   answers a request beyond its coverage with 200 OK and a picture of the words
   "Map data not available". That loads perfectly, so the probe reported deep
   coverage that did not exist and captures came back as a mosaic of that
   message. The tile's CONTENT has to be examined, not its status. */
const _maxZoomCache = Object.create(null);

function tileXY(lat, lng, z) {
  const size = Math.pow(2, z);
  const s = Math.sin(lat * Math.PI / 180);
  return {
    x: Math.floor((lng + 180) / 360 * size),
    y: Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size)
  };
}

/* Loads a tile and reports whether it holds actual imagery. */
function probeTile(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!img.naturalWidth) { resolve(false); return; }
      // tileIsBlank lives in capture.js; if it isn't loaded (the marshal
      // pages don't need it), fall back to "loaded means available".
      resolve(typeof tileIsBlank === 'function' ? !tileIsBlank(img) : true);
    };
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

async function probeMaxZoom(sourceKey, lat, lng) {
  const src = imagerySource(sourceKey);
  const cacheKey = `${sourceKey}@${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (cacheKey in _maxZoomCache) return _maxZoomCache[cacheKey];

  const FLOOR = 17;
  for (let z = src.maxZoom; z >= FLOOR; z--) {
    const t = tileXY(lat, lng, z);
    const url = src.url.replace('{z}', z).replace('{x}', t.x).replace('{y}', t.y);
    if (await probeTile(url)) { _maxZoomCache[cacheKey] = z; return z; }
  }
  _maxZoomCache[cacheKey] = FLOOR;
  return FLOOR;
}

/* Does this URL load as an image?

   ONE definition, deliberately. There used to be a second copy of this in
   admin.js which -- being loaded later -- silently replaced this one for every
   caller, including the tile probe above. That copy appended a cache-busting
   query string, which is right for re-checking a repository file and wrong for
   a tile service. Same name, same scope, different behaviour, no warning: the
   sort of collision that produces a bug nobody can locate. Hence `bust` as an
   argument rather than a second function.

   `bust` forces a fresh fetch, for when the point is to re-check a file that
   may have changed (a newly committed image). Leave it off for tiles. */
function probeImage(src, bust) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img.naturalWidth > 0);
    img.onerror = () => resolve(false);
    img.src = bust
      ? src + (src.includes('?') ? '&' : '?') + 'probe=' + Date.now()
      : src;
  });
}

/* Screen width at or above which the hole is shown running left-to-right.
   Below it the image is rotated so the hole runs bottom-to-top. */
const WIDE_LAYOUT_MIN_PX = 700;

/* Where the hole images live, relative to the HTML pages.
   -------------------------------------------------------
   In the normal build this is 'images/holes/'. In the FLAT build (every file
   at the top level, for hosts or upload tools that won't take folders) it is
   ''. Every image path is resolved through resolveImageSrc(), which keeps only
   the file name and re-prefixes it — so the same holes-data.js works unchanged
   in either layout, and you never have to hand-edit paths. */
const IMAGE_BASE = 'images/holes/';

function resolveImageSrc(src) {
  if (!src) return src;
  // Leave blob:/data:/http: references alone (unsaved captures in the admin).
  if (/^(blob:|data:|https?:)/.test(src)) return src;
  return IMAGE_BASE + src.split('/').pop();
}

/* Capture defaults (stage 1). 16:9 rotates to 9:16, which fills a phone. */
const CAPTURE_WIDTH = 2048;
const CAPTURE_HEIGHT = 1152;
const CAPTURE_PAD_FRAC = 0.08;   // tee sits 8% in from the left edge

/* ---------- how big to capture ----------

   WHAT ACTUALLY CONTROLS SHARPNESS
   --------------------------------
   Raising the tile-zoom ceiling on its own changes nothing here, and it is
   worth being precise about why, because the obvious guess is wrong.

   The capture picks the SHALLOWEST zoom that still supplies enough pixels for
   the output size, then downsamples. A 590m hole across 2048px needs zoom
   18.3, so it takes zoom 19 and renders at scale 0.63 -- already throwing
   imagery detail away. At that output size zoom 19 was never the limit, and
   uncapping it produces a byte-identical image.

   The binding constraint is the OUTPUT SIZE. More output pixels is what asks
   for more ground detail; the raised zoom ceiling then matters, because it is
   what lets the bigger image be fed by real imagery instead of an upscale.
   The two only help together.

   Against that: these files ship to marshals on a crowded course with poor
   signal, and 36 large JPEGs is a real cost. So the trade-off is stated in
   numbers and left as a choice rather than decided quietly. */
const CAPTURE_SIZES = {
  standard: {
    label: 'Standard — 2048px (~400 KB)',
    width: 2048, height: 1152,
    note: 'Fast on a weak signal. Fine for seeing where to stand.'
  },
  sharp: {
    label: 'Sharp — 3072px (~800 KB)',
    width: 3072, height: 1728,
    note: 'Roughly twice the detail. Still reasonable over course wifi.'
  },
  max: {
    label: 'Maximum — 4096px (~1.4 MB)',
    width: 4096, height: 2304,
    note: 'As much detail as the imagery holds. 36 of these is ~50MB, '
        + 'and slow for a marshal on a phone at the far end of the course.'
  }
};

const DEFAULT_CAPTURE_SIZE = 'sharp';

function captureSize(key) {
  return CAPTURE_SIZES[key] || CAPTURE_SIZES[DEFAULT_CAPTURE_SIZE];
}

const DEFAULT_RADIUS_YARDS = 13;

/* ---------- small helpers ---------- */

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function getCourseKey() {
  return getParam('course') === 'west' ? 'west' : 'east';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function layoutMode() {
  return window.innerWidth >= WIDE_LAYOUT_MIN_PX ? 'wide' : 'narrow';
}

function debounce(fn, ms) {
  let t;
  return function () {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, arguments), ms);
  };
}

function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

/* ---------- geography (stage 1 only) ---------- */

function geoBearing(a, b) {
  const R = Math.PI / 180;
  const dLng = (b.lng - a.lng) * R;
  const lat1 = a.lat * R, lat2 = b.lat * R;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function geoDistanceMeters(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function metersToYards(m) { return m * 1.09361; }

/* Web Mercator world-pixel projection at a given tile zoom. */
function lngLatToWorldPx(lat, lng, zoom) {
  const size = 256 * Math.pow(2, zoom);
  const x = (lng + 180) / 360 * size;
  const s = Math.sin(lat * Math.PI / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size;
  return { x, y };
}

/* ---------- stage readiness ---------- */

function holeHasSource(hole) {
  const s = hole && hole.source;
  return !!(s && s.tee && s.green &&
            typeof s.tee.lat === 'number' && typeof s.green.lat === 'number');
}

function holeHasImage(hole) {
  const i = hole && hole.image;
  return !!(i && i.src && i.width && i.height && i.tee && i.green);
}

/* ---------- hole length ----------

   WHY THIS MATTERS MORE THAN IT LOOKS
   -----------------------------------
   lengthYards is what converts yards into pixels. Marshal stations are stored
   as (t along the centre line, offsetYards across it), so without a length
   there is no scale, yardsPerPixel returns null, and addMarshalSpot quietly
   returns null for every station on the hole. The result is a hole page that
   shows the image, shows the marshal LIST, and draws nothing on the map --
   which reads as "the stations were lost" when in fact the data is perfect
   and only the scale is missing.

   It went missing for an ordinary reason: capturing from satellite records a
   length, but UPLOADING an image never did, and migration only filled it in
   for holes that had satellite tee/green coordinates. Any hole built from an
   uploaded image therefore had stations that could never be drawn.

   Two defences, because one isn't enough:
     - fill the length in wherever it can be worked out (below), and
     - never let a missing length delete a station (yardsPerPixel's caller
       falls back to an assumed scale rather than returning null).

   A station's position ALONG the fairway is a fraction of the path and needs
   no yardage at all, so even a guessed scale puts it in very nearly the right
   place; only the sideways offset and the circle radius depend on it. */

/* A typical length for the par, used only when nothing better is known. */
function assumedLengthYards(hole) {
  const par = num(hole && hole.par, 4);
  if (par <= 3) return 175;
  if (par >= 5) return 540;
  return 400;
}

/* Give the hole a usable length, preferring a real measurement.
   Returns true if it had to assume one. */
function ensureHoleLength(hole) {
  if (!hole) return false;
  if (num(hole.lengthYards, 0) > 0) return false;

  if (holeHasSource(hole)) {
    hole.lengthYards = metersToYards(geoDistanceMeters(hole.source.tee, hole.source.green));
    hole.lengthAssumed = false;
    if (num(hole.lengthYards, 0) > 0) return false;
  }

  hole.lengthYards = assumedLengthYards(hole);
  hole.lengthAssumed = true;      // flagged so the admin can say so out loud
  return true;
}

/* Run over a whole data set. Cheap, idempotent, and safe to call on every
   page load: it only ever fills in a blank. */
function ensureDataLengths(data) {
  const assumed = [];
  ['east', 'west'].forEach(k => (((data && data[k] && data[k].holes) || [])).forEach(h => {
    if (ensureHoleLength(h)) assumed.push({ course: k, number: h.number });
  }));
  return assumed;
}

/* ---------- hole-axis <-> image-pixel transforms ----------
   The only bridge between stage 1 and stage 2. Everything marshal-related
   goes through here, which is why changing the image is cheap. */

/* Straight tee->green line. Used for ORIENTATION only (which way the hole
   faces), never for measuring along it -- see holePath for that. */
function holeAxis(hole) {
  if (!holeHasImage(hole)) return null;
  const { width: W, height: H, tee, green } = hole.image;
  const t = { x: tee.x * W, y: tee.y * H };
  const g = { x: green.x * W, y: green.y * H };
  const dx = g.x - t.x, dy = g.y - t.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (!len) return null;
  const u = { x: dx / len, y: dy / len };
  const n = { x: -u.y, y: u.x };
  return { tee: t, green: g, u, n, len };
}

/* The hole's CENTRE LINE as a polyline in image pixels:
       tee -> S1 -> S2 -> ... -> green
   Shot points let a dogleg follow the fairway instead of cutting the corner.
   With no shot points there is exactly one segment and every formula below
   reduces to the old straight-line maths, so existing data is unaffected. */
function holePath(hole) {
  if (!holeHasImage(hole)) return null;
  const { width: W, height: H, tee, green } = hole.image;

  const pts = [{ x: tee.x * W, y: tee.y * H }];
  (hole.image.shots || []).forEach(s => pts.push({ x: s.x * W, y: s.y * H }));
  pts.push({ x: green.x * W, y: green.y * H });

  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (!len) continue;                       // ignore duplicate points
    const u = { x: dx / len, y: dy / len };
    segs.push({ a, b, u, n: { x: -u.y, y: u.x }, len, start: total });
    total += len;
  }
  if (!segs.length) return null;
  return { pts, segs, total };
}

/* Yards per image pixel, measured ALONG THE PATH. */
function yardsPerPixel(hole) {
  const path = holePath(hole);
  const yds = num(hole.lengthYards, 0);
  if (!path || !yds) return null;
  return yds / path.total;
}

/* The scale actually used for drawing. ensureHoleLength should already have
   given every hole a length, so this normally just returns yardsPerPixel --
   but it is the belt to that braces: if a length is ever missing again, a
   station is drawn at an assumed scale instead of disappearing without a
   word. Silent disappearance is the failure mode that cost real time here. */
function drawingYardsPerPixel(hole) {
  const real = yardsPerPixel(hole);
  if (real) return real;
  const path = holePath(hole);
  if (!path || !path.total) return null;
  return assumedLengthYards(hole) / path.total;
}

/* (t, offsetYards) -> image pixel {x,y}.
   t is the fraction of the path walked from the tee; offsetYards is measured
   perpendicular to whichever segment the point falls on. */
function axisToImagePoint(hole, t, offsetYards) {
  const path = holePath(hole);
  const ypp = drawingYardsPerPixel(hole);
  if (!path || !ypp) return null;

  const d = t * path.total;
  let seg = path.segs[0];
  for (let i = 0; i < path.segs.length; i++) {
    seg = path.segs[i];
    if (d <= seg.start + seg.len) break;      // last segment extrapolates past the green
  }
  const along = d - seg.start;
  const offPx = (offsetYards || 0) / ypp;
  return {
    x: seg.a.x + seg.u.x * along + seg.n.x * offPx,
    y: seg.a.y + seg.u.y * along + seg.n.y * offPx
  };
}

/* image pixel {x,y} -> (t, offsetYards), by projecting onto the nearest
   segment of the path. Points before the tee or past the green extrapolate
   off the end segment rather than being clamped, so a marshal standing behind
   the tee still gets a sensible negative distance. */
function imagePointToAxis(hole, px, py) {
  const path = holePath(hole);
  // MUST be the same scale axisToImagePoint uses, or the round trip is lossy
  // and dragging a station would shift it under your finger.
  const ypp = drawingYardsPerPixel(hole);
  if (!path || !ypp) return null;

  let best = null;
  path.segs.forEach((seg, i) => {
    const dx = px - seg.a.x, dy = py - seg.a.y;
    const raw = dx * seg.u.x + dy * seg.u.y;
    const isFirst = i === 0, isLast = i === path.segs.length - 1;
    // Allow running off the outer ends; clamp only at interior joints.
    const lo = isFirst ? -Infinity : 0;
    const hi = isLast ? Infinity : seg.len;
    const along = Math.max(lo, Math.min(hi, raw));
    const cx = seg.a.x + seg.u.x * along, cy = seg.a.y + seg.u.y * along;
    const dist2 = (px - cx) ** 2 + (py - cy) ** 2;
    if (!best || dist2 < best.dist2) best = { seg, along, dist2 };
  });

  const dx = px - best.seg.a.x, dy = py - best.seg.a.y;
  return {
    t: (best.seg.start + best.along) / path.total,
    offsetYards: (dx * best.seg.n.x + dy * best.seg.n.y) * ypp
  };
}

function yardsToPixels(hole, yards) {
  const ypp = drawingYardsPerPixel(hole);
  return ypp ? yards / ypp : 0;
}

/* ---------- Leaflet on a static image (CRS.Simple) ----------
   Image pixel space has y growing DOWN; CRS.Simple has y growing UP, so
   latitude is flipped against the image height. */

function imgToLatLng(hole, px, py) {
  return L.latLng(hole.image.height - py, px);
}

function latLngToImg(hole, latlng) {
  return { x: latlng.lng, y: hole.image.height - latlng.lat };
}

function imageBounds(hole) {
  return L.latLngBounds([[0, 0], [hole.image.height, hole.image.width]]);
}

/* Bearing that puts the hole in the requested layout. The image is already
   captured tee-left/green-right, so wide needs no rotation and narrow needs
   a quarter turn to stand the hole up. */
function layoutBearing(mode) {
  return mode === 'wide' ? 0 : -90;
}

/* ---------- which way is north on a hole image ----------

   Every hole image is rotated so the hole runs left-to-right, which is what
   makes the pages readable and also what destroys the one orientation cue a
   marshal already has. Standing on the course, "the 4th plays north-east" is
   worth more than any amount of on-screen geometry -- so the image needs to
   say which way it has been turned.

   The obvious approach is to record the rotation at capture time. That works
   for captures and fails for uploaded artwork, which was never put through
   our rotation at all.

   This derives it instead, from two facts the data already holds:

     beta  the TRUE bearing from tee to green, from the satellite coordinates
     A     the direction from tee to green ON THE IMAGE, in pixels

   Both describe the same line, so the difference between them is the whole
   rotation of the image relative to the world. North is bearing 0, so it sits
   at A - beta on the image. Nothing needs storing, any manual rotation nudge
   is already baked into where the pins landed, and it works identically for a
   satellite capture and for a hand-marked photograph.

   Returns null when the hole has no satellite coordinates, because then the
   rotation genuinely isn't knowable. A compass pointing the wrong way on a
   golf course is far worse than no compass. */
function holeNorthDeg(hole) {
  if (!holeHasImage(hole) || !holeHasSource(hole)) return null;

  const dx = (hole.image.green.x - hole.image.tee.x) * hole.image.width;
  const dy = (hole.image.green.y - hole.image.tee.y) * hole.image.height;
  if (!dx && !dy) return null;

  // Image y grows downward, so "clockwise from up" is atan2(dx, -dy).
  const A = Math.atan2(dx, -dy) * 180 / Math.PI;
  const beta = geoBearing(hole.source.tee, hole.source.green);
  // Normalised to [0, 360). The extra % guards the floating-point case where
  // the expression lands a hair under 360 and rounds up to a bare "360deg".
  const deg = ((A - beta) % 360 + 360) % 360;
  return deg >= 359.9995 ? 0 : deg;
}

/* A small compass rose pinned to the corner of a hole image.

   It sits above the map rather than inside it, so it is never rotated by
   Leaflet -- the angle is applied explicitly, which keeps the needle correct
   when the layout flips between the wide and narrow orientations. */
function addCompass(map, hole) {
  const northDeg = holeNorthDeg(hole);
  if (northDeg === null) return null;

  const el = document.createElement('div');
  el.className = 'hole-compass';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML =
    /* Geometry notes, since the numbers look arbitrary otherwise:
       the needle pivots on the disc centre (24,24) because that is also the
       CSS rotation origin, and its two halves are equal lengths so it reads as
       one needle rather than an arrow. The N sits inside the disc above the
       tip -- an earlier version put it at the very top edge, where it was
       clipped and effectively invisible. */
    '<svg viewBox="0 0 48 48" class="hole-compass__rose">'
    + '<circle cx="24" cy="24" r="22" class="hole-compass__disc"/>'
    // North half red, south half pale: readable at a glance without the label.
    + '<path d="M24 13 L30 24 L24 24 Z" class="hole-compass__n"/>'
    + '<path d="M24 13 L18 24 L24 24 Z" class="hole-compass__n-dark"/>'
    + '<path d="M24 35 L18 24 L24 24 Z" class="hole-compass__s"/>'
    + '<path d="M24 35 L30 24 L24 24 Z" class="hole-compass__s-dark"/>'
    + '<text x="24" y="11.5" class="hole-compass__label">N</text>'
    + '</svg>';

  map.getContainer().appendChild(el);

  const rose = el.querySelector('.hole-compass__rose');
  function apply() {
    const a = northDeg + (map.getBearing ? map.getBearing() : 0);
    rose.style.transform = `rotate(${a}deg)`;
    el.title = `North is ${Math.round(((northDeg % 360) + 360) % 360)}° `
      + 'clockwise from the top of this image';
  }
  apply();
  map.on('rotate', apply);
  map.on('rotateend', apply);

  return { el, apply, northDeg };
}

/* Plain-language heading, for people who would rather read it than
   interpret a needle. */
const COMPASS_POINTS = ['north', 'north-east', 'east', 'south-east',
                        'south', 'south-west', 'west', 'north-west'];

function holePlaysDirection(hole) {
  if (!holeHasSource(hole)) return null;
  const b = geoBearing(hole.source.tee, hole.source.green);
  return COMPASS_POINTS[Math.round(b / 45) % 8];
}

function mapLibraryMissing(containerId) {
  const haveLeaflet = typeof L !== 'undefined';
  const haveRotate = haveLeaflet && typeof L.Map.prototype.setBearing === 'function';
  if (haveLeaflet && haveRotate) return false;
  const el = document.getElementById(containerId);
  if (el) {
    el.classList.add('map-message');
    el.innerHTML = '<div class="map-message__inner">'
      + '<strong>Map library didn\'t load.</strong>'
      + '<span>The <code>vendor/leaflet/</code> folder is missing or wasn\'t kept '
      + 'next to this page. Make sure the whole site folder stays together.</span>'
      + '</div>';
  }
  return true;
}

/* Live satellite tiles. Used ONLY by stage 1 of the admin tool, to author the
   hole images. The marshal-facing pages never load a tile. */
function addSatelliteLayer(map, sourceKey) {
  const src = imagerySource(sourceKey);
  const layer = L.tileLayer(src.url, {
    maxZoom: 23,
    // How deep real imagery goes. Leaflet upscales beyond this rather than
    // requesting tiles that don't exist, so panning stays smooth even where
    // the source runs out of detail.
    maxNativeZoom: src.maxZoom,
    crossOrigin: 'anonymous',   // required so captures can be exported
    attribution: src.attribution
  });

  let warned = false;
  layer.on('tileerror', () => {
    if (warned) return;
    warned = true;
    const note = document.createElement('div');
    note.className = 'map-offline-note';
    note.textContent = `Imagery couldn't load from ${src.label} — stage 1 needs an `
      + 'internet connection to it. Try another source.';
    map.getContainer().appendChild(note);
  });

  layer.addTo(map);
  layer._sourceKey = sourceKey || DEFAULT_IMAGERY;
  return layer;
}

/* Swap the live imagery underneath the map without disturbing the view, the
   rotation, or any pin already placed. */
function setSatelliteSource(map, layer, sourceKey) {
  if (layer) map.removeLayer(layer);
  return addSatelliteLayer(map, sourceKey);
}

/* A pan/zoom surface showing one hole image. No tile server involved. */
function createImageMap(containerId, opts) {
  return L.map(containerId, Object.assign({
    crs: L.CRS.Simple,
    rotate: true,
    bearing: 0,
    rotateControl: false,
    touchRotate: false,
    shiftKeyRotate: false,
    zoomSnap: 0,
    zoomDelta: 0.25,
    wheelPxPerZoomLevel: 140,
    zoomControl: false,
    attributionControl: false,
    minZoom: -6,
    maxZoom: 4,
    center: [0, 0],
    zoom: 0
  }, opts || {}));
}

function setHoleImage(map, hole, existing) {
  const bounds = imageBounds(hole);
  if (existing) map.removeLayer(existing);
  const layer = L.imageOverlay(resolveImageSrc(hole.image.src), bounds).addTo(map);
  return layer;
}

function frameImage(map, hole, mode, padding) {
  map.setBearing(layoutBearing(mode));
  map.fitBounds(imageBounds(hole), {
    padding: L.point(padding || 6, padding || 6),
    animate: false
  });
}

/* ---------- markers ---------- */

function teeIcon() {
  return L.divIcon({
    className: 'hole-endpoint',
    html: '<span class="hole-endpoint__mark hole-endpoint__mark--tee">T</span>',
    iconSize: [26, 26], iconAnchor: [13, 13]
  });
}

function greenIcon() {
  return L.divIcon({
    className: 'hole-endpoint',
    html: '<span class="hole-endpoint__mark hole-endpoint__mark--green">G</span>',
    iconSize: [26, 26], iconAnchor: [13, 13]
  });
}

function shotIcon(index) {
  return L.divIcon({
    className: 'hole-endpoint',
    html: `<span class="hole-endpoint__mark hole-endpoint__mark--shot">S${index + 1}</span>`,
    iconSize: [26, 26], iconAnchor: [13, 13]
  });
}

function marshalIcon(index) {
  return L.divIcon({
    className: 'marshal-pin',
    html: `<span class="marshal-pin__num">${index + 1}</span>`,
    iconSize: [26, 26], iconAnchor: [13, 13]
  });
}

function spotPopupHtml(index, spot) {
  const bits = [];
  if (spot.label) bits.push(escapeHtml(spot.label));
  return `<strong>Station ${index + 1}</strong>${bits.length ? '<br>' + bits.join('<br>') : ''}`;
}

/* The centre line plus its markers: tee, any shot points, green. The line
   follows the path, so a dogleg traces the fairway. */
function addHoleEndpoints(map, hole, opts) {
  opts = opts || {};
  if (!holeHasImage(hole)) return null;
  const path = holePath(hole);
  if (!path) return null;

  const latlngs = path.pts.map(p => imgToLatLng(hole, p.x, p.y));

  const line = L.polyline(latlngs, {
    color: '#F6F3EA', weight: 2, opacity: 0.5,
    dashArray: '8 10', interactive: false
  }).addTo(map);

  const tee = L.marker(latlngs[0], {
    icon: teeIcon(), draggable: !!opts.draggable, zIndexOffset: 400
  }).addTo(map);
  const green = L.marker(latlngs[latlngs.length - 1], {
    icon: greenIcon(), draggable: !!opts.draggable, zIndexOffset: 400
  }).addTo(map);

  const shots = latlngs.slice(1, -1).map((ll, i) =>
    L.marker(ll, {
      icon: shotIcon(i), draggable: !!opts.draggable, zIndexOffset: 380
    }).addTo(map));

  if (opts.labels !== false) {
    tee.bindPopup('<strong>Tee box</strong>');
    green.bindPopup('<strong>Green</strong>');
    shots.forEach((m, i) => m.bindPopup(`<strong>Shot point S${i + 1}</strong>`));
  }
  return { line, tee, green, shots };
}

/* A marshal station, positioned from its axis coordinates. */
function addMarshalSpot(map, hole, spot, index, opts) {
  opts = opts || {};
  const p = axisToImagePoint(hole, spot.t, spot.offsetYards);
  if (!p) return null;
  const ll = imgToLatLng(hole, p.x, p.y);
  const radiusPx = yardsToPixels(hole, num(spot.radiusYards, DEFAULT_RADIUS_YARDS));

  // In CRS.Simple, circle radius is in map units, which here are image pixels.
  const circle = L.circle(ll, {
    radius: radiusPx,
    color: '#C0392B', weight: 2,
    fillColor: '#C0392B', fillOpacity: 0.28
  }).addTo(map);

  const marker = L.marker(ll, {
    icon: marshalIcon(index), draggable: !!opts.draggable, zIndexOffset: 500
  }).addTo(map);

  const html = spotPopupHtml(index, spot);
  circle.bindPopup(html);
  marker.bindPopup(html);
  return { circle, marker };
}

/* ============================================================
   course.html
   ============================================================ */
function renderCoursePage() {
  ensureDataLengths(HOLES_DATA);
  const courseKey = getCourseKey();
  const course = HOLES_DATA[courseKey];
  document.body.classList.toggle('theme-west', courseKey === 'west');

  const titleEl = document.getElementById('course-title');
  if (titleEl) titleEl.textContent = course.name;

  /* Three distinct states, so setup progress is visible rather than every
     unfinished hole reading the same "Pending". A hole with an image but no
     stations means stage 1 landed and stage 2 is still to do -- that is very
     different from a hole with no image at all. */
  let withImage = 0, withStations = 0;

  const grid = document.getElementById('hole-grid');
  if (grid) {
    grid.innerHTML = course.holes.map(h => {
      const hasImage = holeHasImage(h);
      const nStations = (h.marshals || []).length;
      if (hasImage) withImage++;
      if (hasImage && nStations) withStations++;

      let cls = '', label = 'Pending';
      if (hasImage && nStations) { label = 'Hole'; }
      else if (hasImage) { cls = ' hole-tile--no-stations'; label = 'No spots'; }
      else { cls = ' hole-tile--pending'; }

      return `
      <a class="hole-tile${cls}"
         href="hole.html?course=${courseKey}&hole=${h.number}" role="listitem">
        <span class="hole-tile__number">${h.number}</span>
        <span class="hole-tile__label">${label}</span>
      </a>`;
    }).join('');
  }

  /* Setup summary. Only shown while something is incomplete -- once every
     hole is done it disappears and marshals never see it. */
  const summary = document.getElementById('grid-summary');
  if (summary) {
    const total = course.holes.length;
    if (withStations === total) {
      summary.hidden = true;
    } else {
      summary.hidden = false;
      summary.innerHTML =
        `<strong>Setup in progress:</strong> ${withImage} of ${total} holes have an image, `
        + `${withStations} of ${total} also have marshal stations.`
        + (withImage && !withStations
            ? ' Stage 1 is loaded — stage 2 (placing stations) is still to do.'
            : '')
        + (!withImage
            ? ' No hole images are loaded yet.'
            : '');
    }
  }
}

/* ============================================================
   hole.html — marshal-facing view, image only
   ============================================================ */
function renderHolePage() {
  ensureDataLengths(HOLES_DATA);   // no station may vanish for want of a scale
  const courseKey = getCourseKey();
  const holeNum = parseInt(getParam('hole'), 10) || 1;
  const course = HOLES_DATA[courseKey];
  const hole = course.holes.find(h => h.number === holeNum) || course.holes[0];

  document.body.classList.toggle('theme-west', courseKey === 'west');

  const backLink = document.getElementById('back-link');
  if (backLink) backLink.href = `course.html?course=${courseKey}`;
  const eyebrow = document.getElementById('hole-eyebrow');
  if (eyebrow) eyebrow.textContent = course.name;
  const title = document.getElementById('hole-title');
  if (title) title.textContent = `Hole ${hole.number}`;

  const parEl = document.getElementById('hole-par');
  if (parEl) {
    const bits = [];
    if (hole.par) bits.push('Par ' + hole.par);
    if (hole.lengthYards) bits.push(Math.round(hole.lengthYards) + ' yd');
    // The one orientation cue that survives being read aloud, or glanced at
    // in bright sun with the phone at arm's length.
    const dir = holePlaysDirection(hole);
    if (dir) bits.push('plays ' + dir);
    parEl.textContent = bits.join(' · ');
  }

  const spots = hole.marshals || [];
  const list = document.getElementById('marshal-list');
  if (list) {
    list.innerHTML = spots.length
      ? spots.map((s, i) => {
          const side = s.offsetYards > 2 ? 'right' : (s.offsetYards < -2 ? 'left' : 'centre');
          const along = Math.round(num(s.t, 0) * num(hole.lengthYards, 0));
          const meta = hole.lengthYards
            ? `${along} yd from tee · ${side} of centre` : '';
          return `
          <li class="marshal-list__item">
            <span class="marshal-list__num">${i + 1}</span>
            <span class="marshal-list__desc">${escapeHtml(s.label || 'Marshal spot')}
              ${meta ? `<span class="marshal-list__meta">${meta}</span>` : ''}</span>
          </li>`;
        }).join('')
      : '<li class="marshal-list__item marshal-list__item--empty">'
        + 'No marshal stations have been set for this hole yet.</li>';
  }

  const idx = course.holes.findIndex(h => h.number === hole.number);
  const prev = course.holes[idx - 1], next = course.holes[idx + 1];
  const pager = document.getElementById('hole-pager');
  if (pager) {
    pager.innerHTML = `
      ${prev ? `<a class="pager-btn" href="hole.html?course=${courseKey}&hole=${prev.number}">&larr; Hole ${prev.number}</a>` : '<span></span>'}
      <a class="pager-btn pager-btn--all" href="course.html?course=${courseKey}">All holes</a>
      ${next ? `<a class="pager-btn" href="hole.html?course=${courseKey}&hole=${next.number}">Hole ${next.number} &rarr;</a>` : '<span></span>'}
    `;
  }

  const missing = document.getElementById('hole-no-image');
  if (!holeHasImage(hole)) {
    if (missing) missing.hidden = false;
    const mapEl = document.getElementById('map');
    if (mapEl) mapEl.hidden = true;
    const rc = document.getElementById('hole-recenter');
    if (rc) rc.hidden = true;
    return;
  }
  if (missing) missing.hidden = true;

  if (mapLibraryMissing('map')) return;

  const map = createImageMap('map');
  window.holeMap = map;   // handle for debugging in the console
  L.control.zoom({ position: 'topleft' }).addTo(map);

  setHoleImage(map, hole);
  addHoleEndpoints(map, hole);
  spots.forEach((spot, i) => addMarshalSpot(map, hole, spot, i));
  const compass = addCompass(map, hole);

  function frame() {
    frameImage(map, hole, layoutMode());
    // frameImage changes the bearing, so re-point the needle after it.
    if (compass) compass.apply();
  }
  frame();

  const recenter = document.getElementById('hole-recenter');
  if (recenter) {
    recenter.addEventListener('click', () => { map.invalidateSize(); frame(); });
  }

  let lastMode = layoutMode();
  const onResize = debounce(() => {
    map.invalidateSize();
    const mode = layoutMode();
    if (mode !== lastMode) { lastMode = mode; frame(); }
  }, 200);
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
}
