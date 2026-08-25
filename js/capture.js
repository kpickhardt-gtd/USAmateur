/* ============================================================
   Stage 1 — capture a hole image from satellite tiles

   Given the tee and green as lat/lng, this composites the satellite tiles
   into a single landscape image with the hole running left-to-right, and
   reports where the tee and green ended up on that image.

   It does the projection itself rather than screenshotting the DOM, so the
   output is deterministic and independent of screen size or scroll position.

   Nothing here is required at marshal time — it only produces the image
   files. Replace the images by hand later and the rest of the app is
   unaffected.
   ============================================================ */

const TILE_SIZE = 256;
const CAPTURE_QUALITY = 0.85;

/* Deepest zoom a capture will ask for.
   ------------------------------------
   This was 19, hardcoded, with the comment "Esri World Imagery native limit".
   That was simply wrong: Esri defines levels of detail down to 23 (about 2cm
   per pixel) and serves well past 19 in metro areas. Capping at 19 held every
   capture to ~30cm per pixel and made the imagery look far worse than what
   was actually available -- the reason for reaching for another provider in
   the first place.

   The real limit is per-source AND per-place, so it is passed in by the caller
   after probing (probeMaxZoom in app.js). This constant is only the outer
   bound, and the floor below which something is clearly wrong. */
const MAX_TILE_ZOOM = 23;
const MIN_TILE_ZOOM = 15;

/* Even at the deepest available zoom, imagery eventually runs out of detail.
   A short par 3 stretched across 2048px can need finer imagery than exists,
   so rather than emit a blurry upscale we shrink the output image instead. The
   FRAMING is unchanged (tee still at 8%, green at 92%, centred) -- there are
   simply fewer pixels, which is the honest result. */
const MAX_UPSCALE = 1.5;
const MIN_CAPTURE_WIDTH = 1024;

/* Total ground distance along tee -> shot points -> green. */
function pathLengthMeters(tee, shots, green) {
  const pts = [tee].concat(shots || []).concat([green]);
  let m = 0;
  for (let i = 0; i < pts.length - 1; i++) m += geoDistanceMeters(pts[i], pts[i + 1]);
  return m;
}

function tileUrl(template, z, x, y) {
  return template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

function loadTile(url) {
  return new Promise(resolve => {
    const img = new Image();
    // Required so the tiles can be written into a canvas we then export.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve({ ok: true, img, blank: tileIsBlank(img) });
    img.onerror = () => resolve({ ok: false, url });
    img.src = url;
  });
}

/* ---------- "Map data not available" ----------

   Esri does not 404 a tile beyond its imagery coverage. It returns 200 OK with
   a picture of the words "Map data not available" on a near-white background.
   That is a perfectly valid image, so every check based on whether a tile
   LOADS reports coverage that isn't there -- which is how a capture ends up
   being a mosaic of that message instead of a golf hole.

   So a tile has to be judged on its content. Aerial imagery of a golf course
   is busy: hundreds of distinct colours and a wide spread of brightness. The
   placeholder is nearly flat -- one background tone plus a little dark text.
   Sampling a small grid of pixels separates the two comfortably, and it is
   cheap enough to run on every tile.

   Reading pixels needs the CORS-clean image the capture already requires, so
   this costs nothing extra. If the read throws (a tainted canvas), we say
   "not blank" rather than discarding good imagery on a technicality. */
/* WHAT THE FIRST VERSION GOT WRONG
   -------------------------------
   It required BOTH a low standard deviation AND very few distinct colours,
   with thresholds picked against a placeholder I had invented for the tests
   rather than the one Esri actually serves. The real tile has anti-aliased
   text on it, which lifts both numbers past those limits, so it sailed
   through as "real imagery" and captures kept coming back as the message.

   The rewrite leans on the one property a placeholder cannot avoid and aerial
   imagery essentially never has: it is overwhelmingly ONE flat colour. A
   background tone with a line of text on it is 85-95% background. Photography
   of a golf course -- even a mown fairway -- is far more varied than that once
   you allow 32 levels per channel.

   Dominant-colour fraction is therefore the primary test, and it needs no
   knowledge of what the placeholder looks like. The old flat/low-variance test
   is kept as a secondary catch for a plain solid tile with no text at all. */
const BLANK_DOMINANT = 0.80;   // share of pixels in one quantised colour
const BLANK_STDDEV = 6;
const BLANK_COLOURS = 24;

function tileStats(img) {
  const S = 48;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, S, S);
  const px = x.getImageData(0, 0, S, S).data;

  const counts = Object.create(null);
  let n = 0, sum = 0, sumSq = 0, distinct = 0, top = 0;
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    sum += lum; sumSq += lum * lum; n++;
    // 5 bits per channel: tolerant of JPEG noise, still separates real tones.
    const key = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3);
    const v = (counts[key] = (counts[key] || 0) + 1);
    if (v === 1) distinct++;
    if (v > top) top = v;
  }
  if (!n) return null;
  return {
    dominant: top / n,
    distinct,
    stddev: Math.sqrt(Math.max(0, sumSq / n - (sum / n) * (sum / n)))
  };
}

function tileIsBlank(img) {
  try {
    const s = tileStats(img);
    if (!s) return false;
    if (s.dominant > BLANK_DOMINANT) return true;
    return s.stddev < BLANK_STDDEV && s.distinct < BLANK_COLOURS;
  } catch (e) {
    // Cross-origin read refused. Say "not blank" rather than throwing away
    // imagery that is probably fine.
    return false;
  }
}

/* Work out the zoom, scale and rotation needed to draw the hole across the
   output image. Pure maths -- no network, so it's cheap to unit-test.

   Runs at most twice: if the first pass would upscale the imagery beyond
   MAX_UPSCALE, the output dimensions shrink and it recomputes. */
function captureGeometry(opts) {
  let geo = captureGeometryPass(opts);
  let dims = { width: opts.width, height: opts.height };
  let downsized = null;

  // 1. Don't upscale beyond MAX_UPSCALE -- shrink the output instead.
  if (geo.scale > MAX_UPSCALE) {
    const shrink = MAX_UPSCALE / geo.scale;
    const w = Math.max(MIN_CAPTURE_WIDTH, Math.round(opts.width * shrink));
    const h = Math.round(w * opts.height / opts.width);
    dims = { width: w, height: h };
    geo = captureGeometryPass(Object.assign({}, opts, dims));
    downsized = { from: [opts.width, opts.height], to: [w, h] };
  }

  // 2. A dogleg's shot points can sit well off the tee->green line and would
  //    be cropped. Zoom out just enough to include everything. Tee and green
  //    move inward symmetrically, so they stay centred and balanced -- they
  //    just aren't at exactly 8%/92% any more.
  const extra = overflowFactor(geo, opts);
  if (extra > 1.001) {
    geo = captureGeometryPass(Object.assign({}, opts, dims, { axisShrink: 1 / extra }));
    geo.zoomedOutToFit = +extra.toFixed(3);
  }

  geo.downsized = downsized;
  return geo;
}

/* How much wider the frame would have to be to contain the DOGLEG SHOT POINTS
   with a margin. 1 = already fits.

   Deliberately ignores the tee and green: their position is set by padFrac and
   the user's zoom nudge, so including them here would silently undo a nudge
   the user asked for. Shot points are the ones that can land unexpectedly far
   off the tee->green line and get cropped. */
function overflowFactor(geo, opts) {
  const pts = opts.shots || [];
  if (!pts.length) return 1;
  const margin = 0.06 * Math.min(geo.width, geo.height);
  const halfW = geo.width / 2 - margin;
  const halfH = geo.height / 2 - margin;
  let worst = 1;
  pts.forEach(p => {
    const o = geo.toOutput(lngLatToWorldPx(p.lat, p.lng, geo.zoom));
    worst = Math.max(worst,
      Math.abs(o.x - geo.width / 2) / halfW,
      Math.abs(o.y - geo.height / 2) / halfH);
  });
  return worst;
}

function captureGeometryPass(opts) {
  const W = opts.width, H = opts.height;
  const padFrac = opts.padFrac;
  const zoomNudge = opts.zoomNudge || 0;
  const bearingNudge = opts.bearingNudge || 0;

  // How long the tee->green axis should be, in output pixels. axisShrink < 1
  // zooms out to fit a dogleg's shot points into the frame.
  const axisShrink = opts.axisShrink === undefined ? 1 : opts.axisShrink;
  const desiredAxisPx = W * (1 - 2 * padFrac) * Math.pow(2, zoomNudge) * axisShrink;

  // Axis length at zoom 0, to pick a tile zoom with enough real resolution.
  const t0 = lngLatToWorldPx(opts.tee.lat, opts.tee.lng, 0);
  const g0 = lngLatToWorldPx(opts.green.lat, opts.green.lng, 0);
  const axis0 = Math.hypot(g0.x - t0.x, g0.y - t0.y);

  // Prefer downscaling over upscaling: round the zoom UP.
  let zoom = Math.ceil(Math.log2(desiredAxisPx / axis0));
  const ceiling = Math.max(MIN_TILE_ZOOM,
    Math.min(MAX_TILE_ZOOM, opts.maxZoom || MAX_TILE_ZOOM));
  zoom = Math.max(0, Math.min(ceiling, zoom));

  const tee = lngLatToWorldPx(opts.tee.lat, opts.tee.lng, zoom);
  const green = lngLatToWorldPx(opts.green.lat, opts.green.lng, zoom);
  const axisPx = Math.hypot(green.x - tee.x, green.y - tee.y);
  const scale = desiredAxisPx / axisPx;

  // Rotate so the axis points along +x, then apply the manual nudge.
  const axisAngle = Math.atan2(green.y - tee.y, green.x - tee.x);
  const theta = -axisAngle + (bearingNudge * Math.PI / 180);

  const mid = { x: (tee.x + green.x) / 2, y: (tee.y + green.y) / 2 };

  // Forward transform: world pixel -> output pixel.
  const cos = Math.cos(theta), sin = Math.sin(theta);
  function toOutput(p) {
    const dx = (p.x - mid.x) * scale, dy = (p.y - mid.y) * scale;
    return { x: W / 2 + dx * cos - dy * sin, y: H / 2 + dx * sin + dy * cos };
  }
  // Inverse: output pixel -> world pixel (used to find which tiles we need).
  function toWorld(p) {
    const dx = p.x - W / 2, dy = p.y - H / 2;
    const rx = dx * cos + dy * sin, ry = -dx * sin + dy * cos;
    return { x: mid.x + rx / scale, y: mid.y + ry / scale };
  }

  // Bounding box of the output rectangle back in world space.
  const corners = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }].map(toWorld);
  const minX = Math.min(...corners.map(c => c.x));
  const maxX = Math.max(...corners.map(c => c.x));
  const minY = Math.min(...corners.map(c => c.y));
  const maxY = Math.max(...corners.map(c => c.y));

  const nTiles = Math.pow(2, zoom);
  const range = {
    x0: Math.floor(minX / TILE_SIZE), x1: Math.floor(maxX / TILE_SIZE),
    y0: Math.floor(minY / TILE_SIZE), y1: Math.floor(maxY / TILE_SIZE)
  };

  return {
    width: W, height: H, zoom, scale, theta, mid, nTiles, range,
    toOutput, toWorld,
    teeOut: toOutput(tee), greenOut: toOutput(green),
    shotsOut: (opts.shots || []).map(s =>
      toOutput(lngLatToWorldPx(s.lat, s.lng, zoom))),
    // Playing length follows the path (tee -> shots -> green), which is the
    // honest number for a dogleg.
    lengthYards: metersToYards(pathLengthMeters(opts.tee, opts.shots, opts.green)),
    downsized: null
  };
}

/* Composite the tiles and hand back a JPEG blob plus the image metadata
   that stage 2 needs.

   If the chosen zoom turns out to be past the imagery's real coverage -- which
   shows up as "Map data not available" tiles rather than as errors -- this
   drops a zoom level and tries again, rather than handing back a picture of
   that message. Stepping down costs sharpness; shipping the message costs the
   whole image. */
async function captureHoleImage(opts) {
  const floor = Math.max(MIN_TILE_ZOOM, (opts.minZoom || MIN_TILE_ZOOM));
  let attempt = opts.maxZoom || MAX_TILE_ZOOM;
  let steppedDown = 0;
  let lastErr = null;

  for (;;) {
    const res = await captureOnce(Object.assign({}, opts, { maxZoom: attempt }));
    // A few blank tiles at the edge of coverage are tolerable; a frame built
    // mostly out of them is not an image of anything.
    const blankFrac = res.tilesLoaded ? res.tilesBlank / res.tilesLoaded : 0;
    if (blankFrac <= 0.15 || res.zoom <= floor) {
      res.steppedDown = steppedDown;
      res.blankFraction = +blankFrac.toFixed(3);
      if (blankFrac > 0.15) {
        lastErr = `imagery is not available here even at zoom ${res.zoom}`;
        res.coverageWarning = lastErr;
      }
      return res;
    }
    attempt = res.zoom - 1;
    steppedDown++;
  }
}

async function captureOnce(opts) {
  const geo = captureGeometry({
    tee: opts.tee, green: opts.green, shots: opts.shots || [],
    width: opts.width || CAPTURE_WIDTH,
    height: opts.height || CAPTURE_HEIGHT,
    padFrac: opts.padFrac === undefined ? CAPTURE_PAD_FRAC : opts.padFrac,
    zoomNudge: opts.zoomNudge, bearingNudge: opts.bearingNudge,
    maxZoom: opts.maxZoom
  });

  const canvas = document.createElement('canvas');
  canvas.width = geo.width;
  canvas.height = geo.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3a4a3f';
  ctx.fillRect(0, 0, geo.width, geo.height);

  // Gather every tile the output rectangle touches.
  const jobs = [];
  for (let ty = geo.range.y0; ty <= geo.range.y1; ty++) {
    for (let tx = geo.range.x0; tx <= geo.range.x1; tx++) {
      if (ty < 0 || ty >= geo.nTiles) continue;
      const wrapped = ((tx % geo.nTiles) + geo.nTiles) % geo.nTiles;
      jobs.push({ tx, ty, url: tileUrl(opts.tileUrl || SATELLITE_TILE_URL, geo.zoom, wrapped, ty) });
    }
  }
  /* GUARD THE RIGHT THING
     ---------------------
     This used to refuse any capture needing more than 400 tiles, on the
     reasoning that a huge tile count means misplaced pins. It does not: tile
     count rises with output size and zoom as well as with distance, so a
     legitimate 4096px capture at zoom 20 needs ~800 tiles and was rejected
     with a message telling you to check pins that were perfectly correct.

     Distance is the honest test for "these pins are wrong": no golf hole is
     1.5km long. So the sanity check measures the hole, and the tile count is
     only a ceiling on work, set high enough not to block a real capture. */
  const spanMeters = pathLengthMeters(opts.tee, opts.shots || [], opts.green);
  if (spanMeters > 1500) {
    throw new Error(`The tee and green are ${Math.round(spanMeters)}m apart, which is `
      + 'far longer than any golf hole — check the pins are both on this hole.');
  }
  const MAX_TILES = 1600;
  if (jobs.length > MAX_TILES) {
    throw new Error(`This capture needs ${jobs.length} imagery tiles, past the `
      + `${MAX_TILES} limit. Choose a smaller capture size in stage 1.`);
  }

  const results = await Promise.all(jobs.map(j => loadTile(j.url).then(r => ({ ...j, ...r }))));

  ctx.save();
  ctx.translate(geo.width / 2, geo.height / 2);
  ctx.rotate(geo.theta);
  ctx.scale(geo.scale, geo.scale);
  ctx.translate(-geo.mid.x, -geo.mid.y);
  ctx.imageSmoothingQuality = 'high';
  let loaded = 0, failed = 0, blank = 0;
  results.forEach(r => {
    if (!r.ok) { failed++; return; }
    loaded++;
    if (r.blank) blank++;
    // +1px overdraw kills hairline seams between tiles after scaling.
    ctx.drawImage(r.img, r.tx * TILE_SIZE, r.ty * TILE_SIZE, TILE_SIZE + 1, TILE_SIZE + 1);
  });
  ctx.restore();

  // Exporting throws if any tile came from a server that didn't allow it.
  let blob;
  try {
    blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob returned nothing')),
                    'image/jpeg', CAPTURE_QUALITY);
    });
  } catch (err) {
    const e = new Error(
      'The satellite tiles could not be written into an image because the tile '
      + 'server did not send permission (CORS). Capture is blocked — but you can '
      + 'still use "Upload an image" to supply the hole image yourself.');
    e.cause = err;
    e.corsBlocked = true;
    throw e;
  }

  return {
    blob,
    tilesLoaded: loaded,
    tilesFailed: failed,
    tilesBlank: blank,
    zoom: geo.zoom,
    scale: geo.scale,
    downsized: geo.downsized,
    zoomedOutToFit: geo.zoomedOutToFit || null,
    lengthYards: geo.lengthYards,
    image: {
      width: geo.width,
      height: geo.height,
      tee:   { x: geo.teeOut.x / geo.width,   y: geo.teeOut.y / geo.height },
      green: { x: geo.greenOut.x / geo.width, y: geo.greenOut.y / geo.height },
      shots: geo.shotsOut.map(p => ({ x: p.x / geo.width, y: p.y / geo.height }))
    }
  };
}
